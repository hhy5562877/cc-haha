/**
 * dal-bridge 会话状态存储：每会话 token、待审批请求表、环境变量注入。
 *
 * token 生成策略对齐现有 CC_HAHA_LOCAL_ACCESS_TOKEN / localAccessAuth 机制：
 * spawn 时生成随机 token 经 buildDalBridgeEnv() 交给 dal 进程，dal 以
 * `x-dal-bridge-token` 头回传，服务端 timingSafeEqual 校验。
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { setGuardModeForSession, toDalGuardMode } from './guardMode.js'
import {
  DAL_BRIDGE_RESPONSE_TIMEOUT_MS,
  DAL_BRIDGE_REQUEST_PREFIX,
  type DalBridgePlanBody,
  type DalBridgePermissionBody,
  type DalBridgePermissionVerdict,
  type DalBridgePlanVerdict,
  type DalGuardMode,
} from './types.js'

interface PendingBridgeRequest {
  requestId: string
  kind: 'permission' | 'plan'
  /** dal 侧原始请求体，respond 端点回算 ruleId / 构造回包时使用。 */
  payload: DalBridgePermissionBody | DalBridgePlanBody
  ruleId?: string
  timer: ReturnType<typeof setTimeout>
  resolve: (verdict: DalBridgePermissionVerdict | DalBridgePlanVerdict) => void
  createdAt: number
}

interface DalBridgeSessionState {
  token: string
  pending: Map<string, PendingBridgeRequest>
}

const sessionStates = new Map<string, DalBridgeSessionState>()

function createSessionState(): DalBridgeSessionState {
  return {
    // 32 字节 base64url：与 CC_HAHA_SESSION_COLLABORATION_TOKEN 同量级的
    // 不可猜测性，凭据只存在于宿主与对应 dal 进程的内存里。
    token: randomBytes(32).toString('base64url'),
    pending: new Map(),
  }
}

function stateFor(sessionId: string): DalBridgeSessionState {
  let state = sessionStates.get(sessionId)
  if (!state) {
    state = createSessionState()
    sessionStates.set(sessionId, state)
  }
  return state
}

/** 恒定时间 token 比较，避免逐字节早退泄露前缀。 */
export function isDalBridgeTokenValid(sessionId: string, candidate: unknown): boolean {
  const state = sessionStates.get(sessionId)
  if (!state || typeof candidate !== 'string' || candidate.length === 0) return false
  const expected = Buffer.from(state.token)
  const actual = Buffer.from(candidate)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** 渲染端 respond 端点复用同一 token 校验路径（渲染端拿不到 bridge token，
 * 由 Bearer 层鉴权，这里仅防御内部误用）。 */
export function hasDalBridgeSession(sessionId: string): boolean {
  return sessionStates.has(sessionId)
}

// ─── 环境变量注入契约 ──────────────────────────────────────────────

/**
 * 生成 dal 进程的 bridge 环境变量（proto 成员在 buildChildEnv 中展开调用）。
 *
 * 契约（docs/dal-integration/bridge-contract.md §buildDalBridgeEnv）：
 *   DALCODE_BRIDGE_URL   宿主 HTTP 基座（由 sdkUrl 推导，与 CC_HAHA_DESKTOP_SERVER_URL 同源）
 *   DALCODE_BRIDGE_TOKEN 本次 spawn 一次性随机 token
 *   DAL_GUARD_MODE       dal-guard 启动种子（bridge 模式下它 stand down，
 *                        种子仅影响非 bridge 兜底路径，仍保持与宿主一致）
 *
 * @param sessionId      会话 ID
 * @param sdkUrl         该会话的 SDK ws 地址（undefined 时无法推导宿主 URL，返回空环境）
 * @param permissionMode 宿主 PermissionMode（bypassPermissions/dontAsk→yolo）
 */
export function buildDalBridgeEnv(
  sessionId: string,
  sdkUrl?: string,
  permissionMode?: string,
): Record<string, string> {
  let baseUrl: string | undefined
  if (sdkUrl) {
    try {
      baseUrl = `http://${new URL(sdkUrl).host}`
    } catch {
      baseUrl = undefined
    }
  }
  if (!baseUrl) return {}

  const mode = toDalGuardMode(permissionMode)
  setGuardModeForSession(sessionId, mode)

  const state = stateFor(sessionId)
  return {
    DALCODE_BRIDGE_URL: baseUrl,
    DALCODE_BRIDGE_TOKEN: state.token,
    DAL_GUARD_MODE: mode,
  }
}

// ─── 待审批请求生命周期 ────────────────────────────────────────────

function generateRequestId(): string {
  return `${DAL_BRIDGE_REQUEST_PREFIX}${randomBytes(12).toString('hex')}`
}

export interface PendingHandle {
  requestId: string
  promise: Promise<DalBridgePermissionVerdict | DalBridgePlanVerdict>
}

/**
 * 登记一条待审批请求：生成 dalbridge_ 前缀 ID，启动 120s 超时计时。
 * 超时自动按拒绝回包（fail-closed，与 dal-bridge 客户端语义一致）。
 */
export function createPendingRequest(
  sessionId: string,
  kind: 'permission' | 'plan',
  payload: DalBridgePermissionBody | DalBridgePlanBody,
  ruleId?: string,
): PendingHandle {
  const state = stateFor(sessionId)
  const requestId = generateRequestId()
  const promise = new Promise<DalBridgePermissionVerdict | DalBridgePlanVerdict>((resolve) => {
    const timer = setTimeout(() => {
      state.pending.delete(requestId)
      resolve(
        kind === 'plan'
          ? { decision: 'cancel' as const, feedback: '审批超时（120s 无响应），已自动取消。' }
          : { decision: 'deny' as const, message: '审批超时（120s 无响应），已自动拒绝。' },
      )
    }, DAL_BRIDGE_RESPONSE_TIMEOUT_MS)
    state.pending.set(requestId, { requestId, kind, payload, ruleId, timer, resolve, createdAt: Date.now() })
  })
  return { requestId, promise }
}

/** 渲染端响应落地：清理计时器并 resolve 等待中的 HTTP 回包。 */
export function resolvePendingRequest(
  sessionId: string,
  requestId: string,
  verdict: DalBridgePermissionVerdict | DalBridgePlanVerdict,
): 'permission' | 'plan' | undefined {
  const state = sessionStates.get(sessionId)
  const pending = state?.pending.get(requestId)
  if (!state || !pending) return undefined
  clearTimeout(pending.timer)
  state.pending.delete(requestId)
  pending.resolve(verdict)
  return pending.kind
}

/** 查询待审批请求（respond 端点校验 + 渲染端恢复场景）。 */
export function getPendingRequest(
  sessionId: string,
  requestId: string,
): Readonly<PendingBridgeRequest> | undefined {
  return sessionStates.get(sessionId)?.pending.get(requestId)
}

export function listPendingRequestIds(sessionId: string): string[] {
  return [...(sessionStates.get(sessionId)?.pending.keys() ?? [])]
}

export function hasPendingRequests(sessionId: string): boolean {
  return (sessionStates.get(sessionId)?.pending.size ?? 0) > 0
}

/** 会话销毁时清理：所有等待中的 dal 请求立即按拒绝回包，token 失效。 */
export function cleanupDalBridgeSession(sessionId: string): void {
  const state = sessionStates.get(sessionId)
  if (!state) return
  sessionStates.delete(sessionId)
  for (const pending of state.pending.values()) {
    clearTimeout(pending.timer)
    pending.resolve(
      pending.kind === 'plan'
        ? { decision: 'cancel' as const, feedback: '会话已结束，审批已取消。' }
        : { decision: 'deny' as const, message: '会话已结束，审批已拒绝。' },
    )
  }
}
