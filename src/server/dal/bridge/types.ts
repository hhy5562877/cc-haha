/**
 * dal-bridge 服务端契约类型。
 *
 * 契约来源：D:\Code\DAL-code-cli\packages\dal-bridge\src\{index,client}.ts（只读参考）。
 * dal 进程检测到 DALCODE_BRIDGE_URL + DALCODE_BRIDGE_TOKEN 环境变量后，
 * 以 HTTP POST + `x-dal-bridge-token` 头把审批请求发给宿主（本模块），
 * 客户端超时 150s，非 2xx / 超时 / 不可达一律视为拒绝（fail-closed）。
 */

/** dal-guard 的五种权限模式（packages/dal-guard/src/index.ts L62）。 */
export type DalGuardMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'yolo'

export const DAL_GUARD_MODES: readonly DalGuardMode[] = ['default', 'acceptEdits', 'plan', 'auto', 'yolo']

export function isDalGuardMode(value: unknown): value is DalGuardMode {
  return typeof value === 'string' && (DAL_GUARD_MODES as readonly string[]).includes(value)
}

/** dal-bridge 客户端建议服务端 120s 内响应（客户端自身 150s 超时）。 */
export const DAL_BRIDGE_RESPONSE_TIMEOUT_MS = 120_000

/** 宿主侧审批请求 ID 前缀：渲染端据此把响应分流到 bridge 回包端点。 */
export const DAL_BRIDGE_REQUEST_PREFIX = 'dalbridge_'

// ─── dal → 宿主（POST /api/internal/pi-bridge/*） ──────────────────

/** dal-bridge 每个非只读工具调用都会 POST 的权限审批体（index.ts L113-118）。 */
export interface DalBridgePermissionBody {
  sessionId?: unknown
  toolName?: unknown
  toolInput?: unknown
  ruleContent?: unknown
}

/** dal 的 submit_plan 工具 POST 的计划审批体（index.ts L180-185）。 */
export interface DalBridgePlanBody {
  sessionId?: unknown
  goal?: unknown
  reasoning?: unknown
  steps?: unknown
}

/** 模型回退通知体（index.ts L153-160）——只记录，不阻塞。 */
export interface DalBridgeProviderFallbackBody {
  sessionId?: unknown
  from?: unknown
  to?: unknown
  reason?: unknown
  attempt?: unknown
  blocked?: unknown
}

// ─── 宿主 → dal（HTTP 响应体） ─────────────────────────────────────

/** 权限审批回包（index.ts L54-57）。undefined / 非 2xx 一律按拒绝处理。 */
export interface DalBridgePermissionVerdict {
  decision: 'allow' | 'deny'
  message?: string
}

/** 计划审批回包（index.ts L59-62）。 */
export interface DalBridgePlanVerdict {
  decision: 'execute' | 'cancel'
  feedback?: string
}

// ─── 渲染端 → 宿主（POST /api/dal-bridge/respond） ─────────────────

/** 渲染端对话框对一条 bridge 审批请求的响应。 */
export interface DalBridgeRespondBody {
  requestId?: unknown
  allowed?: unknown
  /** 拒绝时回传给 dal 的原因（走 DalBridgePermissionVerdict.message）。 */
  denyMessage?: unknown
  /** 「本次会话内允许（同类操作）」：按 ruleId 记入会话 allowlist。 */
  alwaysAllow?: unknown
  /** 更新后的工具入参（宿主评估器不消费，仅透传记录）。 */
  updatedInput?: unknown
  /** dal 的 /plan 审批时渲染端补充的反馈文本。 */
  feedback?: unknown
  /** 计划审批附带的模式切换（approveWithMode）：立即生效于宿主评估器。 */
  modeChange?: unknown
}
