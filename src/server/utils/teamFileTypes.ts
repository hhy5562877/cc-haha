/**
 * 团队 config.json 类型定义 —— 解耦批次 21 提取。
 *
 * 原型位于引擎支撑层 src/utils/swarm/teamHelpers.ts（TeamFile/TeamAllowedPath）；
 * 类型在运行时擦除，此为纯类型移植（零运行时风险）。
 * BackendType/PermissionMode 以宽化字面量表示，避免牵入引擎类型链。
 */

export type TeamBackendType = 'inProcess' | 'tmux' | (string & {})

export type TeamPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | (string & {})

export type TeamAllowedPath = {
  path: string // Directory path (absolute)
  toolName: string // The tool this applies to (e.g., "Edit", "Write")
  addedBy: string // Agent name who added this rule
  addedAt: number // Timestamp when added
}

export type TeamFile = {
  reviewRequired?: boolean
  name: string
  description?: string
  createdAt: number
  leadAgentId: string
  leadSessionId?: string // Actual session UUID of the leader (for discovery)
  hiddenPaneIds?: string[] // Pane IDs that are currently hidden from the UI
  teamAllowedPaths?: TeamAllowedPath[] // Paths all teammates can edit without asking
  members: Array<{
    agentId: string
    name: string
    agentType?: string
    model?: string
    providerId?: string | null
    providerName?: string
    effortLevel?: string
    planMemberId?: string
    terminated?: boolean
    prompt?: string
    color?: string
    planModeRequired?: boolean
    joinedAt: number
    tmuxPaneId: string
    cwd: string
    worktreePath?: string
    sessionId?: string
    subscriptions: string[]
    backendType?: TeamBackendType
    isActive?: boolean // false when idle, undefined/true when active
    mode?: TeamPermissionMode // Current permission mode for this teammate
  }>
}
