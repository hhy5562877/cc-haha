/**
 * dal-guard 模式评估器（宿主侧权威实现）。
 *
 * bridge 环境存在时 dal-guard 自身 stand down（packages/dal-guard/src/index.ts
 * L276 `readBridgeConfig` 命中即放行），包括 plan 只读拦截在内的全部决策都由
 * 本模块代表宿主完成：dal-bridge 扩展把每个非只读工具调用 POST 过来，这里按
 * 当前会话的 guard 模式判定 allow / ask / deny。
 *
 * 模式语义对齐 dal-guard（L62-64）：
 *   plan        只读；其余一律拒绝（给出退出路径提示）
 *   default     一切到达这里的调用都询问（只读工具根本不会 POST 过来）
 *   acceptEdits 项目内文件编辑静默放行；其余询问
 *   auto        项目内编辑与 MCP 调用放行；风险 bash / 项目外写入仍询问
 *   yolo        全部放行（cc-safety-net 的硬拦截仍在 dal 侧生效）
 */

import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { DalBridgePermissionBody, DalGuardMode } from './types.js'
import { isDalGuardMode } from './types.js'

/** 宿主侧 PermissionMode（desktop/src/types/settings.ts）到 dal-guard 模式的映射。
 * bypassPermissions 与 dontAsk 都由 yolo 承接（--dangerously-skip-permissions 语义）。 */
export function toDalGuardMode(permissionMode: string | undefined | null): DalGuardMode {
  switch (permissionMode) {
    case 'acceptEdits':
      return 'acceptEdits'
    case 'plan':
      return 'plan'
    case 'auto':
      return 'auto'
    case 'bypassPermissions':
    case 'dontAsk':
    case 'yolo':
      return 'yolo'
    default:
      return 'default'
  }
}

// ─── 会话级模式状态（宿主评估器的真相来源） ─────────────────────────

const sessionGuardModes = new Map<string, DalGuardMode>()

/** 运行时切换会话的 guard 模式。写入点：
 * 1. proto 适配层处理 WS set_permission_mode 时（契约见 docs/dal-integration/bridge-contract.md）
 * 2. dal 侧 /guard 命令经 RPC prompt 执行后由 proto 回读同步
 * 3. bridge 计划审批回包携带的 modeChange */
export function setGuardModeForSession(sessionId: string, mode: string): DalGuardMode {
  const normalized = isDalGuardMode(mode) ? mode : toDalGuardMode(mode)
  sessionGuardModes.set(sessionId, normalized)
  return normalized
}

export function getGuardModeForSession(sessionId: string): DalGuardMode {
  return sessionGuardModes.get(sessionId) ?? 'default'
}

/** 会话销毁时清理（由 proto 适配层在进程退出路径调用）。 */
export function clearGuardModeForSession(sessionId: string): void {
  sessionGuardModes.delete(sessionId)
}

// ─── 风险启发式（对齐 dal-guard BASH_RISK_RULES L80-110，仅用于日志与
//     auto 模式的「高风险 bash 仍询问」判定；硬拦截始终在 dal 侧） ────

const BASH_RISK_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'sudo', pattern: /(^|[;&|\n]\s*)(sudo|doas)\s/ },
  { id: 'force-push', pattern: /git\s+push\b[^;&|]*(--force\b|--force-with-lease\b|\s-f\b)/ },
  { id: 'hard-reset', pattern: /git\s+reset\b[^;&|]*--hard/ },
  { id: 'git-clean', pattern: /git\s+clean\b[^;&|]*(-[a-z]*f|--force)/ },
  { id: 'pipe-to-shell', pattern: /(curl|wget)\b[^;&|]*\|\s*(ba|z|da|fi)?sh\b/ },
  { id: 'exec-download', pattern: /\b(ba|z|da|fi)?sh\s+<\(\s*(curl|wget)\b|eval\b[^;&|\n]*\$\(\s*(curl|wget)\b/ },
  { id: 'recursive-perms', pattern: /(chmod|chown)\b[^;&|]*-[a-zA-Z]*R/ },
  { id: 'publish', pattern: /(npm|pnpm|yarn)\s+publish\b/ },
  { id: 'kill', pattern: /(^|[;&|\n]\s*)(killall|pkill)\s/ },
  { id: 'disk', pattern: /(^|[;&|\n]\s*)(dd|mkfs\w*|diskutil|fdisk)\s/ },
]

export function bashRiskId(command: string): string | undefined {
  const hit = BASH_RISK_PATTERNS.find((rule) => rule.pattern.test(command))
  return hit ? `bash:${hit.id}` : undefined
}

/** 项目外路径判定（对齐 dal-guard pathOutsideProject L116-123 的分隔符安全逻辑）。 */
export function pathOutsideProject(rawPath: string, workDir: string): boolean {
  if (!workDir) return false
  const abs = isAbsolute(rawPath) ? resolve(rawPath) : resolve(workDir, rawPath)
  const root = resolve(workDir)
  const rel = relative(root, abs)
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

// ─── 会话 allowlist（「本次会话内允许（同类操作）」） ────────────────
// dal-guard 的 sessionAllows 是纯内存 Set 且 bridge 模式下 stand down，无持久化
// API——「始终允许」在此降级为会话内生效（docs/dal-integration/bridge-contract.md）。

const sessionAllowlists = new Map<string, Set<string>>()

export function allowRuleIdForSession(sessionId: string, ruleId: string): void {
  let allows = sessionAllowlists.get(sessionId)
  if (!allows) {
    allows = new Set()
    sessionAllowlists.set(sessionId, allows)
  }
  allows.add(ruleId)
}

export function isRuleIdAllowedForSession(sessionId: string, ruleId: string): boolean {
  return sessionAllowlists.get(sessionId)?.has(ruleId) ?? false
}

export function clearSessionAllowlist(sessionId: string): void {
  sessionAllowlists.delete(sessionId)
}

// ─── 审批评估 ──────────────────────────────────────────────────────

export type GuardVerdict =
  | { action: 'allow'; ruleId?: string; matchedSessionAllow: boolean }
  | { action: 'deny'; message: string; ruleId: string }
  | { action: 'ask'; ruleId: string }

/** dal-bridge 的只读工具集合（packages/dal-bridge/src/index.ts L52）。
 * 这些工具不会 POST 过来；列在此处仅用于防御性兜底。 */
const BRIDGE_READ_ONLY_TOOLS = new Set(['read', 'grep', 'ripgrep', 'find', 'fd', 'ls', 'glob', 'todo_read', 'lsp'])

/** dal 的计划提交工具：plan 模式下放行（真正的审批走 /api/internal/pi-bridge/plan）。 */
const PLAN_SUBMIT_TOOL = 'submit_plan'

/** 从工具入参提取 ruleContent 同源字段（对齐 dal-bridge ruleContentFor L70-77）。 */
function extractPrimaryInput(toolInput: Record<string, unknown>): string {
  for (const key of ['command', 'file_path', 'path', 'filePath']) {
    const value = toolInput[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return ''
}

function extractFilePath(toolInput: Record<string, unknown>): string {
  const value = toolInput.path ?? toolInput.file_path ?? toolInput.filePath
  return typeof value === 'string' ? value : ''
}

/** 计算与 dal-guard 对齐的会话 allowlist 键。 */
export function classifyRuleId(toolName: string, toolInput: Record<string, unknown>, workDir: string): string {
  if (toolName.startsWith('mcp__')) {
    return `mcp:${toolName.split('__')[1] || 'unknown'}`
  }
  if (toolName === 'computer') return 'computer'
  if (toolName === 'bash') {
    const command = typeof toolInput.command === 'string' ? toolInput.command : ''
    return bashRiskId(command) ?? 'bash:risky-unknown'
  }
  if (toolName === 'edit' || toolName === 'write') {
    const filePath = extractFilePath(toolInput)
    if (filePath && pathOutsideProject(filePath, workDir)) return `${toolName}:outside-project`
    return 'edit:file'
  }
  return `tool:${toolName}`
}

/**
 * 按 guard 模式评估一条 dal-bridge 权限审批请求。
 *
 * workDir 缺失时项目内/外判定退化为「一律视为项目外」（更保守，多问一次）。 */
export function evaluateBridgePermission(
  sessionId: string,
  body: DalBridgePermissionBody,
  workDir: string,
): GuardVerdict {
  const mode = getGuardModeForSession(sessionId)
  const toolName = typeof body.toolName === 'string' ? body.toolName : 'unknown'
  const toolInput =
    body.toolInput && typeof body.toolInput === 'object' && !Array.isArray(body.toolInput)
      ? (body.toolInput as Record<string, unknown>)
      : {}

  if (mode === 'yolo') return { action: 'allow', matchedSessionAllow: false }
  if (BRIDGE_READ_ONLY_TOOLS.has(toolName)) return { action: 'allow', matchedSessionAllow: false }

  // plan 只读门：除计划提交外全部拒绝，提示与 dal-guard L283 同款退出路径。
  if (mode === 'plan') {
    if (toolName === PLAN_SUBMIT_TOOL) return { action: 'allow', matchedSessionAllow: false }
    return {
      action: 'deny',
      ruleId: classifyRuleId(toolName, toolInput, workDir),
      message: `plan 模式只读，已拦截（${toolName}）。完成规划后切换到其他权限模式再执行。`,
    }
  }

  const ruleId = classifyRuleId(toolName, toolInput, workDir)

  // 会话 allowlist 命中 → 放行（dal-guard L292 同语义）。
  if (isRuleIdAllowedForSession(sessionId, ruleId)) {
    return { action: 'allow', ruleId, matchedSessionAllow: true }
  }

  if (toolName === PLAN_SUBMIT_TOOL) return { action: 'allow', matchedSessionAllow: false }

  if (mode === 'acceptEdits' || mode === 'auto') {
    const isFileEdit = toolName === 'edit' || toolName === 'write'
    const filePath = extractFilePath(toolInput)
    const insideProject = Boolean(workDir) && Boolean(filePath) && !pathOutsideProject(filePath, workDir)
    if (isFileEdit && insideProject) return { action: 'allow', ruleId, matchedSessionAllow: false }
    if (mode === 'auto' && ruleId.startsWith('mcp:')) {
      // auto 模式把第三方 MCP 调用视为低风险（dal-guard L296 同语义）。
      return { action: 'allow', ruleId, matchedSessionAllow: false }
    }
  }

  return { action: 'ask', ruleId }
}

/** 渲染端「本次会话内允许」时计算应记入 allowlist 的 ruleId。 */
export function ruleIdForRespond(sessionId: string, body: DalBridgePermissionBody, workDir: string): string {
  const toolName = typeof body.toolName === 'string' ? body.toolName : 'unknown'
  const toolInput =
    body.toolInput && typeof body.toolInput === 'object' && !Array.isArray(body.toolInput)
      ? (body.toolInput as Record<string, unknown>)
      : {}
  return classifyRuleId(toolName, toolInput, workDir)
}

export { extractPrimaryInput }
