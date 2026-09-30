/**
 * /api/agents `availableTools` 名单的 server 本地实现。
 *
 * 语义对齐原实现（引擎链，已切断）：
 *   src/tools.ts getAllBaseTools() → isEnabled() 过滤 →
 *   src/server/tools/AgentTool/agentToolUtils.ts
 *     filterToolsForAgent({ isBuiltIn: false, isAsync: true }) → name 排序。
 *
 * isAsync=true 时最终名单恒等于「启用工具 ∩ ASYNC_AGENT_ALLOWED_TOOLS」
 * （src/constants/tools.ts）：
 *   - ALL/CUSTOM_AGENT_DISALLOWED_TOOLS 与该集合无交集；
 *   - 基础池中没有 mcp__ 前缀工具；
 *   - ExitPlanMode+plan 分支依赖 permissionMode，此调用点未传。
 * 因此这里按「名字白名单 + 轻量门控谓词」收敛，避免为取一份工具名单而把
 * tools.ts → AgentTool.tsx → UI.tsx → processUserInput → components 的引擎
 * UI 世界拉进 server 闭包。
 *
 * 改造前基线（Windows/DAL server 测试环境，与 NODE_ENV 无关，见 CHANGELOG）：
 * ["Edit","EnterWorktree","ExitWorktree","Glob","Grep","NotebookEdit",
 *  "PowerShell","Read","Skill","WebFetch","Write"]
 */
import { hasEmbeddedSearchTools } from './embeddedTools.js'
import { getMainLoopModel } from './model/model.js'
import {
  isBashToolEnabled,
  isPowerShellToolEnabled,
} from './shell/shellToolUtils.js'
import { isWebSearchEnabledForModel } from '../../tools/WebSearchTool/backend.js'
import { isTodoV2Enabled } from '../../utils/tasks.js'
import { isWorktreeModeEnabled } from '../../utils/worktreeModeEnabled.js'

/**
 * ASYNC_AGENT_ALLOWED_TOOLS 中「无独立 isEnabled 门控、恒在基础池」的工具。
 * FileRead/FileEdit/FileWrite/NotebookEdit/Skill/WebFetch 的 isEnabled 均为
 * 默认 true（引擎实测基线亦包含它们）。
 */
const ALWAYS_AVAILABLE: readonly string[] = [
  'Edit',
  'Read',
  'Write',
  'NotebookEdit',
  'Skill',
  'WebFetch',
]

/**
 * ToolSearch 的轻量等价判定。真值源 src/utils/toolSearch.ts
 * isToolSearchEnabledOptimistic()：未设置 ENABLE_TOOL_SEARCH 时按 provider
 * 判定（第三方网关不支持 tool_reference → 关闭，桌面 DAL 网关同属此路径）；
 * 显式非空值（true/auto/auto:N）视为开启，false/0/standard 视为关闭。
 * 不直接引入 src/utils/toolSearch.ts：其闭包含 Tool.ts/analyzeContext/betas
 * 等引擎重链，仅为一道乐观门控不值得。
 */
function isToolSearchEnabledOptimisticLocal(): boolean {
  const raw = process.env.ENABLE_TOOL_SEARCH?.trim()
  if (!raw) return false
  if (raw === 'false' || raw === '0' || raw === 'standard') return false
  return true
}

export function getAvailableCustomAgentToolNames(): string[] {
  const names = new Set<string>(ALWAYS_AVAILABLE)

  // Glob/Grep：存在嵌入式搜索工具时从基础池剔除（src/tools.ts getAllBaseTools）。
  if (!hasEmbeddedSearchTools()) {
    names.add('Grep')
    names.add('Glob')
  }

  // Shell：Bash 不可用时退回 PowerShell（src/server/utils/shell/shellToolUtils.ts，
  // 与 getAllBaseTools 的 isBashToolEnabled()/getPowerShellTool() 分支一致）。
  if (isBashToolEnabled()) {
    names.add('Bash')
  } else if (isPowerShellToolEnabled()) {
    names.add('PowerShell')
  }

  // TodoWrite.isEnabled = !isTodoV2Enabled()（src/tools/TodoWriteTool）。
  if (!isTodoV2Enabled()) names.add('TodoWrite')

  // WebSearchTool.isEnabled = isWebSearchEnabledForModel(getMainLoopModel())。
  if (isWebSearchEnabledForModel(getMainLoopModel())) names.add('WebSearch')

  // ToolSearchTool.isEnabled = isToolSearchEnabledOptimistic()。
  if (isToolSearchEnabledOptimisticLocal()) names.add('ToolSearch')

  // Worktree 工具仅在 worktree 模式下入池（isWorktreeModeEnabled 恒 true），
  // isEnabled 默认 true。
  if (isWorktreeModeEnabled()) {
    names.add('EnterWorktree')
    names.add('ExitWorktree')
  }

  return [...names].sort((a, b) => a.localeCompare(b))
}
