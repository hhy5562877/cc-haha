/**
 * DAL Code CLI ↔ 桌面 server 的进程内 SDK 协议适配器。
 *
 * 背景：桌面端原有链路是 spawn 内置 Claude CLI，CLI 以 WebSocket 反连 server 的
 * /sdk/<sessionId> 端点，双向收发 Anthropic stream-json 消息（见
 * conversationService.handleSdkPayload / sendSdkMessage）。DAL CLI 不讲这套协议，
 * 它提供 `--mode rpc`（stdin/stdout JSONL：命令进、响应+事件出）。
 *
 * 本适配器让 server 直接 spawn dal，并在进程内扮演「CLI 那一侧」：
 *  - 对上：把 dal 的 stdout 事件翻译成原 SDK 消息帧，回灌 handleSdkPayload，
 *    使 handler.ts（5250 行）与 SessionProcess 簿记零改动；
 *  - 对下：把 sendSdkMessage 发出的服务端帧（user / control_request / ...）
 *    翻译成 dal RPC 命令写入其 stdin。
 *
 * 权限审批不走 can_use_tool：spawn 时注入 DALCODE_BRIDGE_URL/TOKEN 后 dal-guard
 * 让位，审批经 dal-bridge HTTP 回路（src/server/dal/bridge）。
 *
 * 分帧纪律（docs/rpc.md Framing）：严格按 \n 切分、容忍尾部 \r；
 * 禁用任何 readline 实现（U+2028/2029 会把 JSON 内文错误断行）。
 */

import type { Subprocess } from 'bun'

/** dal RPC 命令（stdin），与 packages/coding-agent/src/modes/rpc/rpc-types.ts 对齐 */
type DalRpcCommand = Record<string, unknown> & { type: string; id?: string }

/** dal RPC 响应（stdout） */
interface DalRpcResponse {
  id?: string
  type: 'response'
  command: string
  success: boolean
  data?: unknown
  error?: string
}

/** extension_ui_request（stdout，扩展请求宿主 UI） */
interface DalExtensionUiRequest {
  type: 'extension_ui_request'
  id: string
  method: string
  [key: string]: unknown
}

/** dal 使用量（packages/ai types.ts Usage） */
interface DalUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  totalTokens?: number
}

/** dal 助手消息内容块（packages/ai types.ts） */
interface DalContentBlock {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  arguments?: unknown
  [key: string]: unknown
}

/** dal 消息（AgentMessage：user / assistant / toolResult，role 为 camelCase） */
interface DalAgentMessage {
  role: string
  content?: string | DalContentBlock[]
  stopReason?: string
  errorMessage?: string
  usage?: DalUsage
  model?: string
  provider?: string
  [key: string]: unknown
}

/** dal 工具结果消息 */
interface DalToolResultMessage {
  role: 'toolResult'
  toolCallId?: string
  toolName?: string
  content?: string | DalContentBlock[]
  isError?: boolean
  [key: string]: unknown
}

/** RpcSessionState（get_state 响应 data） */
interface DalSessionState {
  model?: { id?: string; provider?: string; name?: string } | null
  thinkingLevel?: string
  isStreaming?: boolean
  sessionId?: string
  sessionFile?: string
  sessionName?: string
  [key: string]: unknown
}

export interface DalSdkAdapterOptions {
  sessionId: string
  /** dal 子进程（rpc 模式） */
  proc: Subprocess<'pipe', 'pipe', 'pipe'>
  /** 工作目录（用于 init 帧） */
  workDir: string
  /** 翻译后的 SDK 帧（JSON 字符串）回灌给 conversationService.handleSdkPayload */
  onSdkMessage: (rawFrame: string) => void
  /** 进程退出/适配器终止时的清理通知 */
  onExit?: (code: number | null) => void
}

const EMPTY_USAGE = { input_tokens: 0, output_tokens: 0 }

let messageIdSeq = 0
function nextMessageId(): string {
  messageIdSeq += 1
  return `dal_msg_${Date.now().toString(36)}_${messageIdSeq}`
}

let frameSeq = 0
function nextFrameUuid(): string {
  frameSeq += 1
  return `dal_frame_${Date.now().toString(36)}_${frameSeq}`
}

/** dal 思考等级全集（ThinkingLevel） */
export const DAL_THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

export class DalSdkAdapter {
  private readonly sessionId: string
  private readonly proc: DalSdkAdapterOptions['proc']
  private readonly workDir: string
  private readonly onSdkMessage: DalSdkAdapterOptions['onSdkMessage']
  private readonly onExit?: DalSdkAdapterOptions['onExit']

  private disposed = false
  private stdoutBuffer = ''
  private commandSeq = 0
  private readonly pendingCommands = new Map<
    string,
    { resolve: (data: unknown, success: boolean, error?: string) => void; timer: ReturnType<typeof setTimeout> }
  >()

  /** 会话运行态（每个 agent run 重置） */
  private isStreaming = false
  private inAssistantStream = false
  private currentAssistantMessageId: string | null = null
  private readonly startedBlockIndexes = new Set<number>()
  private runUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  private runTurnCount = 0
  private runStartedAt = 0
  private firstTokenAt = 0
  private lastApiError: string | undefined
  private sessionState: DalSessionState = {}
  private initEmitted = false
  private readonly pendingServerFrames: string[] = []

  constructor(options: DalSdkAdapterOptions) {
    this.sessionId = options.sessionId
    this.proc = options.proc
    this.workDir = options.workDir
    this.onSdkMessage = options.onSdkMessage
    this.onExit = options.onExit
  }

  // ==========================================================================
  // 生命周期
  // ==========================================================================

  /** 启动 stdout/stderr 读取与初始化握手。必须在 spawn 后立即调用。 */
  start(): void {
    void this.readStdout()
    void this.readStderr()
    // 尽快取一次状态用于 init 帧；失败不阻塞（init 有兜底定时器）。
    void this.refreshStateThenEmitInit()
    setTimeout(() => {
      if (!this.initEmitted && !this.disposed) this.emitInit()
    }, 1500).unref?.()
  }

  dispose(code: number | null = null): void {
    if (this.disposed) return
    this.disposed = true
    for (const [, pending] of this.pendingCommands) {
      clearTimeout(pending.timer)
      pending.resolve(undefined, false, 'DAL_EXITED')
    }
    this.pendingCommands.clear()
    this.onExit?.(code)
  }

  // ==========================================================================
  // dal stdin：RPC 命令发送
  // ==========================================================================

  private sendCommand(command: Omit<DalRpcCommand, 'id'> & { id?: string }, timeoutMs = 15000): Promise<{ success: boolean; data?: unknown; error?: string }> {
    if (this.disposed || !this.proc.stdin) {
      return Promise.resolve({ success: false, error: 'DAL_NOT_RUNNING' })
    }
    const id = command.id ?? `cmd_${++this.commandSeq}`
    const line = JSON.stringify({ ...command, id }) + '\n'
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(id)
        resolve({ success: false, error: `DAL_COMMAND_TIMEOUT:${command.type}` })
      }, timeoutMs)
      this.pendingCommands.set(id, { resolve: (data, success, error) => resolve({ success, data, error }), timer })
      try {
        this.proc.stdin.write(line)
        this.proc.stdin.flush()
      } catch (error) {
        clearTimeout(timer)
        this.pendingCommands.delete(id)
        resolve({ success: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
  }

  // ==========================================================================
  // 服务端帧（sendSdkMessage → 假 socket）→ dal 命令
  // ==========================================================================

  /**
   * conversationService.sendSdkMessage 经假 socket 到达这里。
   * rawPayload 与 SDK WS 出站帧同构（单条 JSON + \n）。
   */
  handleServerPayload(rawPayload: string): void {
    if (this.disposed) return
    for (const line of rawPayload.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(trimmed) as Record<string, unknown>
      } catch {
        console.warn(`[DalAdapter:${this.sessionId}] ignoring malformed server frame`)
        continue
      }
      void this.handleServerFrame(frame)
    }
  }

  private async handleServerFrame(frame: Record<string, unknown>): Promise<void> {
    const type = frame.type
    if (type === 'user') {
      this.handleServerUserMessage(frame)
      return
    }
    if (type === 'control_request') {
      await this.handleServerControlRequest(frame)
      return
    }
    // control_response（can_use_tool 的回包，桥接管后不会出现）、
    // update_environment_variables、control_cancel_request 等一概忽略。
  }

  private handleServerUserMessage(frame: Record<string, unknown>): void {
    const message = frame.message as { role?: string; content?: unknown } | undefined
    const { text, images } = extractUserContent(message?.content)
    if (!text && images.length === 0) return

    // 回放确认：原 CLI 由 --replay-user-messages 回显用户消息（isReplay:true），
    // handler 靠它确认乐观消息。这里原样回显即可。
    this.emitSdk({
      type: 'user',
      ...(typeof frame.uuid === 'string' ? { uuid: frame.uuid } : { uuid: nextFrameUuid() }),
      isReplay: true,
      session_id: this.sessionId,
      message: { role: 'user', content: message?.content ?? text },
    })

    const command: DalRpcCommand = {
      type: 'prompt',
      message: text,
      ...(images.length > 0 ? { images } : {}),
      // streamingBehavior 缺省在流式期间会报错：闲置发 prompt，忙时按 steer 注入。
      ...(this.isStreaming ? { streamingBehavior: 'steer' } : {}),
    }
    void this.sendCommand(command).then((result) => {
      if (!result.success) {
        console.error(`[DalAdapter:${this.sessionId}] prompt rejected: ${result.error ?? 'unknown'}`)
        this.lastApiError = result.error
      }
    })
  }

  private async handleServerControlRequest(frame: Record<string, unknown>): Promise<void> {
    const requestId = typeof frame.request_id === 'string' ? frame.request_id : nextFrameUuid()
    const request = (frame.request ?? {}) as Record<string, unknown>
    const subtype = request.subtype
    let ok = true

    if (subtype === 'interrupt') {
      const result = await this.sendCommand({ type: 'abort' })
      ok = result.success
    } else if (subtype === 'set_max_thinking_tokens') {
      const tokens = request.max_thinking_tokens
      const level = typeof tokens === 'number' && Number.isFinite(tokens)
        ? (tokens <= 0 ? 'off' : tokens < 4096 ? 'low' : 'high')
        : 'medium'
      const result = await this.sendCommand({ type: 'set_thinking_level', level })
      ok = result.success
    } else {
      // 未知控制请求：确认成功避免服务端等待悬挂（权限类由审批桥接管）。
      ok = true
    }

    this.emitSdk({
      type: 'control_response',
      request_id: requestId,
      response: {
        subtype: ok ? 'success' : 'error',
        request_id: requestId,
        ...(ok ? { response: {} } : { error: 'dal command failed' }),
      },
    })
  }

  // ==========================================================================
  // dal stdout：响应 + 事件 → SDK 帧
  // ==========================================================================

  private async readStdout(): Promise<void> {
    const stream = this.proc.stdout as ReadableStream<Uint8Array> | null
    if (!stream) {
      this.dispose(null)
      return
    }
    const reader = (stream as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        this.stdoutBuffer += decoder.decode(value, { stream: true })
        let newlineIndex = this.stdoutBuffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '')
          this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)
          if (line.trim()) this.handleStdoutLine(line)
          newlineIndex = this.stdoutBuffer.indexOf('\n')
        }
      }
    } catch {
      // 进程被杀时读取会抛错，属正常退出路径。
    } finally {
      this.dispose(null)
    }
  }

  private async readStderr(): Promise<void> {
    const stream = this.proc.stderr as ReadableStream<Uint8Array> | null
    if (!stream) return
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true }).trim()
        if (text) console.error(`[DalAdapter:${this.sessionId}:stderr] ${text}`)
      }
    } catch {
      // 忽略 stderr 读取错误。
    }
  }

  private handleStdoutLine(line: string): void {
    let frame: Record<string, unknown>
    try {
      frame = JSON.parse(line) as Record<string, unknown>
    } catch {
      console.log(`[DalAdapter:${this.sessionId}:stdout] ${line.slice(0, 400)}`)
      return
    }

    if (frame.type === 'response') {
      this.handleRpcResponse(frame as unknown as DalRpcResponse)
      return
    }
    if (frame.type === 'extension_ui_request') {
      this.handleExtensionUiRequest(frame as unknown as DalExtensionUiRequest)
      return
    }
    this.handleSessionEvent(frame)
  }

  private handleRpcResponse(response: DalRpcResponse): void {
    if (response.command === 'get_state' && response.success && response.data) {
      this.sessionState = response.data as DalSessionState
    }
    const pending = response.id ? this.pendingCommands.get(response.id) : undefined
    if (pending) {
      clearTimeout(pending.timer)
      this.pendingCommands.delete(response.id ?? '')
      pending.resolve(response.data, response.success, response.error)
      return
    }
    if (!response.success) {
      console.warn(`[DalAdapter:${this.sessionId}] rpc ${response.command} failed: ${response.error}`)
      if (response.command === 'prompt') this.lastApiError = response.error
    }
  }

  /**
   * 阻塞式扩展 UI 请求（select/confirm/input/...）在桌面端 v1 尚无专用通道，
   * 立即 cancelled 回包避免 dal 卡死；notify/setStatus 等单向通知直接忽略。
   */
  private handleExtensionUiRequest(request: DalExtensionUiRequest): void {
    const blocking = ['select', 'confirm', 'input', 'editor', 'requestInput', 'requestChoice']
    if (!blocking.includes(request.method)) return
    console.warn(`[DalAdapter:${this.sessionId}] extension_ui_request ${request.method} auto-cancelled (no desktop channel yet)`)
    void this.writeRawStdin({ type: 'extension_ui_response', id: request.id, cancelled: true })
  }

  private async writeRawStdin(payload: Record<string, unknown>): Promise<void> {
    if (this.disposed || !this.proc.stdin) return
    try {
      this.proc.stdin.write(JSON.stringify(payload) + '\n')
      this.proc.stdin.flush()
    } catch (error) {
      console.warn(`[DalAdapter:${this.sessionId}] stdin write failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ==========================================================================
  // 会话事件翻译（AgentSessionEvent-json → SDK stream-json）
  // ==========================================================================

  private handleSessionEvent(event: Record<string, unknown>): void {
    switch (event.type) {
      case 'agent_start':
        this.isStreaming = true
        this.runUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
        this.runTurnCount = 0
        this.runStartedAt = Date.now()
        this.firstTokenAt = 0
        this.lastApiError = undefined
        break

      case 'message_start': {
        const message = event.message as DalAgentMessage | undefined
        if (message?.role === 'assistant') {
          this.beginAssistantStream()
        }
        break
      }

      case 'message_update': {
        // json 紧凑形态：{usage, assistantMessageEvent:{type, contentIndex, delta?, id?, toolName?}}
        const deltaEvent = event.assistantMessageEvent as Record<string, unknown> | undefined
        if (deltaEvent) this.handleAssistantDelta(deltaEvent)
        const usage = event.usage as DalUsage | undefined
        if (usage) this.runUsage = normalizeUsage(usage)
        break
      }

      case 'message_end': {
        const message = event.message as DalAgentMessage | undefined
        if (message?.role === 'assistant') this.finishAssistantStream(message)
        break
      }

      case 'turn_end':
        this.runTurnCount += 1
        {
          const toolResults = (event.toolResults ?? []) as DalToolResultMessage[]
          for (const toolResult of toolResults) this.emitToolResultFrame(toolResult)
        }
        break

      case 'agent_end': {
        this.isStreaming = false
        this.endAssistantStreamIfOpen()
        const willRetry = event.willRetry === true
        if (!willRetry) this.emitResultFrame(event.messages as DalAgentMessage[] | undefined)
        break
      }

      case 'compaction_start':
        this.emitSdk({ type: 'system', subtype: 'status', status: 'compacting', uuid: nextFrameUuid(), session_id: this.sessionId })
        break

      case 'compaction_end':
        this.emitSdk({ type: 'system', subtype: 'status', status: null, uuid: nextFrameUuid(), session_id: this.sessionId })
        break

      case 'auto_retry_start':
        this.emitSdk({
          type: 'system',
          subtype: 'api_retry',
          attempt: typeof event.attempt === 'number' ? event.attempt : 1,
          max_retries: typeof event.maxAttempts === 'number' ? event.maxAttempts : 3,
          retry_delay_ms: typeof event.delayMs === 'number' ? event.delayMs : 0,
          error: typeof event.errorMessage === 'string' ? { message: event.errorMessage } : undefined,
          uuid: nextFrameUuid(),
          session_id: this.sessionId,
        })
        break

      default:
        // turn_start / agent_settled / queue_update / entry_appended /
        // session_info_changed / thinking_level_changed / bash_execution_update
        // 等在 v1 桌面链路无消费者。
        break
    }
  }

  private beginAssistantStream(): void {
    if (this.inAssistantStream) this.endAssistantStreamIfOpen()
    this.inAssistantStream = true
    this.currentAssistantMessageId = nextMessageId()
    this.startedBlockIndexes.clear()
    if (!this.firstTokenAt) this.firstTokenAt = Date.now()
    this.emitStreamEvent({
      type: 'message_start',
      index: 0,
      message: {
        id: this.currentAssistantMessageId,
        type: 'message',
        role: 'assistant',
        model: this.currentModelId(),
        content: [],
        stop_reason: null,
        usage: { ...EMPTY_USAGE },
      },
    })
  }

  private handleAssistantDelta(deltaEvent: Record<string, unknown>): void {
    if (!this.inAssistantStream) this.beginAssistantStream()
    const index = typeof deltaEvent.contentIndex === 'number' ? deltaEvent.contentIndex : 0
    switch (deltaEvent.type) {
      case 'text_delta': {
        this.ensureTextBlockStarted(index, 'text')
        this.emitStreamEvent({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: String(deltaEvent.delta ?? '') } })
        break
      }
      case 'thinking_delta': {
        this.ensureTextBlockStarted(index, 'thinking')
        this.emitStreamEvent({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: String(deltaEvent.delta ?? '') } })
        break
      }
      case 'toolcall_start': {
        // {contentIndex, id, toolName}
        if (this.startedBlockIndexes.has(index)) break
        this.startedBlockIndexes.add(index)
        this.emitStreamEvent({
          type: 'content_block_start',
          index,
          content_block: { type: 'tool_use', id: String(deltaEvent.id ?? nextFrameUuid()), name: String(deltaEvent.toolName ?? 'unknown') },
        })
        break
      }
      case 'toolcall_delta': {
        this.emitStreamEvent({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: String(deltaEvent.delta ?? '') } })
        break
      }
      case 'toolcall_end': {
        if (!this.startedBlockIndexes.has(index)) {
          // 未流式过 start（理论少见）：补一个 start 让 handler 能配对 stop。
          const toolCall = deltaEvent.toolCall as DalContentBlock | undefined
          this.startedBlockIndexes.add(index)
          this.emitStreamEvent({
            type: 'content_block_start',
            index,
            content_block: { type: 'tool_use', id: String(toolCall?.id ?? nextFrameUuid()), name: String(toolCall?.name ?? 'unknown') },
          })
        }
        this.startedBlockIndexes.delete(index)
        this.emitStreamEvent({ type: 'content_block_stop', index })
        break
      }
      default:
        break
    }
  }

  private ensureTextBlockStarted(index: number, blockType: 'text' | 'thinking'): void {
    if (this.startedBlockIndexes.has(index)) return
    this.startedBlockIndexes.add(index)
    this.emitStreamEvent({ type: 'content_block_start', index, content_block: { type: blockType } })
  }

  private finishAssistantStream(message: DalAgentMessage): void {
    if (!this.inAssistantStream) {
      // 从未流式（如非流式回退）：先起一个流骨架让 handler 状态一致。
      this.beginAssistantStream()
    }
    // 收尾未关闭的块。
    for (const index of [...this.startedBlockIndexes].sort((a, b) => b - a)) {
      this.emitStreamEvent({ type: 'content_block_stop', index })
    }
    this.startedBlockIndexes.clear()
    this.emitStreamEvent({ type: 'message_delta', delta: { stop_reason: mapStopReason(message.stopReason) }, usage: toSdkUsage(message.usage) })
    this.emitStreamEvent({ type: 'message_stop' })

    const content: DalContentBlock[] = Array.isArray(message.content) ? message.content : []
    this.emitSdk({
      type: 'assistant',
      uuid: nextFrameUuid(),
      session_id: this.sessionId,
      message: {
        id: this.currentAssistantMessageId ?? nextMessageId(),
        type: 'message',
        role: 'assistant',
        model: typeof message.model === 'string' ? message.model : this.currentModelId(),
        content: content.map(mapAssistantBlock),
        stop_reason: mapStopReason(message.stopReason),
        stop_sequence: null,
        usage: toSdkUsage(message.usage),
      },
      ...(typeof message.provider === 'string' ? { provider: message.provider } : {}),
    })
    this.inAssistantStream = false
    this.currentAssistantMessageId = null
  }

  private endAssistantStreamIfOpen(): void {
    if (!this.inAssistantStream) return
    for (const index of [...this.startedBlockIndexes].sort((a, b) => b - a)) {
      this.emitStreamEvent({ type: 'content_block_stop', index })
    }
    this.startedBlockIndexes.clear()
    this.emitStreamEvent({ type: 'message_stop' })
    this.inAssistantStream = false
    this.currentAssistantMessageId = null
  }

  private emitToolResultFrame(toolResult: DalToolResultMessage): void {
    const toolUseId = typeof toolResult.toolCallId === 'string' ? toolResult.toolCallId : undefined
    if (!toolUseId) return
    this.emitSdk({
      type: 'user',
      uuid: nextFrameUuid(),
      session_id: this.sessionId,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            ...(toolResult.content !== undefined ? { content: mapToolResultContent(toolResult.content) } : {}),
            is_error: toolResult.isError === true,
          },
        ],
      },
    })
  }

  private emitResultFrame(messages: DalAgentMessage[] | undefined): void {
    const lastAssistant = [...(messages ?? [])].reverse().find((message) => message?.role === 'assistant')
    const stopReason = lastAssistant?.stopReason
    const isError = stopReason === 'error' || Boolean(this.lastApiError)
    const aborted = stopReason === 'aborted'
    const resultText = extractLastAssistantText(lastAssistant)
    const now = Date.now()
    const durationMs = this.runStartedAt ? now - this.runStartedAt : 0

    this.emitSdk({
      type: 'result',
      uuid: nextFrameUuid(),
      session_id: this.sessionId,
      subtype: isError && !aborted ? 'error_during_execution' : 'success',
      is_error: isError && !aborted,
      ...(isError && !aborted
        ? { result: this.lastApiError || lastAssistant?.errorMessage || 'DAL agent run failed' }
        : { result: resultText }),
      usage: this.runUsage.input || this.runUsage.output
        ? {
            input_tokens: this.runUsage.input,
            output_tokens: this.runUsage.output,
            cache_read_input_tokens: this.runUsage.cacheRead,
            cache_creation_input_tokens: this.runUsage.cacheWrite,
          }
        : { ...EMPTY_USAGE },
      duration_ms: durationMs,
      duration_api_ms: durationMs,
      num_turns: this.runTurnCount,
    })
    this.lastApiError = undefined
  }

  // ==========================================================================
  // init / 状态
  // ==========================================================================

  private async refreshStateThenEmitInit(): Promise<void> {
    const result = await this.sendCommand({ type: 'get_state' }, 8000)
    if (result.success && result.data) {
      this.sessionState = result.data as DalSessionState
    }
    if (!this.initEmitted && !this.disposed) this.emitInit()
  }

  private emitInit(): void {
    if (this.initEmitted || this.disposed) return
    this.initEmitted = true
    this.emitSdk({
      type: 'system',
      subtype: 'init',
      session_id: this.sessionId,
      model: this.currentModelId(),
      cwd: this.workDir,
      tools: [],
      slash_commands: [],
      permissionMode: 'default',
      api_key_source: 'dal_gateway',
      uuid: nextFrameUuid(),
    })
  }

  private currentModelId(): string {
    const model = this.sessionState.model
    if (!model) return 'dalcode-gateway'
    if (typeof model.id === 'string' && model.id) {
      return typeof model.provider === 'string' && model.provider ? `${model.provider}/${model.id}` : model.id
    }
    return 'dalcode-gateway'
  }

  // ==========================================================================
  // SDK 帧输出
  // ==========================================================================

  private emitSdk(frame: Record<string, unknown>): void {
    if (this.disposed) return
    if (!this.initEmitted && frame.type !== 'system') {
      // init 之前的帧先排队，保证 handler 先看到 init。
      this.pendingServerFrames.push(JSON.stringify(frame))
      return
    }
    this.rawEmit(frame)
    while (this.pendingServerFrames.length > 0) {
      const pending = this.pendingServerFrames.shift()
      if (pending) this.rawEmitJson(pending)
    }
  }

  private emitStreamEvent(event: Record<string, unknown>): void {
    this.emitSdk({
      type: 'stream_event',
      uuid: nextFrameUuid(),
      session_id: this.sessionId,
      parent_tool_use_id: undefined,
      event,
    })
  }

  private rawEmit(frame: Record<string, unknown>): void {
    this.rawEmitJson(JSON.stringify(frame))
  }

  private rawEmitJson(json: string): void {
    try {
      this.onSdkMessage(json)
    } catch (error) {
      console.warn(`[DalAdapter:${this.sessionId}] onSdkMessage callback failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

// ============================================================================
// 纯映射工具
// ============================================================================

function normalizeUsage(usage: DalUsage | undefined): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  return {
    input: Number(usage?.input ?? 0) || 0,
    output: Number(usage?.output ?? 0) || 0,
    cacheRead: Number(usage?.cacheRead ?? 0) || 0,
    cacheWrite: Number(usage?.cacheWrite ?? 0) || 0,
  }
}

function toSdkUsage(usage: DalUsage | undefined): Record<string, number> {
  const normalized = normalizeUsage(usage)
  if (!normalized.input && !normalized.output) return { ...EMPTY_USAGE }
  return {
    input_tokens: normalized.input,
    output_tokens: normalized.output,
    cache_read_input_tokens: normalized.cacheRead,
    cache_creation_input_tokens: normalized.cacheWrite,
  }
}

function mapStopReason(stopReason: unknown): string {
  if (stopReason === 'toolUse') return 'tool_use'
  if (stopReason === 'length') return 'max_tokens'
  if (stopReason === 'error') return 'error'
  if (stopReason === 'aborted') return 'end_turn'
  return 'end_turn'
}

function mapAssistantBlock(block: DalContentBlock): Record<string, unknown> {
  if (block.type === 'toolCall') {
    return {
      type: 'tool_use',
      id: typeof block.id === 'string' ? block.id : nextFrameUuid(),
      name: typeof block.name === 'string' ? block.name : 'unknown',
      input: block.arguments ?? {},
    }
  }
  if (block.type === 'thinking') {
    return { type: 'thinking', thinking: typeof block.thinking === 'string' ? block.thinking : '' }
  }
  return { type: 'text', text: typeof block.text === 'string' ? block.text : '' }
}

function mapToolResultContent(content: string | DalContentBlock[]): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content
  return content.map((block) => {
    if (block.type === 'image') {
      return { type: 'image', data: block.data, mimeType: block.mimeType }
    }
    return { type: 'text', text: typeof block.text === 'string' ? block.text : '' }
  })
}

function extractUserContent(content: unknown): { text: string; images: Array<{ data: string; mimeType: string }> } {
  if (typeof content === 'string') return { text: content, images: [] }
  if (!Array.isArray(content)) return { text: '', images: [] }
  const texts: string[] = []
  const images: Array<{ data: string; mimeType: string }> = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') {
      texts.push(record.text)
    } else if (record.type === 'image') {
      // Anthropic 形态 {source:{type:'base64',media_type,data}} 与 dal 形态 {data,mimeType} 都兼容。
      const source = record.source as { data?: unknown; media_type?: unknown } | undefined
      const data = typeof record.data === 'string' ? record.data : typeof source?.data === 'string' ? source.data : undefined
      const mimeType = typeof record.mimeType === 'string'
        ? record.mimeType
        : typeof source?.media_type === 'string' ? source.media_type : 'image/png'
      if (data) images.push({ data, mimeType })
    }
  }
  return { text: texts.join('\n'), images }
}

function extractLastAssistantText(message: DalAgentMessage | undefined): string {
  if (!message) return ''
  const content = Array.isArray(message.content) ? message.content : []
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
    .trim()
}
