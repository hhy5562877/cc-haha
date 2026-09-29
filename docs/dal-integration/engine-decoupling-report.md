# 引擎解耦量化报告

> 自动生成：bun scripts/engine-decoupling-report.ts（词法模块图，3737 文件）

## 总量

- src/server 文件数：543
- server → 引擎 **直接依赖边**：672（涉及 207 个引擎文件）
- 引擎传递闭包（直接+间接可达）：**1902 个文件**
- 其中疑似类型/模型定义类直接依赖：37

## 直接依赖按引擎目录分布

| 目录 | 被引用文件数 |
|---|---|
| src/services/connectors | 8 |
| src/tools/AgentTool | 7 |
| src/utils/permissions | 6 |
| src/utils/computerUse | 5 |
| src/utils/model | 4 |
| src/utils/secureStorage | 4 |
| src/utils/swarm | 4 |
| src/services/oauth | 4 |
| src/vendor/computer-use-mcp | 3 |
| src/tools/FileEditTool | 3 |
| src/services/analytics | 3 |
| src/utils/claudeInChrome | 3 |
| src/services/api | 2 |
| src/tools/MCPTool | 2 |
| src/utils/git | 2 |
| src/services/lsp | 2 |
| src/utils/dxt | 2 |
| src/state/AppStateStore.ts | 1 |
| src/utils/git.ts | 1 |
| src/utils/terminalShellEnvironment.ts | 1 |
| src/utils/sessionCollaborationEnvelope.ts | 1 |
| src/utils/stats.ts | 1 |
| src/utils/sessionStoragePortable.ts | 1 |
| src/bootstrap/state.ts | 1 |
| src/utils/config.ts | 1 |
| src/utils/env.ts | 1 |
| src/utils/cwd.ts | 1 |
| src/utils/path.ts | 1 |
| src/shared/modelApiFormats.ts | 1 |
| src/commands.ts | 1 |
| src/utils/json.ts | 1 |
| src/utils/sessionBranching.ts | 1 |
| src/utils/fileHistory.ts | 1 |
| src/utils/sessionStorage.ts | 1 |
| src/constants/outputStyles.ts | 1 |
| src/outputStyles/loadOutputStylesDir.ts | 1 |
| src/utils/cleanup.ts | 1 |
| src/utils/lockfile.ts | 1 |
| src/utils/tasks.ts | 1 |
| src/utils/teleport | 1 |
| src/state/AppState.tsx | 1 |
| src/Task.ts | 1 |
| src/hooks/useCanUseTool.tsx | 1 |
| src/Tool.ts | 1 |
| src/utils/task | 1 |
| src/tasks/LocalWorkflowTask | 1 |
| src/utils/workflows | 1 |
| src/utils/slashCommandParsing.ts | 1 |
| src/utils/envUtils.ts | 1 |
| src/utils/statsCache.ts | 1 |
| src/utils/debug.ts | 1 |
| src/utils/effort.ts | 1 |
| src/tools.ts | 1 |
| src/utils/execFileNoThrow.ts | 1 |
| src/utils/ripgrep.ts | 1 |
| src/utils/frontmatterParser.ts | 1 |
| src/memdir/memoryTypes.ts | 1 |
| src/utils/auth.ts | 1 |
| src/shared/modelReasoning.ts | 1 |
| src/skills/skillRoots.ts | 1 |
| src/skills/loadSkillsDir.ts | 1 |
| src/types/plugin.ts | 1 |
| src/commands/headless.ts | 1 |
| src/utils/errors.ts | 1 |
| src/utils/slowOperations.ts | 1 |
| src/entrypoints/agentSdkTypes.ts | 1 |
| src/entrypoints/sdk | 1 |
| src/remote/RemoteSessionManager.ts | 1 |
| src/utils/proxy.ts | 1 |
| src/constants/claudeCodeCompatibility.ts | 1 |
| src/utils/unparsedToolInput.ts | 1 |
| src/utils/openAIReasoningEnvelope.ts | 1 |
| src/utils/userAgent.ts | 1 |
| src/shared/autoQuestionSettings.ts | 1 |
| src/constants/oauth.ts | 1 |
| src/types/command.ts | 1 |
| src/types/composerMention.ts | 1 |
| src/utils/teammateMailbox.ts | 1 |
| src/services/imageGeneration | 1 |
| src/utils/log.ts | 1 |
| src/utils/imageResizer.ts | 1 |
| src/utils/managedEnvConstants.ts | 1 |
| src/utils/desktopBundledCli.ts | 1 |
| src/utils/shellConfig.ts | 1 |
| src/utils/xdg.ts | 1 |
| src/services/teamMemorySync | 1 |
| src/services/modelCatalogCache.ts | 1 |
| src/utils/commandMetadata.ts | 1 |
| src/utils/sessionTitleText.ts | 1 |
| src/utils/messages.ts | 1 |
| src/utils/shotStats.ts | 1 |
| src/utils/usageAccounting.ts | 1 |
| src/utils/browser.ts | 1 |
| src/utils/platform.ts | 1 |
| src/utils/sleep.ts | 1 |
| src/utils/lazySchema.ts | 1 |
| src/constants/xml.ts | 1 |
| src/utils/xml.ts | 1 |
| src/constants/product.ts | 1 |
| src/tools/ListMcpResourcesTool | 1 |
| src/tools/McpAuthTool | 1 |
| src/tools/ReadMcpResourceTool | 1 |
| src/utils/abortController.ts | 1 |
| src/utils/array.ts | 1 |
| src/utils/cleanupRegistry.ts | 1 |
| src/utils/codeIndexing.ts | 1 |
| src/utils/http.ts | 1 |
| src/utils/ide.ts | 1 |
| src/utils/mcpOutputStorage.ts | 1 |
| src/utils/mcpValidation.ts | 1 |
| src/utils/mcpWebSocketTransport.ts | 1 |
| src/utils/memoize.ts | 1 |
| src/utils/mtls.ts | 1 |
| src/utils/sanitization.ts | 1 |
| src/utils/sessionIngressAuth.ts | 1 |
| src/utils/mcpStdioEnvironment.ts | 1 |
| src/utils/toolResultStorage.ts | 1 |
| src/skills/mcpSkills.ts | 1 |
| src/utils/fsOperations.ts | 1 |
| src/utils/hooks.ts | 1 |
| src/services/skillSearch | 1 |
| src/context/notifications.tsx | 1 |
| src/utils/messageQueueManager.ts | 1 |
| src/components/mcp | 1 |
| src/utils/providerManagedEnvCompat.ts | 1 |
| src/plugins/builtinPlugins.ts | 1 |
| src/services/plugins | 1 |
| src/utils/markdownConfigLoader.ts | 1 |
| src/utils/worktree.ts | 1 |
| src/tools/BashTool | 1 |
| src/utils/modelCost.ts | 1 |
| src/utils/context.ts | 1 |
| src/utils/contextBudget.ts | 1 |
| src/services/tokenEstimation.ts | 1 |
| src/utils/sessionMessageInbox.ts | 1 |
| src/shared/teamPlan.ts | 1 |
| src/utils/sessionTitle.ts | 1 |
| src/tools/SkillTool | 1 |
| src/utils/attachments.ts | 1 |
| src/utils/which.ts | 1 |
| src/utils/claudeCodeHints.ts | 1 |
| src/memdir/paths.ts | 1 |
| src/tools/FileReadTool | 1 |
| src/tools/FileWriteTool | 1 |
| src/utils/argumentSubstitution.ts | 1 |
| src/utils/promptShellExecution.ts | 1 |
| src/utils/stringUtils.ts | 1 |
| src/utils/systemDirectories.ts | 1 |
| src/utils/format.ts | 1 |
| src/utils/telemetry | 1 |
| src/utils/file.ts | 1 |
| src/schemas/hooks.ts | 1 |
| src/utils/yaml.ts | 1 |
| src/utils/hooks | 1 |
| src/utils/signal.ts | 1 |
| src/utils/diagLogs.ts | 1 |
| src/utils/fileRead.ts | 1 |
| src/utils/startupProfiler.ts | 1 |
| src/services/remoteManagedSettings | 1 |
| src/entrypoints/sandboxTypes.ts | 1 |

## 解耦枢纽（闭包内扇入 Top 25——先解耦它们可级联释放最多文件）

| 文件 | 被依赖次数 |
|---|---|
| src/ink.ts | 390 |
| src/utils/debug.ts | 325 |
| src/utils/envUtils.ts | 228 |
| src/utils/errors.ts | 224 |
| src/Tool.ts | 213 |
| src/bootstrap/state.ts | 211 |
| src/utils/log.ts | 197 |
| src/utils/slowOperations.ts | 190 |
| src/commands.ts | 170 |
| src/types/message.ts | 156 |
| src/services/analytics/index.ts | 147 |
| src/utils/config.ts | 134 |
| src/utils/messages.ts | 117 |
| src/state/AppState.tsx | 109 |
| src/services/analytics/growthbook.ts | 100 |
| src/utils/cwd.ts | 97 |
| src/utils/format.ts | 95 |
| src/utils/lazySchema.ts | 93 |
| src/keybindings/useKeybinding.ts | 91 |
| src/utils/fsOperations.ts | 89 |
| src/utils/auth.ts | 82 |
| src/types/command.ts | 79 |
| src/utils/stringUtils.ts | 73 |
| src/utils/model/model.ts | 68 |
| src/tools/AgentTool/loadAgentsDir.ts | 62 |

## 分批解耦建议

1. **类型层先行**：server 对引擎的 type-only 引用改为 `src/server/types/` 本地声明或 `src/shared/` 共享包——零运行时风险，预计消解一批纯类型边。
2. **常量/配置层**：constants/messages/xml 等纯数据文件复制进 `src/server/constants/`（引擎侧等删除）。
3. **工具层按扇入顺序**：先解耦上表枢纽（每解耦一个按 closure 重算，收益级联）。
4. **每批跑**：`bun scripts/engine-deletion-plan.ts --delete`（现成闭包分析器）+ `tsc --noEmit` + `bun scripts/e2e-dal-chat.ts`。
5. **判定线**：当 engine-deletion-plan 报告的「不可达文件数」趋近 0 时，引擎即彻底删除。