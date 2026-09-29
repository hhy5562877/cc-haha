/**
 * DAL 模型目录发现服务。
 *
 * 取代原 Claude 硬编码目录（DEFAULT_MODELS / modelCatalog.ts）：
 * DAL 网关是模型事实的唯一权威源（DAL-code-cli 两个 provider 扩展均
 * 明确"无种子目录，网关的列表是唯一事实"），目录经
 * GET {DALCODE_GATEWAY_URL}/models 获取（Bearer JWT），与
 * dal-gateway provider 的 refreshModels 走同一路径、同一 15 分钟
 * 新鲜度（CATALOG_FRESH_MS）。
 *
 * 通道说明（DESIGN.md 协调）：有运行中会话时 proto 适配层可经 RPC
 * get_available_models 拿更实时的列表；本服务是"无会话"路径的
 * 自包含实现，二者共用同一条网关端点，结果一致。
 */

import { dalAuthService } from './dalAuthService.js'

/** 目录新鲜度：对齐 deepailab 扩展的 CATALOG_FRESH_MS。 */
const CATALOG_FRESH_MS = 15 * 60 * 1000
/** 网关延迟高（TLS + 代理），20s 上界与 dal-gateway CATALOG_TIMEOUT_MS 一致。 */
const CATALOG_TIMEOUT_MS = 20_000

/** DAL CLI 支持的思考等级全集（pi-agent-core ThinkingLevel）。 */
export const DAL_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type DalThinkingLevel = (typeof DAL_THINKING_LEVELS)[number]

/** 对齐桌面端 ModelInfo 的目录条目形状（/api/models 消费）。 */
export type DalModelCatalogEntry = {
  id: string
  name: string
  description: string
  context: string
  reasoning: boolean
  supportedThinkingLevels: DalThinkingLevel[]
  defaultThinkingLevel?: DalThinkingLevel
}

type GatewayModelRaw = {
  id?: string
  display_name?: string
  name?: string
  context_window?: number
  max_output_tokens?: number
  capabilities?: string[]
  reasoning_efforts?: string[]
}

type CachedCatalog = {
  models: DalModelCatalogEntry[]
  fetchedAt: number
}

let cache: CachedCatalog | null = null
let inFlight: Promise<DalModelCatalogEntry[]> | null = null

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    const millions = count / 1_000_000
    return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`
  }
  if (count >= 1_000) {
    const thousands = count / 1_000
    return thousands % 1 === 0 ? `${thousands}K` : `${thousands.toFixed(1)}K`
  }
  return count.toString()
}

/** 网关实测接受的 reasoning_efforts ∩ DAL 思考等级全集。 */
function normalizeThinkingLevels(efforts: string[] | undefined): DalThinkingLevel[] {
  if (!efforts || efforts.length === 0) return []
  const accepted = new Set(efforts.map((e) => e.trim().toLowerCase()))
  return DAL_THINKING_LEVELS.filter((level) => accepted.has(level))
}

function toCatalogEntry(raw: GatewayModelRaw): DalModelCatalogEntry | null {
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id) return null
  const displayName = raw.display_name ?? raw.name ?? id
  const capabilities = (raw.capabilities ?? []).map((c) => c.toLowerCase())
  const reasoning = capabilities.includes('reasoning') || (raw.reasoning_efforts?.length ?? 0) > 0
  const levels = normalizeThinkingLevels(raw.reasoning_efforts)
  return {
    id,
    name: displayName,
    description: raw.name ?? displayName,
    context: typeof raw.context_window === 'number' && raw.context_window > 0
      ? formatTokenCount(raw.context_window)
      : '',
    reasoning,
    supportedThinkingLevels: levels,
    ...(levels.length > 0 ? { defaultThinkingLevel: 'medium' as DalThinkingLevel } : {}),
  }
}

function isCatalogEntry(value: unknown): value is DalModelCatalogEntry {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as { id?: unknown }).id === 'string'
    && (value as { id: string }).id.length > 0
}

/**
 * 获取 DAL 网关模型目录。
 *
 * - 未登录 / 无 token：返回 []（与 DAL 语义一致：未登录即无模型可用）。
 * - 缓存未过期：直接返回缓存（stale-while-revalidate 的 stale 侧）。
 * - 过期 / 无缓存：拉网关；失败时保留上一次的好目录（不可达只应延迟，
 *   不应清空选择），并抛给调用方一条可展示的错误。
 */
export async function getDalModelCatalog(options: { force?: boolean } = {}): Promise<DalModelCatalogEntry[]> {
  const fresh = cache && !options.force && Date.now() - cache.fetchedAt < CATALOG_FRESH_MS
  if (fresh) return cache.models

  if (inFlight) return inFlight

  inFlight = (async () => {
    const token = await dalAuthService.ensureFreshAccessToken()
    if (!token) {
      cache = { models: [], fetchedAt: Date.now() }
      return []
    }

    const status = await dalAuthService.getStatus()
    const baseUrl = (status.gatewayUrl || '').replace(/\/+$/, '')

    let response: Response
    try {
      response = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      })
    } catch (error) {
      const aborted = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
      throw new Error(
        `DAL 网关模型目录获取失败（${aborted ? '请求超时' : String(error)}）`,
      )
    }
    if (!response.ok) {
      throw new Error(`DAL 网关拒绝了模型目录请求（HTTP ${response.status}）`)
    }

    const body = (await response.json()) as { data?: GatewayModelRaw[] }
    const models = (body.data ?? [])
      .map(toCatalogEntry)
      .filter((entry): entry is DalModelCatalogEntry => entry !== null)

    if (models.length > 0) {
      cache = { models, fetchedAt: Date.now() }
    }
    return models
  })().finally(() => {
    inFlight = null
  })

  return inFlight
}

/** 上一次成功目录（可能过期），供 UI 在网关不可达时兜底展示。 */
export function getLastGoodDalCatalog(): DalModelCatalogEntry[] {
  return cache?.models.filter(isCatalogEntry) ?? []
}

/** 目录缓存状态（诊断用）。 */
export function getDalCatalogState(): { cached: boolean; fetchedAt: number | null; count: number } {
  return {
    cached: cache !== null,
    fetchedAt: cache?.fetchedAt ?? null,
    count: cache?.models.length ?? 0,
  }
}
