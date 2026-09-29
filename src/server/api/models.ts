/**
 * Models REST API
 *
 * GET  /api/models          — 获取可用模型列表
 * GET  /api/models/current  — 获取当前选中的模型
 * PUT  /api/models/current  — 切换模型
 * GET  /api/effort          — 获取 Effort 等级
 * PUT  /api/effort          — 设置 Effort 等级
 */

import { SettingsService } from '../services/settingsService.js'
import { ProviderService } from '../services/providerService.js'
import { attributionHeaderEnvForModel } from '../services/attributionHeaderPolicy.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { hasOpenAIAuthLogin } from '../../utils/auth.js'
import { getOpenAICodexModelCatalog } from '../services/openaiAuth/modelCatalog.js'
import { getDesktopOpenAICodexModelCatalog } from '../services/openaiModelCatalog.js'
import {
  OPENAI_DEFAULT_MAIN_MODEL,
  type OpenAIModelCatalogEntry,
} from '../services/openaiAuth/models.js'
import {
  OPENAI_OFFICIAL_PROVIDER_ID,
  OPENAI_OFFICIAL_PROVIDER_NAME,
  isOpenAIOfficialProviderId,
} from '../services/openaiOfficialProvider.js'
import { getGrokModelCatalog } from '../services/grokAuth/modelCatalog.js'
import {
  GROK_DEFAULT_MAIN_MODEL,
  type GrokModelCatalogEntry,
} from '../services/grokAuth/models.js'
import {
  GROK_OFFICIAL_PROVIDER_ID,
  GROK_OFFICIAL_PROVIDER_NAME,
  isGrokOfficialProviderId,
} from '../services/grokOfficialProvider.js'
import { hahaGrokOAuthService } from '../services/hahaGrokOAuthService.js'
import {
  getDalModelCatalog,
  getLastGoodDalCatalog,
  DAL_THINKING_LEVELS,
  type DalModelCatalogEntry,
} from '../services/dalModelCatalog.js'
import {
  getPresetDefaultEnv,
  getPresetReasoningProviderKind,
} from '../services/providerRuntimeEnv.js'
import {
  getModelReasoningCapabilityOverride,
  resolveModelReasoningProfile,
  type ModelReasoningApiFormat,
  type ModelReasoningProviderKind,
} from '../../shared/modelReasoning.js'

// ─── Fallback models ──────────────────────────────────────────────────────────
// 目录的唯一事实源是 DAL 网关（见 dalModelCatalog.ts）：登录后由
// getStandaloneModelList 动态拉取，未登录返回空列表。这里不再保留任何
// 硬编码模型 —— 一个过期的种子比空列表更糟（用户会选到必然 404 的模型）。

// 思考等级走 DAL 全集（off..max，pi-agent-core ThinkingLevel），经
// set_thinking_level/RPC 生效；原 Claude effort 体系（low..max）仅存于
// src/shared/modelReasoning.ts 供 provider 兼容层使用。
const EFFORT_LEVELS = DAL_THINKING_LEVELS

const DEFAULT_MODEL = ''
const DEFAULT_EFFORT = 'medium'

const settingsService = new SettingsService()
const providerService = new ProviderService()

type ApiModelInfo = {
  id: string
  name: string
  description: string
  context: string
  defaultReasoningEffort?: string
  supportedReasoningEfforts?: string[]
}

function addUniqueModel(
  models: ApiModelInfo[],
  model: ApiModelInfo | null,
): void {
  if (!model || !model.id.trim()) {
    return
  }

  if (models.some(existing => existing.id === model.id)) {
    return
  }

  models.push(model)
}

function buildProviderModelList(
  models: {
    main: string
    haiku: string
    sonnet: string
    opus: string
    fable?: string
  },
  apiFormat?: ModelReasoningApiFormat,
  presetDefaultEnv: Record<string, string> = {},
  providerKind?: ModelReasoningProviderKind,
): ApiModelInfo[] {
  const modelList: ApiModelInfo[] = []

  const buildModel = (id: string, description: string): ApiModelInfo => {
    const reasoningProfile = apiFormat
      ? resolveModelReasoningProfile(
          id,
          apiFormat,
          getModelReasoningCapabilityOverride(id, models, presetDefaultEnv),
          providerKind,
        )
      : undefined
    return {
      id,
      name: id,
      description,
      context: '',
      ...(apiFormat
        ? {
            supportedReasoningEfforts: [...(reasoningProfile?.supportedReasoningEfforts ?? [])],
          }
        : {}),
      ...(reasoningProfile?.defaultReasoningEffort
        ? { defaultReasoningEffort: reasoningProfile.defaultReasoningEffort }
        : {}),
    }
  }

  addUniqueModel(modelList, buildModel(models.main, 'Main model'))
  addUniqueModel(modelList, models.haiku
    ? buildModel(models.haiku, 'Haiku model')
    : null)
  addUniqueModel(modelList, models.sonnet
    ? buildModel(models.sonnet, 'Sonnet model')
    : null)
  addUniqueModel(modelList, models.opus
    ? buildModel(models.opus, 'Opus model')
    : null)
  addUniqueModel(modelList, models.fable
    ? buildModel(models.fable, 'Fable model')
    : null)

  return modelList
}

function buildOpenAIModelList(catalog: OpenAIModelCatalogEntry[]): ApiModelInfo[] {
  return catalog.map(model => ({
    id: model.value,
    name: model.label,
    description: model.description,
    context: model.contextWindow ? String(model.contextWindow) : '',
    defaultReasoningEffort: model.defaultReasoningEffort,
    supportedReasoningEfforts: model.supportedReasoningEfforts,
  }))
}

async function getOpenAIModelList(): Promise<ApiModelInfo[]> {
  return buildOpenAIModelList(await getDesktopOpenAICodexModelCatalog())
}

function buildGrokModelList(catalog: GrokModelCatalogEntry[]): ApiModelInfo[] {
  return catalog.map((model) => ({
    id: model.value,
    name: model.label,
    description: model.description,
    context: model.contextWindow ? String(model.contextWindow) : '',
    ...(model.reasoningEffort && { defaultReasoningEffort: model.reasoningEffort }),
    ...(model.supportsReasoningEffort === false
      ? { supportedReasoningEfforts: [] }
      : model.reasoningEfforts
        ? { supportedReasoningEfforts: model.reasoningEfforts }
        : {}),
  }))
}

async function getGrokModelList(): Promise<ApiModelInfo[]> {
  const tokens = await hahaGrokOAuthService.ensureFreshTokens()
  return buildGrokModelList(await getGrokModelCatalog({
    ...(tokens?.accessToken ? { accessToken: tokens.accessToken } : {}),
    accountKey: tokens?.email ?? (tokens ? 'authenticated-default' : 'logged-out'),
  }))
}

function getConfiguredAnthropicModels(settingsEnv: Record<string, unknown>): ApiModelInfo[] {
  const resolveModel = (key: string): string => {
    const runtimeValue = process.env[key]?.trim()
    if (runtimeValue) return runtimeValue
    const settingsValue = settingsEnv[key]
    return typeof settingsValue === 'string' ? settingsValue.trim() : ''
  }

  return buildProviderModelList({
    main: resolveModel('ANTHROPIC_MODEL'),
    haiku: resolveModel('ANTHROPIC_DEFAULT_HAIKU_MODEL'),
    sonnet: resolveModel('ANTHROPIC_DEFAULT_SONNET_MODEL'),
    opus: resolveModel('ANTHROPIC_DEFAULT_OPUS_MODEL'),
    fable: resolveModel('ANTHROPIC_DEFAULT_FABLE_MODEL'),
  })
}

async function getOpenAIAuthModels(): Promise<ApiModelInfo[]> {
  if (!hasOpenAIAuthLogin()) {
    return []
  }

  return buildOpenAIModelList(await getOpenAICodexModelCatalog())
}

function buildDalModelList(catalog: DalModelCatalogEntry[]): ApiModelInfo[] {
  return catalog.map((model) => ({
    id: model.id,
    name: model.name,
    description: model.description,
    context: model.context,
    ...(model.supportedThinkingLevels.length > 0
      ? { supportedReasoningEfforts: [...model.supportedThinkingLevels] }
      : {}),
    ...(model.defaultThinkingLevel ? { defaultReasoningEffort: model.defaultThinkingLevel } : {}),
  }))
}

/**
 * 无 provider 激活时的模型列表：DAL 网关目录是唯一来源（登录后非空），
 * OpenAI Codex Auth 目录作为补充。Anthropic env 配置的模型已随 Claude
 * 引擎移除而废弃。
 */
async function getStandaloneModelList(): Promise<ApiModelInfo[]> {
  const models: ApiModelInfo[] = []

  try {
    for (const model of buildDalModelList(await getDalModelCatalog())) {
      addUniqueModel(models, model)
    }
  } catch {
    // 网关不可达时保留空列表 + 上次好目录兜底。
    for (const model of buildDalModelList(await Promise.resolve(getLastGoodDalCatalog()))) {
      addUniqueModel(models, model)
    }
  }

  for (const model of await getOpenAIAuthModels()) {
    addUniqueModel(models, model)
  }

  return models
}

function normalizeEffortLevel(value: unknown): (typeof EFFORT_LEVELS)[number] {
  return typeof value === 'string' && EFFORT_LEVELS.includes(value as (typeof EFFORT_LEVELS)[number])
    ? value as (typeof EFFORT_LEVELS)[number]
    : DEFAULT_EFFORT
}

// ─── Router ───────────────────────────────────────────────────────────────────

export async function handleModelsApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const resource = segments[1] // 'models' | 'effort'
    const sub = segments[2] // 'current' | undefined

    // ── /api/effort ───────────────────────────────────────────────────
    if (resource === 'effort') {
      return await handleEffort(req)
    }

    // ── /api/models/* ─────────────────────────────────────────────────
    switch (sub) {
      case undefined:
        // GET /api/models — 优先从激活的 Provider 读取模型列表
        if (req.method !== 'GET') throw methodNotAllowed(req.method)
        return await handleModelsList()

      case 'current':
        return await handleCurrentModel(req)

      default:
        throw ApiError.notFound(`Unknown models endpoint: ${sub}`)
    }
  } catch (error) {
    return errorResponse(error)
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleModelsList(): Promise<Response> {
  const { providers, activeId } = await providerService.listProviders()
  if (isOpenAIOfficialProviderId(activeId)) {
    return Response.json({
      models: await getOpenAIModelList(),
      provider: {
        id: OPENAI_OFFICIAL_PROVIDER_ID,
        name: OPENAI_OFFICIAL_PROVIDER_NAME,
      },
    })
  }
  if (isGrokOfficialProviderId(activeId)) {
    return Response.json({
      models: await getGrokModelList(),
      provider: {
        id: GROK_OFFICIAL_PROVIDER_ID,
        name: GROK_OFFICIAL_PROVIDER_NAME,
      },
    })
  }

  const activeProvider = activeId ? providers.find((p) => p.id === activeId) : null
  if (activeProvider) {
    const modelList = buildProviderModelList(
      activeProvider.models,
      activeProvider.apiFormat,
      getPresetDefaultEnv(activeProvider.presetId),
      getPresetReasoningProviderKind(activeProvider.presetId),
    )
    return Response.json({
      models: modelList,
      provider: { id: activeProvider.id, name: activeProvider.name },
    })
  }
  return Response.json({ models: await getStandaloneModelList(), provider: null })
}

async function handleCurrentModel(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    // Build the full model list: prefer active provider's models, fall back to defaults
    const { providers, activeId } = await providerService.listProviders()
    const isOpenAIProviderActive = isOpenAIOfficialProviderId(activeId)
    const isGrokProviderActive = isGrokOfficialProviderId(activeId)
    const activeProvider = activeId ? providers.find((p) => p.id === activeId) : null
    const settings = activeProvider || isOpenAIProviderActive || isGrokProviderActive
      ? await providerService.getManagedSettings()
      : await settingsService.getUserSettings()
    const explicitModel = (settings.model as string) || ''
    const contextTier = (settings.modelContext as string) || undefined
    const env = (settings.env as Record<string, string>) || {}
    const runtimeEnvModel = process.env.ANTHROPIC_MODEL?.trim() || ''
    const settingsEnvModel = typeof env.ANTHROPIC_MODEL === 'string'
      ? env.ANTHROPIC_MODEL.trim()
      : ''

    let currentModelId: string
    let currentModelName: string

    if (isOpenAIProviderActive) {
      currentModelId = explicitModel || env.ANTHROPIC_MODEL || OPENAI_DEFAULT_MAIN_MODEL
      currentModelName = currentModelId
    } else if (isGrokProviderActive) {
      currentModelId = explicitModel || env.ANTHROPIC_MODEL || GROK_DEFAULT_MAIN_MODEL
      currentModelName = currentModelId
    } else if (activeProvider) {
      // Provider is active — only use the provider-managed cc-haha settings.
      // This avoids leaking global ~/.claude/settings.json model choices into
      // the active provider flow.
      const providerEnvModel = env.ANTHROPIC_MODEL
      if (providerEnvModel && !explicitModel) {
        currentModelId = providerEnvModel
        currentModelName = providerEnvModel
      } else {
        currentModelId = explicitModel || providerEnvModel || activeProvider.models.main
        currentModelName = currentModelId
      }
    } else {
      // No provider — use settings model with context tier. DAL 目录未登录时
      // 为空，此处显式模型缺失即返回空 id，由 UI 展示"选择模型"。
      currentModelId = explicitModel || runtimeEnvModel || settingsEnvModel || DEFAULT_MODEL
      currentModelName = currentModelId
    }

    const lookupId = contextTier ? `${currentModelId}:${contextTier}` : currentModelId

    // Build available models for name lookup
    const availableModels = isOpenAIProviderActive
      ? await getOpenAIModelList()
      : isGrokProviderActive
        ? await getGrokModelList()
        : activeProvider
          ? buildProviderModelList(
              activeProvider.models,
              activeProvider.apiFormat,
              getPresetDefaultEnv(activeProvider.presetId),
              getPresetReasoningProviderKind(activeProvider.presetId),
            )
          : await getStandaloneModelList()

    const modelEntry = availableModels.find((m) => m.id === lookupId)
      || availableModels.find((m) => m.id === currentModelId)
      || {
        id: currentModelId,
        name: currentModelName,
        description: 'Custom model',
        context: contextTier || 'unknown',
      }

    return Response.json({ model: { ...modelEntry, context: contextTier || modelEntry.context } })
  }

  if (req.method === 'PUT') {
    const body = await parseJsonBody(req)
    const modelId = body.modelId
    if (typeof modelId !== 'string' || !modelId) {
      throw ApiError.badRequest('Missing or invalid "modelId" in request body')
    }

    // Parse composite IDs like 'claude-opus-4-7-20250610:1m'
    // Persist the base model ID for CLI compatibility and context tier separately
    const colonIdx = modelId.indexOf(':')
    const baseId = colonIdx !== -1 ? modelId.slice(0, colonIdx) : modelId
    const contextTier = colonIdx !== -1 ? modelId.slice(colonIdx + 1) : undefined

    const updates: Record<string, unknown> = { model: baseId }
    if (contextTier) {
      updates.modelContext = contextTier
    } else {
      // Clear context tier when switching to a non-composite model
      updates.modelContext = undefined
    }
    const { activeId } = await providerService.listProviders()
    if (activeId) {
      const currentManagedSettings = await providerService.getManagedSettings()
      const currentEnv =
        (currentManagedSettings.env as Record<string, string> | undefined) ?? {}
      await providerService.updateManagedSettings({
        ...updates,
        env: {
          ...currentEnv,
          ...attributionHeaderEnvForModel(baseId),
        },
      })
    } else {
      await settingsService.updateUserSettings(updates)
    }
    return Response.json({ ok: true, model: modelId })
  }

  throw methodNotAllowed(req.method)
}

async function handleEffort(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const settings = await settingsService.getUserSettings()
    const level = normalizeEffortLevel(settings.effort)
    return Response.json({ level, available: EFFORT_LEVELS })
  }

  if (req.method === 'PUT') {
    const body = await parseJsonBody(req)
    const level = body.level
    if (typeof level !== 'string') {
      throw ApiError.badRequest('Missing or invalid "level" in request body')
    }
    if (!EFFORT_LEVELS.includes(level as (typeof EFFORT_LEVELS)[number])) {
      throw ApiError.badRequest(
        `Invalid effort level: "${level}". Valid levels: ${EFFORT_LEVELS.join(', ')}`,
      )
    }
    await settingsService.updateUserSettings({ effort: level })
    return Response.json({ ok: true, level })
  }

  throw methodNotAllowed(req.method)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

function methodNotAllowed(method: string): ApiError {
  return new ApiError(405, `Method ${method} not allowed`, 'METHOD_NOT_ALLOWED')
}
