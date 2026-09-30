/**
 * server 侧模型工具 —— 解耦批次 7 提取。
 *
 * 原实现位于引擎支撑层 src/utils/model/{modelContextWindows,model,providers}.ts；
 * server 仅消费以下四个小符号，此处原样提取以切断 server → utils/model 的
 * 直接依赖边（model 子系统余量 ~1000 行含 analytics/bootstrap/modelStrings
 * 链，随引擎休眠）。
 */

/** 环境变量：按模型覆盖上下文窗口（JSON：模型名→token 数）。 */
export const MODEL_CONTEXT_WINDOWS_ENV_KEY = 'CLAUDE_CODE_MODEL_CONTEXT_WINDOWS'

export const MODEL_CONTEXT_WINDOW_MIN = 16_000

export const MODEL_CONTEXT_WINDOW_MAX = 10_000_000

/** 剥离 API 模型串尾部的 [1m]/[2m] 上下文窗口标记。 */
export function normalizeModelStringForAPI(model: string): string {
  return model.replace(/\[(1|2)m\]/gi, '')
}

/**
 * 当前 ANTHROPIC_BASE_URL 是否指向 Anthropic 一方 API。
 * 未设置时视为一方；非法 URL 一律按一方处理（保持现有 SDK 边界行为）。
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return true
  }
}

// ─── 上下文窗口环境覆盖（原 modelContextWindows.ts 切片）────────────────

export function normalizeModelContextKey(model: string): string {
  return model
    .trim()
    .replace(/\[1m\]$/i, '')
    .replace(/:1m$/i, '')
    .toLowerCase()
}

function normalizeWindow(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return undefined
  }
  if (value < MODEL_CONTEXT_WINDOW_MIN || value > MODEL_CONTEXT_WINDOW_MAX) {
    return undefined
  }
  return value
}

function normalizeConfiguredContextWindows(parsed: unknown): Record<string, number> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {}
  }
  const windows: Record<string, number> = {}
  for (const [model, value] of Object.entries(parsed)) {
    const normalized = normalizeWindow(value)
    if (normalized !== undefined) {
      windows[normalizeModelContextKey(model)] = normalized
    }
  }
  return windows
}

function findConfiguredModelContextWindow(
  model: string,
  configured: Record<string, number>,
): number | undefined {
  const normalizedModel = normalizeModelContextKey(model)
  const exact = configured[normalizedModel]
  if (exact !== undefined) {
    return exact
  }
  for (const [configuredModel, window] of Object.entries(configured)) {
    if (
      normalizedModel.endsWith(`/${configuredModel}`) ||
      normalizedModel.endsWith(`:${configuredModel}`)
    ) {
      return window
    }
  }
  return undefined
}

export function getModelContextWindowFromEnvValue(
  model: string,
  raw: string | undefined,
): number | undefined {
  if (!raw?.trim()) {
    return undefined
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return findConfiguredModelContextWindow(
      model,
      normalizeConfiguredContextWindows(parsed),
    )
  } catch {
    return undefined
  }
}

/**
 * server 侧规范化模型名（原 getCanonicalName 的窄化近似）：
 * 剥离 [1m]/[2m] 标记、provider 前缀与 Bedrock ARN，转小写。
 * 引擎完整实现依赖 modelStrings 状态子系统（settings/bedrock 链），
 * server 侧仅用于成本表键匹配——dal 网关模型本就不在表内，
 * 返回未知键即语义正确（hasUnknownModelCost）。
 */
export function getCanonicalName(fullModelName: string): string {
  let name = fullModelName.replace(/\[(1|2)m\]/gi, '')
  // 剥离 provider 前缀（provider/id 形态）
  const slash = name.lastIndexOf('/')
  if (slash !== -1) name = name.slice(slash + 1)
  // 剥离 Bedrock ARN 形态（foundation-model/... 已被上一条覆盖； anthropic. 前缀）
  name = name.replace(/^anthropic\./, '')
  return name.toLowerCase()
}


// ─── 模型深链窄化（批次 28）────────────────────────────────────────────
// 原 getMainLoopModel/resolveAntModel/parseUserSpecifiedModel 深链引擎
// modelStrings/settings/bedrock 子系统。server 侧语义：
// - getMainLoopModel: 返回 env 模型或 undefined（dalSideQuery 自行回退网关默认）
// - resolveAntModel: 外部构建恒 undefined（原实现 ant 门控等价降级）
// - parseUserSpecifiedModel: 身份规范化近似（不做引擎别名映射）

export function getMainLoopModel(): string | undefined {
  return process.env.ANTHROPIC_MODEL || undefined
}

export function resolveAntModel(_model: string | undefined): undefined {
  return undefined
}

export function parseUserSpecifiedModelNarrow(modelInput: string): string {
  let name = modelInput.trim()
  name = name.replace(/\[(1|2)m\]/gi, '')
  const slash = name.lastIndexOf('/')
  if (slash !== -1) name = name.slice(slash + 1)
  return name.toLowerCase()
}
