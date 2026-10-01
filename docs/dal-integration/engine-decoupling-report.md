# 引擎解耦量化报告

> 自动生成：bun scripts/engine-decoupling-report.ts（词法模块图，3749 文件）

## 总量

- src/server 文件数：839
- server → 引擎 **直接依赖边**：270（涉及 126 个引擎文件）
- 引擎传递闭包（直接+间接可达）：**1614 个文件**
- 其中疑似类型/模型定义类直接依赖：7

## 直接依赖按引擎目录分布

| 目录 | 被引用文件数 |
|---|---|
| src/utils/computerUse | 3 |
| src/tools/BashTool | 3 |
| src/services/api | 3 |
| src/utils/swarm | 2 |
| src/utils/claudeInChrome | 2 |
| src/utils/hooks | 2 |
| src/utils/telemetry | 2 |
| src/state/AppStateStore.ts | 1 |
| src/utils/stats.ts | 1 |
| src/commands.ts | 1 |
| src/utils/sessionBranching.ts | 1 |
| src/utils/fileHistory.ts | 1 |
| src/utils/sessionStorage.ts | 1 |
| src/constants/outputStyles.ts | 1 |
| src/outputStyles/loadOutputStylesDir.ts | 1 |
| src/utils/cleanup.ts | 1 |
| src/utils/tasks.ts | 1 |
| src/utils/teleport | 1 |
| src/state/AppState.tsx | 1 |
| src/Task.ts | 1 |
| src/hooks/useCanUseTool.tsx | 1 |
| src/Tool.ts | 1 |
| src/tasks/LocalWorkflowTask | 1 |
| src/utils/workflows | 1 |
| src/utils/statsCache.ts | 1 |
| src/utils/effort.ts | 1 |
| src/utils/auth.ts | 1 |
| src/skills/loadSkillsDir.ts | 1 |
| src/entrypoints/agentSdkTypes.ts | 1 |
| src/entrypoints/sdk | 1 |
| src/remote/RemoteSessionManager.ts | 1 |
| src/utils/modelCost.ts | 1 |
| src/utils/startupProfiler.ts | 1 |
| src/utils/user.ts | 1 |
| src/utils/http.ts | 1 |
| src/utils/betas.ts | 1 |
| src/utils/teammate.ts | 1 |
| src/types/command.ts | 1 |
| src/services/plugins | 1 |
| src/utils/imageResizer.ts | 1 |
| src/utils/shellConfig.ts | 1 |
| src/utils/messages.ts | 1 |
| src/utils/usageAccounting.ts | 1 |
| src/constants/product.ts | 1 |
| src/tools/ListMcpResourcesTool | 1 |
| src/tools/MCPTool | 1 |
| src/tools/McpAuthTool | 1 |
| src/tools/ReadMcpResourceTool | 1 |
| src/utils/ide.ts | 1 |
| src/utils/mcpOutputStorage.ts | 1 |
| src/utils/mcpValidation.ts | 1 |
| src/utils/toolResultStorage.ts | 1 |
| src/utils/hooks.ts | 1 |
| src/context/notifications.tsx | 1 |
| src/utils/messageQueueManager.ts | 1 |
| src/components/mcp | 1 |
| src/plugins/builtinPlugins.ts | 1 |
| src/utils/worktree.ts | 1 |
| src/utils/context.ts | 1 |
| src/services/tokenEstimation.ts | 1 |
| src/utils/sessionMessageInbox.ts | 1 |
| src/utils/teammateMailbox.ts | 1 |
| src/utils/sessionTitle.ts | 1 |
| src/constants/prompts.ts | 1 |
| src/coordinator/coordinatorMode.ts | 1 |
| src/services/AgentSummary | 1 |
| src/tasks/LocalAgentTask | 1 |
| src/tasks/RemoteAgentTask | 1 |
| src/tools.ts | 1 |
| src/utils/forkedAgent.ts | 1 |
| src/utils/systemPrompt.ts | 1 |
| src/utils/teleport.tsx | 1 |
| src/utils/tokens.ts | 1 |
| src/tools/shared | 1 |
| src/proactive/index.ts | 1 |
| src/components/AgentProgressLine.tsx | 1 |
| src/components/FallbackToolUseErrorMessage.tsx | 1 |
| src/components/FallbackToolUseRejectedMessage.tsx | 1 |
| src/components/Markdown.tsx | 1 |
| src/components/Message.tsx | 1 |
| src/components/MessageResponse.tsx | 1 |
| src/components/ToolUseLoader.tsx | 1 |
| src/ink.ts | 1 |
| src/utils/collapseReadSearch.ts | 1 |
| src/utils/format.ts | 1 |
| src/memdir/memdir.ts | 1 |
| src/constants/tools.ts | 1 |
| src/tools/SyntheticOutputTool | 1 |
| src/coordinator/workerAgent.ts | 1 |
| src/utils/promptCategory.ts | 1 |
| src/context.ts | 1 |
| src/query.ts | 1 |
| src/tasks/LocalShellTask | 1 |
| src/utils/attachments.ts | 1 |
| src/utils/processUserInput | 1 |
| src/tasks/MonitorMcpTask | 1 |
| src/utils/diff.ts | 1 |
| src/skills/bundledSkills.ts | 1 |
| src/tools/WebSearchTool | 1 |
| src/utils/worktreeModeEnabled.ts | 1 |
| src/utils/memory | 1 |
| src/memdir/teamMemPaths.ts | 1 |
| src/bridge/bridgeEnabled.ts | 1 |
| src/utils/configConstants.ts | 1 |
| src/buddy/types.ts | 1 |
| src/utils/sideQuery.ts | 1 |
| src/tools/ToolSearchTool | 1 |
| src/utils/plans.ts | 1 |
| src/commands/add-dir | 1 |
| src/utils/gracefulShutdown.ts | 1 |
| src/utils/bash | 1 |
| src/tools/SkillTool | 1 |
| src/utils/promptShellExecution.ts | 1 |
| src/services/lsp | 1 |
| src/schemas/hooks.ts | 1 |
| src/entrypoints/sandboxTypes.ts | 1 |

## 解耦枢纽（闭包内扇入 Top 25——先解耦它们可级联释放最多文件）

| 文件 | 被依赖次数 |
|---|---|
| src/ink.ts | 390 |
| src/Tool.ts | 212 |
| src/commands.ts | 169 |
| src/utils/messages.ts | 117 |
| src/state/AppState.tsx | 109 |
| src/utils/format.ts | 95 |
| src/keybindings/useKeybinding.ts | 91 |
| src/utils/auth.ts | 82 |
| src/types/command.ts | 78 |
| src/utils/sessionStorage.ts | 59 |
| src/hooks/useTerminalSize.ts | 59 |
| src/components/design-system/KeyboardShortcutHint.tsx | 55 |
| src/components/design-system/Byline.tsx | 55 |
| src/components/design-system/Dialog.tsx | 55 |
| src/components/CustomSelect/select.tsx | 51 |
| src/components/MessageResponse.tsx | 50 |
| src/ink/stringWidth.ts | 47 |
| src/components/ConfigurableShortcutHint.tsx | 46 |
| src/ink/events/keyboard-event.ts | 38 |
| src/utils/teammate.ts | 32 |
| src/utils/hooks.ts | 30 |
| src/components/permissions/PermissionRequest.tsx | 30 |
| src/utils/tasks.ts | 28 |
| src/components/CustomSelect/index.ts | 28 |
| src/utils/effort.ts | 26 |

## 分批解耦建议

1. **类型层先行**：server 对引擎的 type-only 引用改为 `src/server/types/` 本地声明或 `src/shared/` 共享包——零运行时风险，预计消解一批纯类型边。
2. **常量/配置层**：constants/messages/xml 等纯数据文件复制进 `src/server/constants/`（引擎侧等删除）。
3. **工具层按扇入顺序**：先解耦上表枢纽（每解耦一个按 closure 重算，收益级联）。
4. **每批跑**：`bun scripts/engine-deletion-plan.ts --delete`（现成闭包分析器）+ `tsc --noEmit` + `bun scripts/e2e-dal-chat.ts`。
5. **判定线**：当 engine-deletion-plan 报告的「不可达文件数」趋近 0 时，引擎即彻底删除。