/**
 * 编译期内置斜杠命令清单的 server 本地实现。
 *
 * 语义对齐原实现（引擎链，已切断）：
 *   src/commands.ts getCompiledInCommands()
 *     = bundled skills 注册表（src/skills/bundled/index.ts initBundledSkills）
 *       + 内置命令表 COMMANDS()
 *     经 meetsAvailabilityRequirement && isCommandEnabled 过滤；
 *   src/server/api/skills.ts collectCompiledInSlashCommands 再按
 *     userInvocable !== false && supportsHeadlessSlashCommand 过滤后映射
 *     name/description/argumentHint。
 *
 * 收敛方式：
 *   - bundled skills：静态登记 userInvocable 且 headless 可用的条目，三道
 *     动态 isEnabled 门控改接 server 原生模块（imagegen/remember/computer-use），
 *     注册序与引擎 initBundledSkills 一致；
 *   - 内置命令：编译期清单（改造前基线实测捕获），以轻量凭据判定复现引擎
 *     「无凭据时内置命令表构建抛错 → 仅列 bundled skills」的降级门控。
 *
 * 本清单只是 CLI 子进程未启动前斜杠菜单的替身；会话的实时命令列表到达后
 * 整体取代它（见 listSkillSlashCommands）。
 */
import { isAutoMemoryEnabled } from '../memdir/paths.js'
import { getImageGenerationRuntimeConfig } from '../services/imageGeneration/config.js'
import { isComputerUseSkillEnabled } from './computerUse/skillGate.js'

export type CompiledInSlashCommand = {
  name: string
  description: string
  argumentHint?: string
}

type CompiledInEntry = CompiledInSlashCommand & {
  /**
   * 与引擎 isCommandEnabled（cmd.isEnabled?.() ?? true）等价的活性行为门控。
   * 缺省即恒可用。
   */
  isEnabled?: () => boolean
}

// bundled skills（注册序对齐 src/skills/bundled/index.ts initBundledSkills）。
// 未列条目的原因：
//   - keybindings-help：userInvocable:false，恒被清单过滤；
//   - verify / lorem-ipsum / skillify / stuck：仅 USER_TYPE==='ant' 注册，
//     非 ant 桌面构建恒缺；
//   - dream / hunter / loop / schedule-remote-agents / claude-api /
//     run-skill-generator：编译期 feature（KAIROS/REVIEW_ARTIFACT/AGENT_TRIGGERS
//     等）在本构建关闭，运行时不可达；
//   - claude-in-chrome：注册门控 shouldAutoEnableClaudeInChrome() 依赖引擎
//     utils/config 重链，桌面 DAL 运行时恒 false，不引入。
// 注意：若未来构建翻转上述 feature 或新增 bundled skill，需同步本表。
const BUNDLED_SKILL_COMMANDS: readonly CompiledInEntry[] = [
  {
    name: 'update-config',
    description:
      'Use this skill to configure the Claude Code harness via settings.json. Automated behaviors ("from now on when X", "each time X", "whenever X", "before/after X") require hooks configured in settings.json - the harness executes these, not Claude, so memory/preferences cannot fulfill them. Also use for: permissions ("allow X", "add permission", "move permission to"), env vars ("set X=Y"), hook troubleshooting, or any changes to settings.json/settings.local.json files. Examples: "allow npm commands", "add bq permission to global settings", "move permission to user settings", "set DEBUG=true", "when claude stops show X". For simple settings like theme/model, use Config tool.',
  },
  {
    name: 'imagegen',
    description:
      "Generate original images, artwork, product visuals, diagrams, or other raster assets with the desktop's configured image provider. Use whenever the user asks to create or generate an image.",
    // isEnabled: () => getImageGenerationRuntimeConfig() !== null（src/skills/bundled/imagegen.ts）
    isEnabled: () => getImageGenerationRuntimeConfig() !== null,
  },
  {
    name: 'debug',
    description: 'Enable debug logging for this session and help diagnose issues',
    argumentHint: '[issue description]',
  },
  {
    name: 'remember',
    description:
      'Review auto-memory entries and propose promotions to CLAUDE.md, CLAUDE.local.md, or shared memory. Also detects outdated, conflicting, and duplicate entries across memory layers.',
    // isEnabled: isAutoMemoryEnabled（src/skills/bundled/remember.ts）
    isEnabled: isAutoMemoryEnabled,
  },
  {
    name: 'simplify',
    description:
      'Review changed code for reuse, quality, and efficiency, then fix any issues found.',
  },
  {
    name: 'batch',
    description:
      'Research and plan a large-scale change, then execute it in parallel across 5–30 isolated worktree agents that each open a PR.',
    argumentHint: '<instruction>',
  },
  {
    name: 'computer-use',
    description:
      process.platform === 'win32'
        ? "Operate apps on the user's Windows desktop — click, type, scroll and inspect the display through safety-gated pixel tools. For native desktop apps and cross-app workflows. Prefer a purpose-built MCP server, browser integration, or CLI when one covers the task."
        : "Operate apps on the user's Mac — click, type, scroll and read app state through the accessibility engine. For native desktop apps and cross-app workflows. Prefer a purpose-built MCP server, the Chrome extension, or a CLI when one covers the task.",
    // isEnabled: isComputerUseSkillEnabled（src/skills/bundled/computerUse.ts，
    // server 原生门控与 /api/computer-use 设置读写同源，3s 缓存语义一致）
    isEnabled: () => isComputerUseSkillEnabled(),
  },
]

/**
 * 内置命令编译期清单（改造前基线实测捕获：ANTHROPIC_API_KEY 就绪状态下
 * getCompiledInCommands() 经 userInvocable + supportsHeadlessSlashCommand +
 * meetsAvailabilityRequirement + isCommandEnabled 过滤后的产出，顺序即
 * COMMANDS() 表序）。
 *
 * 未列条目：其余内置命令均因 supportsNonInteractive=false（交互 UI 专用）、
 * userInvocable:false 或 availability 不满足而被引擎过滤，非 ant 构建下
 * USER_TYPE 分支（INTERNAL_ONLY_COMMANDS 等）亦不注册。
 */
const BUILT_IN_COMMANDS: readonly CompiledInSlashCommand[] = [
  {
    name: 'agent',
    description: 'Run a prompt with a selected Agent',
    argumentHint: '<agent> <prompt>',
  },
  {
    name: 'compact',
    description:
      'Clear conversation history but keep a summary in context. Optional: /compact [instructions for summarization]',
    argumentHint: '<optional custom summarization instructions>',
  },
  {
    name: 'context',
    description: 'Show current context usage',
  },
  {
    name: 'cost',
    description: 'Show the total cost and duration of the current session',
  },
  {
    name: 'heapdump',
    description: 'Dump the JS heap to ~/Desktop',
  },
  {
    name: 'init',
    description: 'Initialize a new CLAUDE.md file with codebase documentation',
  },
  {
    name: 'pr-comments',
    description: 'Get comments from a GitHub pull request',
  },
  {
    name: 'release-notes',
    description: 'View release notes',
  },
  {
    name: 'team',
    description: 'Create an Agent Team for a goal',
    argumentHint: '[goal]',
  },
  {
    name: 'goal',
    description: 'Set a completion goal',
    argumentHint: '[<condition> | clear]',
  },
  {
    name: 'review',
    description: 'Review a pull request',
  },
  {
    name: 'security-review',
    description:
      'Complete a security review of the pending changes on the current branch',
  },
  {
    name: 'insights',
    description: 'Generate a report analyzing your Claude Code sessions',
  },
]

/**
 * 引擎侧 src/commands.ts getCompiledInCommands：内置命令表构建读取认证状态，
 * 无凭据时抛错并被 catch 降级为「仅 bundled skills」。此处以轻量凭据判定
 * 等价该门控（桌面 DAL 运行时两变量均未设置 → 仅 bundled skills，与改造前
 * 生产行为一致；测试以 ANTHROPIC_API_KEY 模拟已登录）。
 */
function hasEngineCommandCredentials(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN,
  )
}

/**
 * 编译期内置斜杠命令清单（已应用 userInvocable/headless 过滤的最终形态，
 * 顺序与引擎 getCompiledInCommands 一致：bundled skills 在前、内置命令在后）。
 */
export function getCompiledInSlashCommandSummaries(): CompiledInSlashCommand[] {
  const bundled = BUNDLED_SKILL_COMMANDS.filter(
    entry => entry.isEnabled?.() ?? true,
  ).map(({ isEnabled: _isEnabled, ...command }) => command)
  const builtIn = hasEngineCommandCredentials() ? BUILT_IN_COMMANDS : []
  return [...bundled, ...builtIn]
}
