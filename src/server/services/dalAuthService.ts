/**
 * DAL 认证服务 — DeepAILab Keycloak OIDC Device Flow (RFC 8628)
 *
 * 取代原 Claude OAuth 链路（hahaOAuthService + claudeOfficialRuntime），
 * 成为桌面端登录 DAL 网关的唯一入口。核心流程移植自 DAL-code-cli
 * packages/deepailab/src/oidc.ts（零依赖：global fetch + node:crypto），
 * 存储模式与 hahaOAuthService 平行：0600 凭据文件，永不回传 token 本体。
 *
 * 与 DAL 侧的对应关系：
 *   - access_token (JWT) 即 DALCODE_GATEWAY_TOKEN，由 conversationService
 *     spawn dal 时注入（dal-gateway provider 的唯一凭据来源）。
 *   - 网关对 Bearer JWT 与 x-bf-vk 均接受（deepailab/index.ts 2026-09-11 复核），
 *     桌面端走 JWT + refresh_token 自动轮换（与 DAL Code 后端语义一致），
 *     不铸造 virtual key。
 *   - 凭据文件不写 ~/.dal/agent/auth.json（那是 pi AuthStorage 的私有格式，
 *     桌面端写入不兼容格式会破坏 dal CLI 登录态）；#6 迁移 ~/.dal 时再统一。
 */

import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ─── DAL OIDC 配置（与 deepailab/oidc.ts 默认值一致）─────────────────────────

const DEFAULT_ISSUER = 'https://auth.deepailab.ai/realms/deepailab'
const DEFAULT_CLIENT_ID = 'deepailab-cli'
const DEFAULT_SCOPES = 'openid profile email offline_access'
const DEFAULT_GATEWAY_URL = 'https://api.deepailab.ai/v1'

/** 提前这么多毫秒刷新 access token，避免到期边缘 401。 */
const EXPIRY_SKEW_MS = 30_000
/** 轮询 token endpoint 的单请求超时。 */
const POLL_TIMEOUT_MS = 15_000

type DalAuthConfig = {
  issuer: string
  clientId: string
  scopes: string
  gatewayUrl: string
}

function resolveConfig(): DalAuthConfig {
  return {
    issuer: process.env.DAL_AUTH_ISSUER || DEFAULT_ISSUER,
    clientId: process.env.DAL_AUTH_CLIENT_ID || DEFAULT_CLIENT_ID,
    scopes: process.env.DAL_AUTH_SCOPES || DEFAULT_SCOPES,
    gatewayUrl: normalizeGatewayUrl(process.env.DAL_GATEWAY_URL || DEFAULT_GATEWAY_URL),
  }
}

function normalizeGatewayUrl(raw: string): string {
  return raw.replace(/\/+$/, '')
}

// ─── OIDC 发现（按 issuer 缓存）───────────────────────────────────────────────

type OidcEndpoints = {
  issuer: string
  deviceAuthorizationEndpoint: string
  tokenEndpoint: string
  authorizationEndpoint: string
  userinfoEndpoint: string
  endSessionEndpoint: string
}

const discoveryCache = new Map<string, OidcEndpoints>()

async function discover(issuer: string): Promise<OidcEndpoints> {
  const cached = discoveryCache.get(issuer)
  if (cached) return cached

  const base = issuer.replace(/\/+$/, '')
  const url = `${base}/.well-known/openid-configuration`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(`OIDC discovery failed (${res.status}) at ${url}`)
  }
  const doc = (await res.json()) as {
    issuer?: string
    device_authorization_endpoint?: string
    token_endpoint?: string
    userinfo_endpoint?: string
    end_session_endpoint?: string
  }
  const oidc = `${base}/protocol/openid-connect`
  const endpoints: OidcEndpoints = {
    issuer: doc.issuer ?? issuer,
    deviceAuthorizationEndpoint: doc.device_authorization_endpoint ?? `${oidc}/auth/device`,
    tokenEndpoint: doc.token_endpoint ?? `${oidc}/token`,
    authorizationEndpoint: `${oidc}/auth`,
    userinfoEndpoint: doc.userinfo_endpoint ?? `${oidc}/userinfo`,
    endSessionEndpoint: doc.end_session_endpoint ?? `${oidc}/logout`,
  }
  discoveryCache.set(issuer, endpoints)
  return endpoints
}

// ─── 凭据存储（0600 文件，与 hahaOAuthService 平行）──────────────────────────

export type DalTokenSet = {
  accessToken: string
  refreshToken?: string
  idToken?: string
  /** access token 过期时间（epoch ms）。 */
  expiresAt: number
}

export type DalAuthAccount = {
  subject?: string
  email?: string | null
  username?: string | null
}

export type DalGatewayOverride = {
  url?: string
  token?: string
}

type StoredDalAuth = {
  tokens: DalTokenSet
  account?: DalAuthAccount
  gatewayOverride?: DalGatewayOverride
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 仅展示用 JWT payload 解码（不验签，不信任）。 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

// ─── 服务 ─────────────────────────────────────────────────────────────────────

export type DalDeviceSession = {
  state: string
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  interval: number
  expiresAt: number
}

export type DalPollStatus =
  | { status: 'pending' }
  | { status: 'complete' }
  | { status: 'expired' }
  | { status: 'denied'; message: string }
  | { status: 'error'; message: string }

export class DalAuthService {
  private pendingSessions = new Map<string, DalDeviceSession>()

  private getAuthFilePath(): string {
    const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
    return path.join(configDir, 'cc-haha', 'dal-auth.json')
  }

  private async readStore(): Promise<StoredDalAuth | null> {
    try {
      const raw = await fs.readFile(this.getAuthFilePath(), 'utf-8')
      const parsed = JSON.parse(raw) as StoredDalAuth
      if (!parsed?.tokens?.accessToken) return null
      return parsed
    } catch {
      return null
    }
  }

  private async writeStore(store: StoredDalAuth | null): Promise<void> {
    const filePath = this.getAuthFilePath()
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
    if (store === null) {
      await fs.rm(filePath, { force: true })
      return
    }
    const tmp = `${filePath}.${process.pid}.tmp`
    await fs.writeFile(tmp, JSON.stringify(store, null, 2), { mode: 0o600 })
    await fs.rename(tmp, filePath)
  }

  // ── Device flow ──

  /** 发起 device flow：返回验证 URL 与 user code，凭 state 关联轮询。 */
  async startDeviceLogin(): Promise<{
    state: string
    userCode: string
    verificationUri: string
    verificationUriComplete: string
    interval: number
    expiresIn: number
  }> {
    const cfg = resolveConfig()
    const endpoints = await discover(cfg.issuer)

    const res = await fetch(endpoints.deviceAuthorizationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: cfg.clientId, scope: cfg.scopes }).toString(),
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string }
      throw new Error(body.error_description ?? body.error ?? `device_authorization failed (HTTP ${res.status})`)
    }
    const data = (await res.json()) as {
      device_code: string
      user_code: string
      verification_uri: string
      verification_uri_complete?: string
      expires_in: number
      interval?: number
    }

    const state = b64url(randomBytes(16))
    const session: DalDeviceSession = {
      state,
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      verificationUriComplete: data.verification_uri_complete ?? data.verification_uri,
      interval: data.interval ?? 5,
      expiresAt: Date.now() + data.expires_in * 1000,
    }
    this.pendingSessions.set(state, session)
    // 会话过期后清理，防句柄累积。
    setTimeout(() => this.pendingSessions.delete(state), Math.min(session.expiresAt - Date.now() + 60_000, 3_600_000))
      .unref?.()

    return {
      state,
      userCode: session.userCode,
      verificationUri: session.verificationUri,
      verificationUriComplete: session.verificationUriComplete,
      interval: session.interval,
      expiresIn: data.expires_in,
    }
  }

  /**
   * 轮询一次 token endpoint（前端按 interval 驱动）。授权成功后立即持久化
   * token 并拉取账号信息。
   */
  async pollDeviceLogin(state: string): Promise<DalPollStatus> {
    const session = this.pendingSessions.get(state)
    if (!session) return { status: 'expired' }
    if (Date.now() >= session.expiresAt) {
      this.pendingSessions.delete(state)
      return { status: 'expired' }
    }

    const cfg = resolveConfig()
    const endpoints = await discover(cfg.issuer)
    const res = await fetch(endpoints.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: cfg.clientId,
        device_code: session.deviceCode,
      }).toString(),
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    })

    if (res.ok) {
      const raw = (await res.json()) as {
        access_token: string
        refresh_token?: string
        id_token?: string
        expires_in: number
      }
      this.pendingSessions.delete(state)
      const tokens: DalTokenSet = {
        accessToken: raw.access_token,
        ...(raw.refresh_token ? { refreshToken: raw.refresh_token } : {}),
        ...(raw.id_token ? { idToken: raw.id_token } : {}),
        expiresAt: Date.now() + raw.expires_in * 1000,
      }
      const existing = await this.readStore()
      await this.writeStore({
        tokens,
        account: readAccountFromTokens(tokens),
        ...(existing?.gatewayOverride ? { gatewayOverride: existing.gatewayOverride } : {}),
      })
      return { status: 'complete' }
    }

    const body = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string }
    switch (body.error) {
      case 'authorization_pending':
        return { status: 'pending' }
      case 'slow_down':
        return { status: 'pending' }
      case 'expired_token':
        this.pendingSessions.delete(state)
        return { status: 'expired' }
      case 'access_denied':
        this.pendingSessions.delete(state)
        return { status: 'denied', message: body.error_description ?? 'Authorization denied by user' }
      default:
        return { status: 'error', message: body.error_description ?? body.error ?? `HTTP ${res.status}` }
    }
  }

  // ── 状态 / 刷新 / 登出 ──

  /**
   * 返回有效的 access token：未过期直接用；过期则用 refresh_token 刷新并
   * 持久化轮换后的新集合（Keycloak 默认轮换 refresh token，必须落盘）。
   * 无可用凭据返回 null。
   */
  async ensureFreshAccessToken(): Promise<string | null> {
    const store = await this.readStore()
    if (!store) return null

    // 手动覆盖 token（企业内网等无法走 OIDC 的场景）直接透传，不刷新。
    if (store.gatewayOverride?.token) return store.gatewayOverride.token

    if (store.tokens.expiresAt - EXPIRY_SKEW_MS > Date.now()) {
      return store.tokens.accessToken
    }
    if (!store.tokens.refreshToken) return null

    const cfg = resolveConfig()
    const endpoints = await discover(cfg.issuer)
    const res = await fetch(endpoints.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: cfg.clientId,
        refresh_token: store.tokens.refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    }).catch(() => null)
    if (!res || !res.ok) return null

    const raw = (await res.json()) as {
      access_token: string
      refresh_token?: string
      id_token?: string
      expires_in: number
    }
    const refreshed: DalTokenSet = {
      accessToken: raw.access_token,
      // 服务端未轮换时保留旧 refresh token（罕见兜底）。
      refreshToken: raw.refresh_token ?? store.tokens.refreshToken,
      ...(raw.id_token ? { idToken: raw.idToken } : {}),
      expiresAt: Date.now() + raw.expires_in * 1000,
    }
    await this.writeStore({
      tokens: refreshed,
      account: readAccountFromTokens(refreshed) ?? store.account,
      ...(store.gatewayOverride ? { gatewayOverride: store.gatewayOverride } : {}),
    })
    return refreshed.accessToken
  }

  /** 登录状态查询（不回传 token 本体）。 */
  async getStatus(): Promise<{
    loggedIn: boolean
    expiresAt: number | null
    account: DalAuthAccount | null
    gatewayUrl: string
    gatewayTokenConfigured: boolean
  }> {
    const store = await this.readStore()
    const cfg = resolveConfig()
    const loggedIn = store !== null &&
      (store.gatewayOverride?.token !== undefined || store.tokens.expiresAt > Date.now())
    return {
      loggedIn,
      expiresAt: store ? store.tokens.expiresAt : null,
      account: store?.account ?? null,
      gatewayUrl: store?.gatewayOverride?.url ?? cfg.gatewayUrl,
      gatewayTokenConfigured: store?.gatewayOverride?.token !== undefined,
    }
  }

  /** 登出：尽力撤销 Keycloak 会话，无论成败都清除本地凭据。 */
  async logout(): Promise<void> {
    const store = await this.readStore()
    if (store?.tokens.refreshToken && !store.gatewayOverride?.token) {
      try {
        const cfg = resolveConfig()
        const endpoints = await discover(cfg.issuer)
        await fetch(endpoints.endSessionEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: cfg.clientId,
            refresh_token: store.tokens.refreshToken,
          }).toString(),
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        })
      } catch {
        // 撤销失败不阻塞本地清理。
      }
    }
    await this.writeStore(null)
  }

  // ── 网关配置（手动覆盖入口）──

  async setGatewayOverride(override: { url?: string; token?: string }): Promise<void> {
    const store = await this.readStore() ?? {
      tokens: { accessToken: '', expiresAt: 0 },
    }
    const gatewayOverride: DalGatewayOverride = {
      ...(override.url !== undefined ? { url: override.url ? normalizeGatewayUrl(override.url) : undefined } : {}),
      ...(override.token !== undefined ? { token: override.token || undefined } : {}),
    }
    const hasAny = Boolean(gatewayOverride.url || gatewayOverride.token)
    await this.writeStore({
      ...store,
      gatewayOverride: hasAny ? gatewayOverride : undefined,
    })
  }

  /**
   * spawn 注入对接面：conversationService 启动 dal 进程时应把返回值合并进
   * env（DALCODE_GATEWAY_URL / DALCODE_GATEWAY_TOKEN 是 dalcode-gateway
   * provider 的唯一驱动变量）。未登录返回 null，由调用方决定是否降级。
   */
  async getSpawnEnv(): Promise<Record<string, string> | null> {
    const store = await this.readStore()
    const cfg = resolveConfig()
    const url = store?.gatewayOverride?.url ?? cfg.gatewayUrl
    const manualToken = store?.gatewayOverride?.token
    const token = manualToken ?? await this.ensureFreshAccessToken()
    if (!token) return null
    return {
      DALCODE_GATEWAY_URL: url,
      DALCODE_GATEWAY_TOKEN: token,
    }
  }
}

function readAccountFromTokens(tokens: DalTokenSet): DalAuthAccount | null {
  const payload = decodeJwtPayload(tokens.accessToken) ?? decodeJwtPayload(tokens.idToken ?? '')
  if (!payload) return null
  return {
    subject: typeof payload.sub === 'string' ? payload.sub : undefined,
    email: typeof payload.email === 'string' ? payload.email : null,
    username: typeof payload.preferred_username === 'string' ? payload.preferred_username : null,
  }
}

export const dalAuthService = new DalAuthService()

/** 供模型目录探测使用的 sha256 账号标签（保留 DAL 缓存键风格）。 */
export function accountTag(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}
