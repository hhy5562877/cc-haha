import type { ModelInfo } from '../types/settings'

/**
 * DAL 模型目录常量。
 *
 * DAL 网关是模型事实的唯一权威源（DAL-code-cli dal-gateway/deepailab 两个
 * provider 扩展均明确"无种子目录"）：目录由 server 端 /api/models 运行时
 * 从网关拉取（getDalModelCatalog，15 分钟新鲜度），未登录返回空列表。
 * 这里不再硬编码任何模型 —— 一个过期的种子比空列表更糟，用户会选中
 * 必然 404 的模型。
 *
 * 思考等级对齐 pi-agent-core ThinkingLevel，经 WS set_runtime_config →
 * RPC set_thinking_level 生效。
 */

/** DAL 网关 provider id（与 dal --provider / dal-gateway 扩展一致）。 */
export const DAL_GATEWAY_PROVIDER_ID = 'dalcode-gateway'
export const DAL_GATEWAY_PROVIDER_NAME = 'DAL Gateway'

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

/** DAL CLI 的默认思考等级（--thinking 缺省值）。 */
export const DAL_DEFAULT_THINKING_LEVEL: DalThinkingLevel = 'medium'

/**
 * 运行时发现的目录占位：/api/models 未返回前为空。UI 展示"选择模型"，
 * 不再回落到任何本地种子。
 */
export const DAL_GATEWAY_MODELS: ModelInfo[] = []

export function isDalThinkingLevel(value: unknown): value is DalThinkingLevel {
  return typeof value === 'string' && (DAL_THINKING_LEVELS as readonly string[]).includes(value)
}
