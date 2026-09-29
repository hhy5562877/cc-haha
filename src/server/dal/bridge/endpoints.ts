/**
 * dal-bridge HTTP 端点（宿主侧实现）。
 *
 * 两组路由，均由 src/server/router.ts 挂载：
 *
 * 1. `POST /api/internal/pi-bridge/*` — dal 进程 → 宿主
 *    鉴权：`x-dal-bridge-token` 头 == 该会话 buildDalBridgeEnv 注入的 token。
 *    - permission：非只读工具审批 → guard 模式评估 → 自动放行/拒绝，或转
 *      WS permission_request 交渲染端对话框，等待后回包（120s 超时拒绝）。
 *    - plan：submit_plan 计划审批 → 映射为 ExitPlanMode 权限请求复用计划 UI。
 *    - provider-fallback：模型回退通知 → 记录 + 广播系统通知，立即 200。
 *
 * 2. `POST /api/dal-bridge/respond` — 渲染端对话框 → 宿主
 *    鉴权：走 /api/* 既有 Bearer 体系。落地渲染端决定，resolve 等待中的
 *    dal 请求并向会话 WS 回发 permission_resolved 以清理对话框状态。
 *
 * 失败语义与 dal-bridge 客户端一致（fail-closed）：任何无法回包的路径都
 * 等价于拒绝——不可达的服务端不应该等于"静默放行"。
 */

import { sendToSession } from '../../ws/handler.js'
import { conversationService } from '../../services/conversationService.js'
import {
  allowRuleIdForSession,
  clearSessionAllowlist,
  evaluateBridgePermission,
  getGuardModeForSession,
  ruleIdForRespond,
  setGuardModeForSession,
} from './guardMode.js'
import {
  buildDalBridgeEnv,
  createPendingRequest,
  getPendingRequest,
  hasDalBridgeSession,
  isDalBridgeTokenValid,
  resolvePendingRequest,
} from './sessionStore.js'
import type {
  DalBridgePermissionVerdict,
  DalBridgePlanBody,
  DalBridgePermissionBody,
  DalGuardMode,
} from './types.js'

// ─── 通用工具 ──────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function invalidBody(message: string): Response {
  return json({ error: 'Invalid request body', message }, 400)
}

async function readJsonObject(req: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const body: unknown = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
    return body as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** 从路径段解析会话 ID：/api/internal/pi-bridge/:sessionId/:action。
 * 会话 ID 放路径里让 token 校验有明确锚点（body 里的 sessionId 仅作二次核对）。 */
function extractSessionId(segments: string[]): string | undefined {
  const value = segments[3]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function bridgeToken(req: Request): string | undefined {
  const header = req.headers.get('x-dal-bridge-token')
  return header && header.length > 0 ? header : undefined
}

function sessionWorkDir(sessionId: string): string {
  try {
    return conversationService.getSessionWorkDir(sessionId) || ''
  } catch {
    return ''
  }
}

// ─── dal → 宿主 ────────────────────────────────────────────────────

/** 把一条审批请求投递到渲染端：复用既有 permission_request 消息字段。 */
function emitPermissionRequest(
  sessionId: string,
  requestId: string,
  toolName: string,
  input: unknown,
  description?: string,
): void {
  sendToSession(sessionId, {
    type: 'permission_request',
    requestId,
    toolName,
    input,
    ...(description ? { description } : {}),
  })
}

/** 落地后通知渲染端清理对话框状态（chatStore 对 permission_resolved 的
 * 处理与请求来源无关，bridge 请求复用同一通道）。 */
function emitPermissionResolved(sessionId: string, requestId: string, allowed: boolean): void {
  sendToSession(sessionId, {
    type: 'permission_resolved',
    requestId,
    permissionType: 'tool',
    allowed,
  })
}

/** 渲染端展示用的工具入参。bash 摘 command，其余原样透传。 */
function presentableInput(body: DalBridgePermissionBody): unknown {
  return body.toolInput && typeof body.toolInput === 'object' ? body.toolInput : {}
}

async function handlePermissionPost(
  sessionId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const payload: DalBridgePermissionBody = {
    sessionId,
    toolName: body.toolName,
    toolInput: body.toolInput,
    ruleContent: body.ruleContent,
  }
  const toolName = typeof payload.toolName === 'string' && payload.toolName.trim() ? payload.toolName.trim() : undefined
  if (!toolName) return invalidBody('toolName is required')

  const workDir = sessionWorkDir(sessionId)
  const verdict = evaluateBridgePermission(sessionId, payload, workDir)

  // 模式已裁定：无需人工，立即回包。
  if (verdict.action === 'allow') {
    return json({ decision: 'allow' } satisfies DalBridgePermissionVerdict)
  }
  if (verdict.action === 'deny') {
    return json({ decision: 'deny', message: verdict.message } satisfies DalBridgePermissionVerdict)
  }

  // 需要人工：登记 pending → 转渲染端 → 等待 respond 端点或 120s 超时。
  const handle = createPendingRequest(sessionId, 'permission', payload, verdict.ruleId)
  emitPermissionRequest(
    sessionId,
    handle.requestId,
    toolName,
    presentableInput(payload),
    typeof payload.ruleContent === 'string' && payload.ruleContent ? payload.ruleContent : undefined,
  )
  const resolved = await handle.promise
  return json(resolved as DalBridgePermissionVerdict)
}

/** 把 dal 的 submit_plan 参数格式化为计划预览 markdown（复用渲染端
 * ExitPlanModePermissionDialog 的 PlanPreviewCard 展示）。 */
function planToMarkdown(body: DalBridgePlanBody): string {
  const lines: string[] = []
  if (typeof body.goal === 'string' && body.goal.trim()) {
    lines.push(`**目标**：${body.goal.trim()}`, '')
  }
  if (typeof body.reasoning === 'string' && body.reasoning.trim()) {
    lines.push(`**理由**：${body.reasoning.trim()}`, '')
  }
  if (Array.isArray(body.steps) && body.steps.length > 0) {
    lines.push('**步骤**：', '')
    body.steps.forEach((step, index) => {
      const title = step && typeof step === 'object' && typeof (step as { title?: unknown }).title === 'string'
        ? (step as { title: string }).title
        : String(step ?? '')
      const description = step && typeof step === 'object' && typeof (step as { description?: unknown }).description === 'string'
        ? (step as { description: string }).description
        : ''
      lines.push(`${index + 1}. ${title}${description ? ` — ${description}` : ''}`)
    })
  }
  return lines.join('\n')
}

async function handlePlanPost(
  sessionId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const payload: DalBridgePlanBody = {
    sessionId,
    goal: body.goal,
    reasoning: body.reasoning,
    steps: body.steps,
  }

  const handle = createPendingRequest(sessionId, 'plan', payload)
  // toolName 用 ExitPlanMode：渲染端 PermissionDialog 检测到它即渲染计划审批
  // 卡片（PlanModePreview.isExitPlanModeTool），用户看到的是原生计划流程。
  emitPermissionRequest(sessionId, handle.requestId, 'ExitPlanMode', {
    plan: planToMarkdown(payload),
    allowedPrompts: [],
  }, typeof payload.goal === 'string' ? payload.goal : undefined)
  const resolved = await handle.promise
  const verdict = resolved as { decision?: string; feedback?: string }
  return json({
    decision: verdict.decision === 'execute' ? 'execute' : 'cancel',
    ...(verdict.feedback ? { feedback: verdict.feedback } : {}),
  })
}

async function handleProviderFallbackPost(
  sessionId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  // 仅记录与广播：回退在 dal 侧已被阻断（blocked: true），宿主不参与决策。
  const from = body.from && typeof body.from === 'object' ? body.from : {}
  const to = body.to && typeof body.to === 'object' ? body.to : {}
  const provider = (model: unknown) =>
    `${(model as { provider?: unknown }).provider ?? '?'}/${(model as { model?: unknown }).model ?? '?'}`
  console.warn(
    `[dal-bridge] provider fallback blocked for ${sessionId}: ${provider(from)} → ${provider(to)} (${String(body.reason ?? 'unknown')})`,
  )
  sendToSession(sessionId, {
    type: 'system_notification',
    subtype: 'dal_provider_fallback_blocked',
    message: `dal 已阻断模型自动降级：${provider(from)} → ${provider(to)}`,
    data: body,
  })
  return json({ ok: true })
}

// ─── 渲染端 → 宿主 ────────────────────────────────────────────────

async function handleRespondPost(body: Record<string, unknown>): Promise<Response> {
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
  const requestId = typeof body.requestId === 'string' ? body.requestId : undefined
  if (!sessionId || !requestId) return invalidBody('sessionId and requestId are required')
  if (!requestId.startsWith('dalbridge_')) return invalidBody('requestId is not a dal-bridge request')

  const pending = getPendingRequest(sessionId, requestId)
  if (!pending) {
    return json({ error: 'Unknown or already resolved request' }, 409)
  }

  const allowed = body.allowed === true

  // 计划审批：execute / cancel + 反馈；附带的模式切换立即生效于宿主评估器。
  if (pending.kind === 'plan') {
    const modeChange = typeof body.modeChange === 'string' ? body.modeChange : undefined
    if (allowed && modeChange) setGuardModeForSession(sessionId, modeChange)
    resolvePendingRequest(sessionId, requestId, {
      decision: allowed ? 'execute' : 'cancel',
      ...(typeof body.feedback === 'string' && body.feedback.trim() ? { feedback: body.feedback.trim() } : {}),
    })
    emitPermissionResolved(sessionId, requestId, allowed)
    return json({ ok: true })
  }

  // 权限审批。「本次会话内允许（同类操作）」按 ruleId 记入会话 allowlist。
  if (allowed && body.alwaysAllow === true && pending.ruleId) {
    allowRuleIdForSession(sessionId, pending.ruleId)
  }
  resolvePendingRequest(sessionId, requestId, {
    decision: allowed ? 'allow' : 'deny',
    ...(allowed ? {} : { message: typeof body.denyMessage === 'string' && body.denyMessage.trim() ? body.denyMessage.trim() : '用户已拒绝该操作。' }),
  })
  emitPermissionResolved(sessionId, requestId, allowed)
  return json({ ok: true })
}

// ─── 路由入口（router.ts 挂载） ────────────────────────────────────

/**
 * 处理 dal-bridge 相关 HTTP 请求。
 *
 * @param segments pathname 按 '/' 切分并过滤空段后的数组
 *   - dal 侧：['api', 'internal', 'pi-bridge', sessionId, action]
 *   - 渲染端：['api', 'dal-bridge', 'respond']
 */
export async function handleDalBridgeRoute(req: Request, segments: string[]): Promise<Response> {
  // 渲染端回包端点：走 /api/* 既有鉴权（router 层之前已处理），无需 bridge token。
  if (segments[1] === 'dal-bridge') {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    if (segments[2] !== 'respond') return json({ error: 'Not Found' }, 404)
    const body = await readJsonObject(req)
    if (!body) return invalidBody('JSON object required')
    return handleRespondPost(body)
  }

  // dal 侧端点：/api/internal/pi-bridge/:sessionId/:action
  if (segments[1] === 'internal' && segments[2] === 'pi-bridge') {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    const sessionId = extractSessionId(segments)
    const action = segments[4]
    if (!sessionId || !action) return json({ error: 'Not Found' }, 404)

    // 双重核对：路径会话必须存在 bridge 状态（spawn 时经 buildDalBridgeEnv 注册），
    // token 必须匹配该会话——一个 dal 进程不能替另一个会话审批。
    if (!hasDalBridgeSession(sessionId) || !isDalBridgeTokenValid(sessionId, bridgeToken(req))) {
      return json({ error: 'Unauthorized' }, 401)
    }
    // body.sessionId（dal 的 pi session id）与宿主会话 ID 不同源，仅记录不校验。

    const parsed = await readJsonObject(req)
    if (!parsed) return invalidBody('JSON object required')

    switch (action) {
      case 'permission':
        return handlePermissionPost(sessionId, parsed)
      case 'plan':
        return handlePlanPost(sessionId, parsed)
      case 'provider-fallback':
        return handleProviderFallbackPost(sessionId, parsed)
      default:
        return json({ error: 'Not Found' }, 404)
    }
  }

  return json({ error: 'Not Found' }, 404)
}

// ─── 供 proto 适配层调用的生命周期钩子 ─────────────────────────────

export { buildDalBridgeEnv, cleanupDalBridgeSession } from './sessionStore.js'
export {
  setGuardModeForSession,
  getGuardModeForSession,
  clearGuardModeForSession,
  clearSessionAllowlist,
} from './guardMode.js'
export type { DalGuardMode }
