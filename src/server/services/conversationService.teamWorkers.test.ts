import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConversationService } from './conversationService.js'
import { ProviderService } from './providerService.js'
import { resetTerminalShellEnvironmentCacheForTests } from '../utils/terminalShellEnvironment.js'

// DAL 迁移说明：worker 专属 CLI 旗标（--agent-id/--parent-session-id/--agents/
// --max-turns/--disallowedTools）与逐 worker 的 provider 凭据/模型 env 注入
// （ANTHROPIC_*、CC_HAHA_SESSION_COLLABORATION_TOKEN 等）已随 claude 引擎
// 下线删除；dal 子进程只保留 --tools 收敛与 bridge env，模型/提供方以
// ~/.dal/agent/settings.json 为唯一事实源（运行时切换走 RPC set_model，
// 待 dal 化模型选择器接入）。因此依赖该契约的 5 个用例（CLI 旗标形状、
// 逐 worker 凭据隔离、真实进程首轮请求路由、roster 端到端编排）一并移除；
// 剩余用例覆盖纯内存外壳行为（权限路由、replay 身份、runtime 校验、停止级联）。
// 若后续要恢复端到端编排回归，需要新的 dal RPC mock fixture（另议）。

let home: string
let originalEnv: NodeJS.ProcessEnv
beforeEach(async () => {
  originalEnv = { ...process.env }
  home = await mkdtemp(join(tmpdir(), 'team-workers-'))
  process.env.HOME = home
  process.env.CLAUDE_CONFIG_DIR = home
  process.env.CC_HAHA_DISABLE_TERMINAL_SHELL_ENV = '1'
  resetTerminalShellEnvironmentCacheForTests()
})
afterEach(async () => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]
  Object.assign(process.env, originalEnv)
  resetTerminalShellEnvironmentCacheForTests()
  await rm(home, { recursive: true, force: true })
})

const worker = { parentSessionId: 'parent', teamName: 'approved', memberId: 'research', name: 'researcher', systemPrompt: 'Read only research', tools: ['Read'], agentDefinition: { disallowedTools: ['Bash'], maxTurns: 3 } }

test('parent permission responses route exclusively to the requesting worker', () => {
  const service = new ConversationService() as any
  const responses: unknown[] = []
  const parent = { pendingPermissionRequests: new Map(), outputCallbacks: [] }
  const child = { teamWorker: worker, pendingPermissionRequests: new Map([['permission-1', { toolName: 'Read', input: {} }]]), sdkSocket: { send: (message: string) => responses.push(JSON.parse(message)) } }
  service.sessions.set('parent', parent)
  service.sessions.set('child', child)
  expect(service.getPendingPermissionToolName('parent', 'permission-1')).toBe('Read')
  expect(service.getPendingPermissionRequests('parent')).toHaveLength(1)
  expect(service.respondToPermission('parent', 'permission-1', true, undefined, { file_path: '/fixture' })).toBe(true)
  expect(responses).toHaveLength(1)
  expect((responses[0] as any).response.response.updatedInput).toEqual({ file_path: '/fixture' })
  expect(child.pendingPermissionRequests.size).toBe(0)
})

test('worker permission identity remains available for replay after leader completion', () => {
  const service = new ConversationService() as any
  const output: any[] = []
  const state = () => ({ pendingPermissionRequests: new Map(), sdkMessages: [], outputCallbacks: [] })
  service.sessions.set('parent', { ...state(), outputCallbacks: [(message: any) => output.push(message)] })
  service.sessions.set('child', { ...state(), teamWorker: worker })
  service.handleSdkPayload('child', JSON.stringify({ type: 'control_request', request_id: 'pending-child', request: { subtype: 'can_use_tool', tool_name: 'Read', input: {} } }))
  service.handleSdkPayload('parent', JSON.stringify({ type: 'result', subtype: 'success', result: 'leader done' }))
  expect(service.getPendingPermissionRequests('parent')).toEqual([{ requestId: 'pending-child', toolName: 'Read', input: {}, displayName: 'researcher', agentId: 'researcher@approved' }])
  expect(output[0].request.agent_id).toBe('researcher@approved')
})

test('approval resolves preset snapshots and model aliases against the selected provider', async () => {
  const { validateTeamPlanRuntime } = await import('./teamPlanRuntime.js')
  const provider = await new ProviderService().addProvider({ presetId: 'custom', name: 'Selected', baseUrl: 'http://127.0.0.1:32111', apiKey: 'fake', models: { main: 'selected-main', sonnet: 'selected-sonnet', opus: 'selected-capable', haiku: 'selected-cheap' } })
  const plan = {
    workDir: home, agentCatalog: { researcher: { systemPrompt: 'Approved read-only role', tools: ['Read'], source: 'flagSettings', sourceIdentity: { kind: 'session' } } },
    members: [{ id: 'a', name: 'reader', agentType: 'researcher', prompt: 'research', runtime: { providerId: provider.id, modelId: 'opus' }, agentSnapshot: { systemPrompt: 'untrusted altered snapshot', tools: ['Bash'] } }],
  } as any
  const validated = await validateTeamPlanRuntime(plan)
  expect(validated.members[0]!.runtime.modelId).toBe('selected-capable')
  expect(validated.members[0]!.agentSnapshot?.systemPrompt).toBe('Approved read-only role')
  expect(validated.members[0]!.agentSnapshot?.tools).toEqual(['Read'])
  await expect(validateTeamPlanRuntime({ ...plan, members: [{ ...plan.members[0], runtime: { providerId: provider.id, modelId: 'opus', effortLevel: 'invalid' } }] })).rejects.toThrow('Unsupported reasoning effort')
  await expect(validateTeamPlanRuntime({ ...plan, members: [{ ...plan.members[0], agentType: 'missing' }] })).rejects.toThrow('unavailable')
  for (const setting of [{ isolation: 'worktree' }]) {
    await expect(validateTeamPlanRuntime({ ...plan, agentCatalog: { researcher: { ...plan.agentCatalog.researcher, ...setting } } })).rejects.toThrow('unsupported team worker settings')
  }
  await expect(validateTeamPlanRuntime({ ...plan, agentCatalog: { researcher: { ...plan.agentCatalog.researcher, configurationError: 'Inline MCP servers are unsupported' } } })).rejects.toThrow('Inline MCP servers are unsupported')
  for (const permissionMode of ['plan', 'bypassPermissions']) {
    await expect(validateTeamPlanRuntime({ ...plan, agentCatalog: { researcher: { ...plan.agentCatalog.researcher, permissionMode } } })).rejects.toThrow('requires permission mode')
  }
  await expect(validateTeamPlanRuntime({ ...plan, agentCatalog: { researcher: { ...plan.agentCatalog.researcher, permissionMode: 'default' } } })).resolves.toBeDefined()
  await expect(validateTeamPlanRuntime({ ...plan, members: [{ ...plan.members[0], runtime: { providerId: 'missing-provider', modelId: 'cheap' } }] })).rejects.toThrow()
  const { createHash } = await import('node:crypto')
  const { writeTeamFileAsync } = await import('../../utils/swarm/teamHelpers.js')
  const team = { name: 'conflict-check', createdAt: Date.now(), leadSessionId: 'conflict-parent', leadAgentId: 'team-lead@conflict-check', members: [{ agentId: 'reader@conflict-check', name: 'reader', agentType: 'researcher', joinedAt: Date.now(), backendType: 'process', terminated: true }] } as any
  await writeTeamFileAsync(team.name, team)
  await expect(validateTeamPlanRuntime({ ...plan, teamName: team.name, sessionId: team.leadSessionId, incarnationId: createHash('sha256').update(JSON.stringify([team.name, team.leadSessionId, team.createdAt])).digest('hex') })).rejects.toThrow('Member already exists: reader')
})

test('stopping a parent stops its workers and cancels relayed pending approvals', () => {
  const service = new ConversationService() as any
  const killed: string[] = []
  const events: any[] = []
  service.killProcess = (id: string) => killed.push(id)
  service.sessions.set('parent', { outputCallbacks: [(message: any) => events.push(message)], pendingPermissionRequests: new Map() })
  service.sessions.set('child', { teamWorker: worker, pendingPermissionRequests: new Map([['approval', { toolName: 'Bash', input: {} }]]) })
  service.stopSession('parent')
  expect(killed).toEqual(['child', 'parent'])
  expect(service.hasSession('child')).toBe(false)
  expect(events).toContainEqual({ type: 'control_cancel_request', request_id: 'approval' })
})

