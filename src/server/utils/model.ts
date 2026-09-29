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
