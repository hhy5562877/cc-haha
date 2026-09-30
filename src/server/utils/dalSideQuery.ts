/**
 * DAL 网关版一次性模型查询（分类器/解释器的 DAL 语义重设计）。
 *
 * 原 sideQuery 走引擎 Anthropic Messages API（OAuth+betas+归因头）；
 * 本实现改为对 DAL 网关（OpenAI 兼容 /v1/chat/completions）的一次性调用，
 * 输入沿用 SideQueryOptions 的必要子集，输出映射回 BetaMessage 形状，
 * 使 yoloClassifier / permissionExplainer 的解析逻辑无需改动。
 *
 * 支持特性：system(串/文本块)、messages(文本+base64图像块)、tools/tool_choice、
 * output_format(json_schema/json_object)、stop_sequences、temperature、max_tokens、
 * maxRetries(简单重试)、signal。
 * 不支持（分类器不使用）：cache_control（静默剥除）、thinking（静默降级为不启用）。
 *
 * 模型解析优先级：opts.model → ANTHROPIC_MODEL env → 网关模型目录首个。
 * 网关凭据经 dalAuthService（与 spawn 注入同一来源）。
 */
import { dalAuthService } from '../services/dalAuthService.js'
import { normalizeAnthropicBaseUrl } from '../services/api/anthropicBaseUrl.js'

type TextBlockParam = { type: 'text'; text: string }
type ImageBlockParam = {
  type: 'image'
  source: { type: string; media_type?: string; data?: string; url?: string }
}
type ContentBlock = TextBlockParam | ImageBlockParam
type ToolParam = { name: string; description?: string; input_schema: unknown }
type ToolChoiceParam = { type: 'tool'; name: string }
type JSONOutputFormat =
  | { type: 'json_schema'; json_schema: { name: string; schema: unknown } }
  | { type: 'json_object' }

export type DalSideQueryOptions = {
  model?: string
  system?: string | ContentBlock[]
  messages: Array<{ role: string; content: string | ContentBlock[] }>
  tools?: ToolParam[]
  tool_choice?: ToolChoiceParam
  output_format?: JSONOutputFormat
  stop_sequences?: string[]
  max_tokens?: number
  temperature?: number
  maxRetries?: number
  signal?: AbortSignal
}

export type DalBetaMessage = {
  id: string
  type: 'message'
  role: 'assistant'
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
  >
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null
  model: string
  usage: { input_tokens: number; output_tokens: number }
}

let cachedGateway: { url: string; token: string } | null = null

async function resolveGateway(): Promise<{ url: string; token: string }> {
  if (cachedGateway) return cachedGateway
  const env = await dalAuthService.getSpawnEnv()
  const url = env?.DALCODE_GATEWAY_URL
  const token = env?.DALCODE_GATEWAY_TOKEN
  if (!url || !token) throw new Error('DAL gateway is not configured (missing DALCODE_GATEWAY_URL/TOKEN)')
  cachedGateway = { url: normalizeAnthropicBaseUrl(url) || url, token }
  return cachedGateway
}

function contentBlockToOpenAI(block: ContentBlock): unknown | null {
  if (block.type === 'text') return { type: 'text', text: block.text }
  if (block.type === 'image') {
    const src = block.source ?? (block as unknown as { source?: { data?: string; media_type?: string } }).source
    const data = src?.data ?? (block as unknown as { data?: string }).data
    const media = src?.media_type ?? (block as unknown as { media_type?: string }).media_type ?? 'image/png'
    if (data) return { type: 'image_url', image_url: { url: `data:${media};base64,${data}` } }
  }
  return null
}

function toOpenAIMessages(
  system: DalSideQueryOptions['system'],
  messages: DalSideQueryOptions['messages'],
): Array<{ role: string; content: unknown }> {
  const out: Array<{ role: string; content: unknown }> = []
  const sysText = typeof system === 'string'
    ? system
    : Array.isArray(system)
      ? system.map(block => (block.type === 'text' ? block.text : '')).filter(Boolean).join('\n')
      : undefined
  if (sysText) out.push({ role: 'system', content: sysText })
  for (const message of messages) {
    const content = message.content
    if (typeof content === 'string') {
      out.push({ role: message.role, content })
      continue
    }
    if (Array.isArray(content)) {
      const parts = content
        .map(block => contentBlockToOpenAI(block as ContentBlock))
        .filter(Boolean)
      if (parts.length === 1 && (parts[0] as { type: string }).type === 'text') {
        out.push({ role: message.role, content: (parts[0] as { text: string }).text })
      } else if (parts.length > 0) {
        out.push({ role: message.role, content: parts })
      }
      continue
    }
    out.push({ role: message.role, content: String(content ?? '') })
  }
  return out
}

async function resolveModel(opts: DalSideQueryOptions): Promise<string> {
  if (opts.model) return opts.model
  if (process.env.ANTHROPIC_MODEL) return process.env.ANTHROPIC_MODEL
  const { url, token } = await resolveGateway()
  const base = normalizeAnthropicBaseUrl(url)
  const res = await fetch(`${base}/models`, {
    headers: { authorization: `Bearer ${token}` },
    signal: opts.signal,
  })
  if (!res.ok) throw new Error(`DAL gateway model list failed: ${res.status}`)
  const body = await res.json() as { data?: Array<{ id?: string }> }
  const first = body.data?.find(m => typeof m.id === 'string')?.id
  if (!first) throw new Error('DAL gateway model list is empty')
  return first
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries: number,
): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, init)
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`DAL gateway query failed: ${res.status}`)
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
          continue
        }
      }
      return res
    } catch (error) {
      lastError = error
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
        continue
      }
    }
  }
  throw lastError
}

/**
 * DAL 网关一次性查询。
 * 返回 BetaMessage 形状（text / tool_use 块），供分类器既有解析逻辑直接消费。
 */
export async function dalSideQuery(opts: DalSideQueryOptions): Promise<DalBetaMessage> {
  const { url, token } = await resolveGateway()
  const base = normalizeAnthropicBaseUrl(url)
  const model = await resolveModel(opts)
  const openaiMessages = toOpenAIMessages(opts.system, opts.messages)

  const body: Record<string, unknown> = {
    model,
    messages: openaiMessages,
    max_tokens: opts.max_tokens ?? 1024,
  }
  if (opts.temperature !== undefined) body.temperature = opts.temperature
  if (opts.stop_sequences?.length) body.stop = opts.stop_sequences
  if (opts.tools?.length) {
    body.tools = opts.tools.map(tool => ({
      type: 'function',
      function: { name: tool.name, description: tool.description ?? '', parameters: tool.input_schema },
    }))
  }
  if (opts.tool_choice?.type === 'tool') {
    body.tool_choice = { type: 'function', function: { name: opts.tool_choice.name } }
  }
  if (opts.output_format?.type === 'json_schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: (opts.output_format.json_schema as { name?: string }).name ?? 'response',
        schema: opts.output_format.json_schema.schema,
        strict: false,
      },
    }
  } else if (opts.output_format?.type === 'json_object') {
    body.response_format = { type: 'json_object' }
  }

  const maxRetries = opts.maxRetries ?? 2
  const res = await fetchWithRetry(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  }, maxRetries)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`DAL gateway query failed: ${res.status} ${text.slice(0, 300)}`)
  }
  const payload = await res.json() as {
    id?: string
    model?: string
    choices?: Array<{
      message?: {
        content?: string | null
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
      }
      finish_reason?: string
    }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }

  const choice = payload.choices?.[0]
  const content: DalBetaMessage['content'] = []
  const messageText = choice?.message?.content
  if (messageText) content.push({ type: 'text', text: messageText })
  for (const call of choice?.message?.tool_calls ?? []) {
    let input: unknown = {}
    try {
      input = JSON.parse(call.function.arguments || '{}')
    } catch {
      input = {}
    }
    content.push({ type: 'tool_use', id: call.id, name: call.function.name, input })
  }
  if (content.length === 0) content.push({ type: 'text', text: '' })

  const stopReason = choice?.finish_reason
  const mappedStop: DalBetaMessage['stop_reason'] =
    stopReason === 'tool_calls' ? 'tool_use'
      : stopReason === 'length' ? 'max_tokens'
        : stopReason === 'stop' ? 'end_turn'
          : null

  return {
    id: payload.id ?? `dal-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    stop_reason: mappedStop,
    model: payload.model ?? model,
    usage: {
      input_tokens: payload.usage?.prompt_tokens ?? 0,
      output_tokens: payload.usage?.completion_tokens ?? 0,
    },
  }
}
