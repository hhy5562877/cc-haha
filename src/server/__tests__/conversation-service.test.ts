import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  buildConversationCliSpawnOptions,
  ConversationService,
  DESKTOP_CLI_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
} from '../services/conversationService.js'
import { ProviderService } from '../services/providerService.js'
import { updateTraceCaptureSettings } from '../services/traceCaptureService.js'
import { resetTerminalShellEnvironmentCacheForTests } from '../utils/terminalShellEnvironment.js'

describe('ConversationService', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined
  let originalApiKey: string | undefined
  let originalAuthToken: string | undefined
  let originalBaseUrl: string | undefined
  let originalModel: string | undefined
  let originalEntrypoint: string | undefined
  let originalOAuthToken: string | undefined
  let originalProviderManagedByHost: string | undefined
  let originalLocalAccessToken: string | undefined
  let originalDiagnosticsFile: string | undefined
  let originalAttributionHeader: string | undefined
  let originalDisableExperimentalBetas: string | undefined
  let originalResumeInterruptedTurn: string | undefined
  let originalTraceApiCalls: string | undefined
  let originalTraceProviderId: string | undefined
  let originalTraceProviderName: string | undefined
  let originalTraceProviderFormat: string | undefined
  let originalHome: string | undefined
  let originalPath: string | undefined
  let originalShell: string | undefined
  let originalZdotdir: string | undefined
  let originalDisableTerminalShellEnv: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-haha-conversation-service-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalApiKey = process.env.ANTHROPIC_API_KEY
    originalAuthToken = process.env.ANTHROPIC_AUTH_TOKEN
    originalBaseUrl = process.env.ANTHROPIC_BASE_URL
    originalModel = process.env.ANTHROPIC_MODEL
    originalEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
    originalOAuthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
    originalProviderManagedByHost = process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    originalLocalAccessToken = process.env.CC_HAHA_LOCAL_ACCESS_TOKEN
    originalDiagnosticsFile = process.env.CLAUDE_CODE_DIAGNOSTICS_FILE
    originalAttributionHeader = process.env.CLAUDE_CODE_ATTRIBUTION_HEADER
    originalDisableExperimentalBetas = process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
    originalResumeInterruptedTurn = process.env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN
    originalTraceApiCalls = process.env.CC_HAHA_TRACE_API_CALLS
    originalTraceProviderId = process.env.CC_HAHA_TRACE_PROVIDER_ID
    originalTraceProviderName = process.env.CC_HAHA_TRACE_PROVIDER_NAME
    originalTraceProviderFormat = process.env.CC_HAHA_TRACE_PROVIDER_FORMAT
    originalHome = process.env.HOME
    originalPath = process.env.PATH
    originalShell = process.env.SHELL
    originalZdotdir = process.env.ZDOTDIR
    originalDisableTerminalShellEnv = process.env.CC_HAHA_DISABLE_TERMINAL_SHELL_ENV

    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.ANTHROPIC_API_KEY = 'stale-parent-api-key'
    process.env.ANTHROPIC_AUTH_TOKEN = 'test-token'
    process.env.ANTHROPIC_BASE_URL = 'https://example.invalid/anthropic'
    process.env.ANTHROPIC_MODEL = 'test-model'
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'inherited-parent-oauth-token'
    // Clear inherited CLAUDE_CODE_ENTRYPOINT so tests can assert whether
    // buildChildEnv injects it or not without interference from the shell env.
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    delete process.env.CC_HAHA_LOCAL_ACCESS_TOKEN
    delete process.env.CLAUDE_CODE_DIAGNOSTICS_FILE
    delete process.env.CLAUDE_CODE_ATTRIBUTION_HEADER
    delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
    delete process.env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN
    delete process.env.CC_HAHA_TRACE_API_CALLS
    delete process.env.CC_HAHA_TRACE_PROVIDER_ID
    delete process.env.CC_HAHA_TRACE_PROVIDER_NAME
    delete process.env.CC_HAHA_TRACE_PROVIDER_FORMAT
    process.env.CC_HAHA_DISABLE_TERMINAL_SHELL_ENV = '1'
    resetTerminalShellEnvironmentCacheForTests()
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir

    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalApiKey

    if (originalAuthToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN
    else process.env.ANTHROPIC_AUTH_TOKEN = originalAuthToken

    if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = originalBaseUrl

    if (originalModel === undefined) delete process.env.ANTHROPIC_MODEL
    else process.env.ANTHROPIC_MODEL = originalModel

    if (originalEntrypoint === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
    else process.env.CLAUDE_CODE_ENTRYPOINT = originalEntrypoint

    if (originalOAuthToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = originalOAuthToken

    if (originalProviderManagedByHost === undefined) delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    else process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = originalProviderManagedByHost

    if (originalLocalAccessToken === undefined) delete process.env.CC_HAHA_LOCAL_ACCESS_TOKEN
    else process.env.CC_HAHA_LOCAL_ACCESS_TOKEN = originalLocalAccessToken

    if (originalDiagnosticsFile === undefined) delete process.env.CLAUDE_CODE_DIAGNOSTICS_FILE
    else process.env.CLAUDE_CODE_DIAGNOSTICS_FILE = originalDiagnosticsFile

    if (originalAttributionHeader === undefined) delete process.env.CLAUDE_CODE_ATTRIBUTION_HEADER
    else process.env.CLAUDE_CODE_ATTRIBUTION_HEADER = originalAttributionHeader

    if (originalDisableExperimentalBetas === undefined) delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
    else process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = originalDisableExperimentalBetas

    if (originalResumeInterruptedTurn === undefined) delete process.env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN
    else process.env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN = originalResumeInterruptedTurn

    if (originalTraceApiCalls === undefined) delete process.env.CC_HAHA_TRACE_API_CALLS
    else process.env.CC_HAHA_TRACE_API_CALLS = originalTraceApiCalls

    if (originalTraceProviderId === undefined) delete process.env.CC_HAHA_TRACE_PROVIDER_ID
    else process.env.CC_HAHA_TRACE_PROVIDER_ID = originalTraceProviderId

    if (originalTraceProviderName === undefined) delete process.env.CC_HAHA_TRACE_PROVIDER_NAME
    else process.env.CC_HAHA_TRACE_PROVIDER_NAME = originalTraceProviderName

    if (originalTraceProviderFormat === undefined) delete process.env.CC_HAHA_TRACE_PROVIDER_FORMAT
    else process.env.CC_HAHA_TRACE_PROVIDER_FORMAT = originalTraceProviderFormat

    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome

    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath

    if (originalShell === undefined) delete process.env.SHELL
    else process.env.SHELL = originalShell

    if (originalZdotdir === undefined) delete process.env.ZDOTDIR
    else process.env.ZDOTDIR = originalZdotdir

    if (originalDisableTerminalShellEnv === undefined) delete process.env.CC_HAHA_DISABLE_TERMINAL_SHELL_ENV
    else process.env.CC_HAHA_DISABLE_TERMINAL_SHELL_ENV = originalDisableTerminalShellEnv

    resetTerminalShellEnvironmentCacheForTests()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function writeFakeZsh(filePath: string) {
    await fs.writeFile(
      filePath,
      [
        '#!/bin/sh',
        'command=',
        'while [ "$#" -gt 0 ]; do',
        '  if [ "$1" = "-c" ]; then',
        '    shift',
        '    command="$1"',
        '    break',
        '  fi',
        '  shift',
        'done',
        'if [ -f "$HOME/.zshrc" ]; then',
        '  . "$HOME/.zshrc" </dev/null >/dev/null 2>/dev/null || true',
        'fi',
        'exec /bin/sh -c "$command"',
        '',
      ].join('\n'),
      { mode: 0o755 },
    )
  }

  function installNetworkTestSession(
    service: any,
    sessionId: string,
    sent: string[],
    networkDerivedFirstTokenTimeout = true,
    networkDerivedStreamMaxDuration = true,
  ) {
    const session = {
      outputCallbacks: [],
      networkRoutingFingerprint: '',
      networkDerivedFirstTokenTimeout,
      networkDerivedStreamMaxDuration,
      sdkSocket: {
        send(line: string) {
          sent.push(line)
        },
      },
      pendingOutbound: [],
      usesOfficialOAuth: false,
      officialOAuthToken: null,
      pendingPermissionRequests: new Map(),
    }
    service.sessions.set(sessionId, session)
    return session
  }

  // DAL 子进程契约：宿主不再向 CLI 透传 provider/诊断/内存 env，
  // 任何 CLAUDE_*/ANTHROPIC_*/CC_HAHA_* 继承变量一律剥离（dal 侧凭
  // ~/.dal 配置与 bridge env 自行取鉴权），仅 CALLER_DIR/PWD 钉到 workDir。
  test('buildChildEnv strips inherited CLAUDE_*/ANTHROPIC_*/CC_HAHA_* env for dal sessions', async () => {
    process.env.CC_HAHA_TRACE_API_CALLS = '1'
    process.env.CC_HAHA_LOCAL_ACCESS_TOKEN = 'leaked-host-token'
    process.env.DAL_TEST_PLAIN_VAR = 'survives'
    try {
      const service = new ConversationService() as any
      const env = (await service.buildChildEnv('D:\\workspace\\code\\myself_code\\cc-haha')) as Record<string, string>

      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
      expect(env.ANTHROPIC_MODEL).toBeUndefined()
      expect(env.CLAUDE_CODE_ATTRIBUTION_HEADER).toBeUndefined()
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
      expect(env.CC_HAHA_TRACE_API_CALLS).toBeUndefined()
      expect(env.CC_HAHA_LOCAL_ACCESS_TOKEN).toBeUndefined()
      // 非 Claude 前缀的普通环境变量不受剥离影响。
      expect(env.DAL_TEST_PLAIN_VAR).toBe('survives')
    } finally {
      delete process.env.CC_HAHA_TRACE_API_CALLS
      delete process.env.CC_HAHA_LOCAL_ACCESS_TOKEN
      delete process.env.DAL_TEST_PLAIN_VAR
    }
  })

  test('omits CLI diagnostics when its managed directory resolves through a symlink', async () => {
    if (process.platform === 'win32') return
    const unrelatedDir = path.join(tmpDir, 'unrelated-cli-diagnostics')
    const unrelatedDiagnosticsDir = path.join(unrelatedDir, 'diagnostics')
    await fs.mkdir(unrelatedDiagnosticsDir, { recursive: true, mode: 0o755 })
    await fs.mkdir(path.join(tmpDir, 'cc-haha'), { recursive: true })
    await fs.rm(path.join(tmpDir, 'cc-haha'), { recursive: true, force: true })
    await fs.symlink(unrelatedDir, path.join(tmpDir, 'cc-haha'), 'dir')

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp')) as Record<string, string>

    expect(env.CLAUDE_CODE_DIAGNOSTICS_FILE).toBeUndefined()
    expect((await fs.stat(unrelatedDiagnosticsDir)).mode & 0o777).toBe(0o755)
    await expect(fs.stat(path.join(unrelatedDiagnosticsDir, 'cli-diagnostics.jsonl'))).rejects.toThrow()
  })

  // DAL 契约：CALLER_DIR/PWD 必须钉到 workDir（Bug#5），
  // bridge env 仅在带 sdkUrl 时注入（URL 由 sdkUrl host 推导）。
  test('buildChildEnv pins CALLER_DIR/PWD to the work dir and injects the dal bridge env from sdkUrl', async () => {
    const service = new ConversationService() as any
    const env = (await service.buildChildEnv(
      'bridge-session-1',
      'D:\\workspace\\code\\myself_code\\cc-haha',
      'ws://127.0.0.1:3456/sdk/test-session?token=test',
      { permissionMode: 'bypassPermissions' },
    )) as Record<string, string>

    expect(env.CALLER_DIR).toBe('D:\\workspace\\code\\myself_code\\cc-haha')
    expect(env.PWD).toBe('D:\\workspace\\code\\myself_code\\cc-haha')
    expect(env.DALCODE_BRIDGE_URL).toBe('http://127.0.0.1:3456')
    expect(env.DALCODE_BRIDGE_TOKEN).toBeTruthy()
    expect(env.DAL_GUARD_MODE).toBe('yolo')
  })

  test('buildChildEnv omits the dal bridge env when no sdkUrl is given', async () => {
    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp')) as Record<string, string>

    expect(env.DALCODE_BRIDGE_URL).toBeUndefined()
    expect(env.DALCODE_BRIDGE_TOKEN).toBeUndefined()
    expect(env.DAL_GUARD_MODE).toBeUndefined()
  })

  test('builds hidden CLI spawn options for desktop session subprocesses', () => {
    const env = { CLAUDECODE: '1' }

    expect(buildConversationCliSpawnOptions('/workspace/project', env)).toEqual({
      cwd: '/workspace/project',
      env,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      windowsHide: true,
    })
  })

  test.skipIf(process.platform === 'win32')(
    'buildChildEnv inherits exported terminal shell variables for desktop CLI sessions',
    async () => {
      const shellPath = path.join(tmpDir, 'zsh')
      const nodeBin = path.join(tmpDir, 'node-bin')
      const nvmDir = path.join(tmpDir, '.nvm')
      await fs.mkdir(nodeBin, { recursive: true })
      await fs.mkdir(nvmDir, { recursive: true })
      await writeFakeZsh(shellPath)
      await fs.writeFile(
        path.join(tmpDir, '.zshrc'),
        [
          `export NVM_DIR="${nvmDir}"`,
          `export PATH="${nodeBin}:$PATH"`,
          '',
        ].join('\n'),
      )

      delete process.env.CC_HAHA_DISABLE_TERMINAL_SHELL_ENV
      process.env.HOME = tmpDir
      process.env.SHELL = shellPath
      process.env.PATH = '/usr/bin:/bin'
      delete process.env.ZDOTDIR
      resetTerminalShellEnvironmentCacheForTests()

      const service = new ConversationService() as any
      const env = (await service.buildChildEnv(tmpDir)) as Record<string, string>

      expect(env.NVM_DIR).toBe(nvmDir)
      expect(env.PATH.split(path.delimiter)[0]).toBe(nodeBin)
      expect(env.PATH.split(path.delimiter)).toContain('/usr/bin')
    },
  )

  test('strips inherited provider env when desktop provider config exists', async () => {
    const ccHahaDir = path.join(tmpDir, 'cc-haha')
    await fs.mkdir(ccHahaDir, { recursive: true })
    await fs.writeFile(
      path.join(ccHahaDir, 'providers.json'),
      JSON.stringify({ activeId: null, providers: [] }),
      'utf-8',
    )

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('D:\\workspace\\code\\myself_code\\cc-haha')) as Record<string, string>

    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.ANTHROPIC_MODEL).toBeUndefined()
  })


  test('sendMessage updates a running official OAuth CLI token before the user turn', async () => {
    const { hahaOAuthService } = await import('../services/hahaOAuthService.js')
    await hahaOAuthService.saveTokens({
      accessToken: 'fresh-after-wake-token',
      refreshToken: 'refresh-xxx',
      expiresAt: Date.now() + 30 * 60_000,
      scopes: ['user:inference'],
      subscriptionType: 'max',
    })

    const service = new ConversationService() as any
    const sent: string[] = []
    service.sessions.set('sleep-wake-session', {
      proc: {},
      outputCallbacks: [],
      workDir: tmpDir,
      permissionMode: 'default',
      sdkToken: 'sdk-token',
      sdkSocket: {
        send(line: string) {
          sent.push(line)
        },
      },
      pendingOutbound: [],
      startupPending: false,
      startupExitCode: null,
      stdoutLines: [],
      stderrLines: [],
      outputDrain: Promise.resolve(),
      sdkMessages: [],
      initMessage: null,
      pendingPermissionRequests: new Map(),
      usesOfficialOAuth: true,
      officialOAuthToken: 'stale-before-sleep-token',
    })

    const ok = await service.sendMessage('sleep-wake-session', 'hello after wake')

    expect(ok).toBe(true)
    expect(sent).toHaveLength(2)
    expect(JSON.parse(sent[0]!).type).toBe('update_environment_variables')
    expect(JSON.parse(sent[0]!).variables.CLAUDE_CODE_OAUTH_TOKEN).toBe('fresh-after-wake-token')
    expect(JSON.parse(sent[1]!).type).toBe('user')
  })

  test('recovers a running official OAuth CLI token after the provider rejects it with 401', async () => {
    const { hahaOAuthService } = await import('../services/hahaOAuthService.js')
    await hahaOAuthService.saveTokens({
      accessToken: 'rejected-running-token',
      refreshToken: 'refresh-running-token',
      expiresAt: Date.now() + 30 * 60_000,
      scopes: ['user:inference'],
      subscriptionType: 'pro',
    })
    hahaOAuthService.setRefreshFn(async () => ({
      accessToken: 'recovered-running-token',
      refreshToken: 'refresh-running-next',
      expiresAt: Date.now() + 60 * 60_000,
      scopes: ['user:inference'],
      subscriptionType: 'pro',
      rateLimitTier: null,
    }))

    const service = new ConversationService() as any
    const sent: string[] = []
    const session: any = {
      outputCallbacks: [],
      sdkMessages: [],
      sdkMessageBytes: 0,
      seenSdkMessageUuids: new Set<string>(),
      sdkSocket: { send: (line: string) => sent.push(line) },
      pendingOutbound: [],
      initMessage: null,
      pendingPermissionRequests: new Map(),
      pendingControlRequests: new Map(),
      usesOfficialOAuth: true,
      officialOAuthToken: 'rejected-running-token',
    }
    service.sessions.set('official-401-session', session)

    service.handleSdkPayload('official-401-session', JSON.stringify({
      type: 'system',
      subtype: 'api_retry',
      error_status: 401,
      retry_attempt: 1,
      max_retries: 10,
    }))
    await session.officialOAuthRefreshPromise

    expect(session.officialOAuthToken).toBe('recovered-running-token')
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]!)).toEqual({
      type: 'update_environment_variables',
      variables: { CLAUDE_CODE_OAUTH_TOKEN: 'recovered-running-token' },
    })
  })

  test('does not run Claude OAuth recovery for a third-party provider 401', async () => {
    const { hahaOAuthService } = await import('../services/hahaOAuthService.js')
    let refreshCalls = 0
    hahaOAuthService.setRefreshFn(async () => {
      refreshCalls += 1
      throw new Error('Claude refresh must stay isolated')
    })

    const service = new ConversationService() as any
    const sent: string[] = []
    const session: any = {
      outputCallbacks: [],
      sdkMessages: [],
      sdkMessageBytes: 0,
      seenSdkMessageUuids: new Set<string>(),
      sdkSocket: { send: (line: string) => sent.push(line) },
      pendingOutbound: [],
      initMessage: null,
      pendingPermissionRequests: new Map(),
      pendingControlRequests: new Map(),
      usesOfficialOAuth: false,
      officialOAuthToken: null,
    }
    service.sessions.set('custom-provider-401-session', session)

    service.handleSdkPayload('custom-provider-401-session', JSON.stringify({
      type: 'system',
      subtype: 'api_retry',
      error_status: 401,
    }))
    await Promise.resolve()

    expect(session.officialOAuthRefreshPromise).toBeUndefined()
    expect(refreshCalls).toBe(0)
    expect(sent).toEqual([])
  })

  test('sendMessage does not enqueue a user turn after its owner is cancelled', async () => {
    const service = new ConversationService() as any
    const sent: string[] = []
    installNetworkTestSession(service, 'cancelled-user-turn', sent)
    let canSend = true
    let committed = false

    const pendingSend = service.sendMessage(
      'cancelled-user-turn',
      'Do not enqueue this after Stop',
      undefined,
      {
        canSend: () => canSend,
        messageUuid: 'cancelled-turn-uuid',
        onCommitted: () => {
          committed = true
        },
      },
    )
    canSend = false

    expect(await pendingSend).toBe(false)
    expect(committed).toBe(false)
    expect(sent.map((line) => JSON.parse(line).type)).not.toContain('user')
  })

  test('sendMessage commits the caller UUID with the SDK user payload', async () => {
    const service = new ConversationService() as any
    const sent: string[] = []
    installNetworkTestSession(service, 'identified-user-turn', sent)
    let committed = false

    expect(await service.sendMessage(
      'identified-user-turn',
      'Identify this turn',
      undefined,
      {
        messageUuid: 'identified-turn-uuid',
        onCommitted: () => {
          committed = true
        },
      },
    )).toBe(true)

    expect(committed).toBe(true)
    expect(sent.map((line) => JSON.parse(line))).toContainEqual(expect.objectContaining({
      type: 'user',
      uuid: 'identified-turn-uuid',
    }))
  })

  test('sendMessage hot-applies direct to system routing before the next user turn', async () => {
    const originalBridgeUrl = process.env.CC_HAHA_SYSTEM_PROXY_URL
    process.env.CC_HAHA_SYSTEM_PROXY_URL = 'http://127.0.0.1:17890'
    try {
      await fs.writeFile(
        path.join(tmpDir, 'settings.json'),
        JSON.stringify({ network: { proxy: { mode: 'direct', url: '' } } }),
        'utf-8',
      )
      const service = new ConversationService() as any
      const sent: string[] = []
      const session = installNetworkTestSession(service, 'direct-to-system', sent)
      await service.refreshNetworkEnvironmentBeforeTurn('direct-to-system', session)

      await fs.writeFile(
        path.join(tmpDir, 'settings.json'),
        JSON.stringify({ network: { proxy: { mode: 'system', url: '' } } }),
        'utf-8',
      )

      expect(await service.sendMessage('direct-to-system', 'use system proxy')).toBe(true)
      expect(sent).toHaveLength(2)
      const update = JSON.parse(sent[0]!)
      expect(update.type).toBe('update_environment_variables')
      expect(update.variables).toMatchObject({
        HTTP_PROXY: 'http://127.0.0.1:17890',
        HTTPS_PROXY: 'http://127.0.0.1:17890',
        http_proxy: 'http://127.0.0.1:17890',
        https_proxy: 'http://127.0.0.1:17890',
        ALL_PROXY: 'http://127.0.0.1:17890',
        all_proxy: 'http://127.0.0.1:17890',
        API_TIMEOUT_MS: '1800000',
        CLAUDE_STREAM_FIRST_TOKEN_TIMEOUT_MS: '1800000',
      })
      expect(update.variables.NO_PROXY).toContain('127.0.0.1')
      expect(update.variables.no_proxy).toContain('localhost')
      expect(JSON.parse(sent[1]!).type).toBe('user')
    } finally {
      if (originalBridgeUrl === undefined) delete process.env.CC_HAHA_SYSTEM_PROXY_URL
      else process.env.CC_HAHA_SYSTEM_PROXY_URL = originalBridgeUrl
    }
  })

  test('sendMessage hot-applies manual proxy and timeout changes before the next user turn', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        network: {
          aiRequestTimeoutMs: 600_000,
          proxy: { mode: 'manual', url: 'http://127.0.0.1:17891' },
        },
      }),
      'utf-8',
    )
    const service = new ConversationService() as any
    const sent: string[] = []
    const session = installNetworkTestSession(service, 'manual-change', sent)
    await service.refreshNetworkEnvironmentBeforeTurn('manual-change', session)

    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        network: {
          aiRequestTimeoutMs: 180_000,
          proxy: { mode: 'manual', url: 'http://127.0.0.1:17892' },
        },
      }),
      'utf-8',
    )

    expect(await service.sendMessage('manual-change', 'use changed proxy')).toBe(true)
    expect(sent).toHaveLength(2)
    const update = JSON.parse(sent[0]!)
    expect(update.type).toBe('update_environment_variables')
    expect(update.variables).toMatchObject({
      HTTP_PROXY: 'http://127.0.0.1:17892',
      HTTPS_PROXY: 'http://127.0.0.1:17892',
      ALL_PROXY: 'http://127.0.0.1:17892',
      all_proxy: 'http://127.0.0.1:17892',
      API_TIMEOUT_MS: '180000',
      CLAUDE_STREAM_FIRST_TOKEN_TIMEOUT_MS: '180000',
      // The floor still holds on the hot-update path: lowering the request
      // timeout must not shrink the overall cap below its 600s default.
      CLAUDE_STREAM_MAX_DURATION_MS: '600000',
    })
    expect(JSON.parse(sent[1]!).type).toBe('user')
  })

  test.each([1_800_000, 14_400_000, 21_600_000])('sendMessage hot-applies all raised request budgets in the same conversation (%i ms, #1307)', async timeoutMs => {
    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        network: {
          aiRequestTimeoutMs: 600_000,
          proxy: { mode: 'direct', url: '' },
        },
      }),
      'utf-8',
    )
    const service = new ConversationService() as any
    const sent: string[] = []
    const session = installNetworkTestSession(service, 'raised-timeout', sent)
    await service.refreshNetworkEnvironmentBeforeTurn('raised-timeout', session)

    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        network: {
          aiRequestTimeoutMs: timeoutMs,
          proxy: { mode: 'direct', url: '' },
        },
      }),
      'utf-8',
    )

    expect(await service.sendMessage('raised-timeout', 'retry the long prompt')).toBe(true)
    expect(sent).toHaveLength(2)
    const update = JSON.parse(sent[0]!)
    expect(update.type).toBe('update_environment_variables')
    // The reported path is: user hits the 600s error, raises the timeout, and
    // retries in the SAME conversation. The live CLI re-reads this per request,
    // so it has to be pushed down — otherwise the retry dies at 600s again.
    expect(update.variables.API_TIMEOUT_MS).toBe(String(timeoutMs))
    expect(update.variables.CLAUDE_STREAM_FIRST_TOKEN_TIMEOUT_MS).toBe(String(timeoutMs))
    expect(update.variables.CLAUDE_STREAM_MAX_DURATION_MS).toBe(String(timeoutMs))
    expect(JSON.parse(sent[1]!).type).toBe('user')
  })

  test('sendMessage does not resend network env when the system bridge fingerprint is unchanged', async () => {
    const originalBridgeUrl = process.env.CC_HAHA_SYSTEM_PROXY_URL
    process.env.CC_HAHA_SYSTEM_PROXY_URL = 'http://127.0.0.1:17893'
    try {
      await fs.writeFile(
        path.join(tmpDir, 'settings.json'),
        JSON.stringify({ network: { proxy: { mode: 'system', url: '' } } }),
        'utf-8',
      )
      const service = new ConversationService() as any
      const sent: string[] = []
      const session = installNetworkTestSession(service, 'unchanged-system', sent)
      await service.refreshNetworkEnvironmentBeforeTurn('unchanged-system', session)

      // PAC/system rules are resolved dynamically inside this stable bridge URL.
      // Their changes must not churn the CLI environment between turns.
      expect(await service.sendMessage('unchanged-system', 'same bridge')).toBe(true)

      expect(sent).toHaveLength(1)
      expect(JSON.parse(sent[0]!).type).toBe('user')
    } finally {
      if (originalBridgeUrl === undefined) delete process.env.CC_HAHA_SYSTEM_PROXY_URL
      else process.env.CC_HAHA_SYSTEM_PROXY_URL = originalBridgeUrl
    }
  })

  test('buildChildEnv does NOT inject CLAUDE_CODE_OAUTH_TOKEN when not official mode', async () => {
    const ccHahaDir = path.join(tmpDir, 'cc-haha')
    await fs.mkdir(ccHahaDir, { recursive: true })
    await fs.writeFile(
      path.join(ccHahaDir, 'settings.json'),
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'custom-provider-token' } }),
      'utf-8',
    )

    const { hahaOAuthService } = await import('../services/hahaOAuthService.js')
    await hahaOAuthService.saveTokens({
      accessToken: 'haha-token-should-not-be-used',
      refreshToken: null,
      expiresAt: null,
      scopes: [],
      subscriptionType: null,
    })

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp')) as Record<string, string>

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
  })

  test('buildChildEnv does not inject trace env when managed trace capture is disabled', async () => {
    await updateTraceCaptureSettings({ enabled: false })
    const providerService = new ProviderService()
    const provider = await providerService.addProvider({
      presetId: 'custom',
      name: 'Trace disabled provider',
      apiKey: 'provider-key',
      baseUrl: 'https://traceable.example',
      apiFormat: 'anthropic',
      models: {
        main: 'gpt-5.5',
        haiku: '',
        sonnet: '',
        opus: '',
      },
    })

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv(
      '/tmp',
      'ws://127.0.0.1:3456/sdk/test-session?token=test-token',
      { providerId: provider.id },
    )) as Record<string, string>

    expect(env.CC_HAHA_TRACE_API_CALLS).toBeUndefined()
    expect(env.CC_HAHA_TRACE_PROVIDER_ID).toBeUndefined()
    expect(env.CC_HAHA_TRACE_PROVIDER_NAME).toBeUndefined()
    expect(env.CC_HAHA_TRACE_PROVIDER_FORMAT).toBeUndefined()
  })

  test('buildChildEnv does not inject Claude OAuth when ChatGPT Official is active', async () => {
    const providerService = new ProviderService()
    await providerService.activateProvider('openai-official')

    const { hahaOAuthService } = await import('../services/hahaOAuthService.js')
    await hahaOAuthService.saveTokens({
      accessToken: 'claude-oauth-token-that-must-not-be-used',
      refreshToken: 'claude-refresh-token',
      expiresAt: Date.now() + 30 * 60_000,
      scopes: ['user:inference'],
      subscriptionType: 'max',
    })

    const service = new ConversationService() as any
    const env = (await service.buildChildEnv('/tmp')) as Record<string, string>

    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })

  // DAL 契约：可执行文件解析优先级为 DAL_CLI_PATH/CLAUDE_CLI_PATH 覆盖 →
  // 打包 sidecar → 仓库 rpc-entry → PATH 上的 `dal`；不再有 bun/preload 入口。
  test('resolves the dal sidecar entrypoint with env override taking precedence', () => {
    const service = new ConversationService() as any
    const previousDal = process.env.DAL_CLI_PATH
    const previousClaude = process.env.CLAUDE_CLI_PATH
    try {
      process.env.DAL_CLI_PATH = path.join(tmpDir, 'dal-fixture')
      delete process.env.CLAUDE_CLI_PATH
      expect(service.resolveDalCliArgs(['--mode', 'rpc'])).toEqual([
        path.join(tmpDir, 'dal-fixture'),
        '--mode',
        'rpc',
      ])
    } finally {
      if (previousDal === undefined) delete process.env.DAL_CLI_PATH
      else process.env.DAL_CLI_PATH = previousDal
      if (previousClaude === undefined) delete process.env.CLAUDE_CLI_PATH
      else process.env.CLAUDE_CLI_PATH = previousClaude
    }
  })

  test('buildSessionCliArgs emits the dal rpc base args without legacy streaming flags', () => {
    const service = new ConversationService() as any
    const args = service.buildSessionCliArgs(
      '123e4567-e89b-12d3-a456-426614174000',
      'ws://127.0.0.1:3456/sdk/test-session?token=test-token',
      false,
      { permissionMode: 'bypassPermissions' },
    ) as string[]

    // args[0] 是环境相关的 dal 可执行路径，其余为固定 rpc 基座。
    expect(args.slice(1)).toEqual(['--mode', 'rpc', '--session-id', '123e4567-e89b-12d3-a456-426614174000'])
    expect(args).not.toContain('--include-partial-messages')
    expect(args).not.toContain('--sdk-url')
    expect(args).not.toContain('--replay-user-messages')
  })

  test('buildChildEnv disables inherited interrupted-turn resume for prewarm launches', async () => {
    process.env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN = '1'
    const service = new ConversationService() as any
    const env = (await service.buildChildEnv(
      '/tmp',
      'ws://127.0.0.1:3456/sdk/test-session?token=test-token',
      { resumeInterruptedTurn: false },
    )) as Record<string, string>

    expect(env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN).toBeUndefined()
  })


  // DAL 契约：effort 映射为 --thinking；模型/provider 不从桌面直传
  //（dal 以 ~/.dal/agent/settings.json 为唯一事实源，运行时切换走 RPC set_model）。
  test('buildSessionCliArgs forwards the selected effort as --thinking and never passes a desktop model', () => {
    const service = new ConversationService() as any
    const args = service.buildSessionCliArgs(
      '123e4567-e89b-12d3-a456-426614174000',
      'ws://127.0.0.1:3456/sdk/test-session?token=test-token',
      false,
      {
        model: 'model-b-opus',
        effort: 'max',
      },
    ) as string[]

    expect(args.slice(1)).toEqual([
      '--mode', 'rpc',
      '--session-id', '123e4567-e89b-12d3-a456-426614174000',
      '--thinking', 'max',
    ])
    expect(args).not.toContain('--model')
    expect(args).not.toContain('model-b-opus')
  })

  // DAL 契约：worktree 不再走 CLI flag，由 launchWorkDir 的 cwd 承载。
  test('buildSessionCliArgs does not pass worktree flags for pending desktop worktrees', () => {
    const service = new ConversationService() as any
    const args = service.buildSessionCliArgs(
      '123e4567-e89b-12d3-a456-426614174000',
      'ws://127.0.0.1:3456/sdk/test-session?token=test-token',
      false,
      undefined,
      {
        requestedWorkDir: '/tmp/source-repo',
        repoRoot: '/tmp/source-repo',
        branch: 'feature/rail',
        worktree: true,
        baseRef: 'feature/rail',
        worktreeSlug: 'desktop-feature-rail-123e4567',
      },
    ) as string[]

    expect(args.slice(1)).toEqual(['--mode', 'rpc', '--session-id', '123e4567-e89b-12d3-a456-426614174000'])
    expect(args).not.toContain('--worktree')
    expect(args).not.toContain('--worktree-base-ref')
  })

  test('stopAllSessionsAndWait kills every active CLI subprocess and waits for exits', async () => {
    const service = new ConversationService() as any
    const killed: string[] = []
    const drained: string[] = []

    const makeSession = (sessionId: string) => {
      let resolveExit: (code: number) => void = () => {}
      const exited = new Promise<number>((resolve) => {
        resolveExit = resolve
      })

      return {
        proc: {
          kill: () => {
            killed.push(sessionId)
            resolveExit(0)
          },
          exited,
        },
        outputCallbacks: [],
        workDir: tmpDir,
        permissionMode: 'default',
        sdkToken: `${sessionId}-token`,
        sdkSocket: null,
        pendingOutbound: [],
        startupPending: false,
        startupExitCode: null,
        stdoutLines: [],
        stderrLines: [],
        outputDrain: Promise.resolve().then(() => {
          drained.push(sessionId)
        }),
        sdkMessages: [],
        initMessage: null,
        pendingPermissionRequests: new Map(),
      }
    }

    service.sessions.set('session-a', makeSession('session-a'))
    service.sessions.set('session-b', makeSession('session-b'))

    await service.stopAllSessionsAndWait(500)

    expect(killed.sort()).toEqual(['session-a', 'session-b'])
    expect(drained.sort()).toEqual(['session-a', 'session-b'])
    expect(service.getActiveSessions()).toEqual([])
  })

  test('default CLI shutdown wait covers the CLI graceful cleanup budget', () => {
    expect(DESKTOP_CLI_GRACEFUL_SHUTDOWN_TIMEOUT_MS).toBeGreaterThanOrEqual(6_000)
  })

  test('isolates SDK output callbacks so one broken client cannot swallow turn completion', () => {
    const service = new ConversationService() as any
    let completionObserved = false
    service.sessions.set('callback-isolation', {
      outputCallbacks: [
        () => { throw new Error('closed client socket') },
        (message: any) => { completionObserved = message.type === 'result' },
      ],
      sdkMessages: [],
      initMessage: null,
      pendingPermissionRequests: new Map(),
    })

    service.handleSdkPayload('callback-isolation', JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
    }))

    expect(completionObserved).toBe(true)
  })

  test('rejects a permission request that arrives behind a stopped turn boundary', () => {
    const service = new ConversationService() as any
    const outbound: string[] = []
    const forwarded: any[] = []
    service.sessions.set('stopped-permission-boundary', {
      outputCallbacks: [(message: any) => forwarded.push(message)],
      seenSdkMessageUuids: new Set<string>(),
      sdkMessages: [],
      sdkSocket: { send: (message: string) => outbound.push(message) },
      pendingOutbound: [],
      initMessage: null,
      pendingPermissionRequests: new Map(),
    })

    service.handleSdkPayload('stopped-permission-boundary', JSON.stringify({
      type: 'control_request',
      request_id: 'late-permission',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'echo stale' },
      },
    }), {
      canAcceptPermissionRequest: () => false,
    })

    expect(service.getPendingPermissionRequests('stopped-permission-boundary')).toEqual([])
    expect(forwarded).toEqual([])
    expect(outbound).toHaveLength(1)
    expect(JSON.parse(outbound[0]!)).toEqual(expect.objectContaining({
      type: 'control_response',
      response: expect.objectContaining({
        request_id: 'late-permission',
        response: expect.objectContaining({ behavior: 'deny' }),
      }),
    }))
  })

  test('retains teammate display_name on pending permission requests', () => {
    const service = new ConversationService() as any
    service.sessions.set('lead-session', {
      outputCallbacks: [],
      seenSdkMessageUuids: new Set<string>(),
      sdkMessages: [],
      initMessage: null,
      pendingPermissionRequests: new Map(),
    })

    service.handleSdkPayload('lead-session', JSON.stringify({
      type: 'control_request',
      request_id: 'teammate-perm',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        tool_use_id: 'toolu_teammate',
        input: { command: 'ls' },
        description: 'list files',
        display_name: 'researcher',
      },
    }))

    expect(service.getPendingPermissionRequests('lead-session')).toEqual([{
      requestId: 'teammate-perm',
      toolName: 'Bash',
      toolUseId: 'toolu_teammate',
      input: { command: 'ls' },
      description: 'list files',
      displayName: 'researcher',
    }])
  })

  // CLI 的 WebSocketTransport 每次重连成功都会把整个发送缓冲区重放一遍，并假定
  // 「The server deduplicates by UUID」。以前 server 没实现这个契约：笔记本睡醒后
  // CLI 重连，一整轮早已结束的对话会被重新推上来，前端当成实时输出再渲染一遍
  // （表现为满屏「已思考」）。
  test('drops SDK messages replayed by the CLI after a reconnect', () => {
    const service = new ConversationService() as any
    const forwarded: any[] = []
    service.sessions.set('replay-dedupe', {
      outputCallbacks: [(message: any) => forwarded.push(message)],
      seenSdkMessageUuids: new Set<string>(),
      sdkMessages: [],
      initMessage: null,
      pendingPermissionRequests: new Map(),
    })

    const turn = [
      { type: 'assistant', uuid: 'uuid-thinking-1', message: { content: [{ type: 'thinking', thinking: 'step one' }] } },
      { type: 'assistant', uuid: 'uuid-thinking-2', message: { content: [{ type: 'thinking', thinking: 'step two' }] } },
      { type: 'result', uuid: 'uuid-result', subtype: 'success', is_error: false },
    ]
    const payload = turn.map((msg) => JSON.stringify(msg)).join('\n')

    service.handleSdkPayload('replay-dedupe', payload)
    expect(forwarded).toHaveLength(3)

    // 重连后 CLI 把同一批消息从缓冲区头部重放 —— 一条都不该再转发出去。
    service.handleSdkPayload('replay-dedupe', payload)
    service.handleSdkPayload('replay-dedupe', payload)
    expect(forwarded).toHaveLength(3)
  })

  // 真机日志（cli-diagnostics.jsonl.58975）显示重放的 858 条里绝大多数是 stream_event：
  // 桌面端固定传 --include-partial-messages，CLI 为每个 thinking_delta 单独产一条
  // stream_event 并现铸 uuid（QueryEngine.ts:846），所以重放到达前端时是 delta 碎片，
  // 而不是整块 thinking。渲染侧的逐字比对挡不住碎片，只有这里的 uuid 判重挡得住。
  test('drops replayed partial-message stream events, not just whole assistant blocks', () => {
    const service = new ConversationService() as any
    const forwarded: any[] = []
    service.sessions.set('replay-stream-events', {
      outputCallbacks: [(message: any) => forwarded.push(message)],
      seenSdkMessageUuids: new Set<string>(),
      sdkMessages: [],
      initMessage: null,
      pendingPermissionRequests: new Map(),
    })

    const deltas = ['Start: get_', 'app_state to find ', 'the search box.']
    const payload = deltas
      .map((thinking, index) =>
        JSON.stringify({
          type: 'stream_event',
          uuid: `uuid-stream-${index}`,
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking },
          },
        }),
      )
      .join('\n')

    service.handleSdkPayload('replay-stream-events', payload)
    expect(forwarded).toHaveLength(deltas.length)

    service.handleSdkPayload('replay-stream-events', payload)
    expect(forwarded).toHaveLength(deltas.length)
  })

  test('keeps forwarding SDK messages that carry no uuid', () => {
    const service = new ConversationService() as any
    const forwarded: any[] = []
    service.sessions.set('no-uuid', {
      outputCallbacks: [(message: any) => forwarded.push(message)],
      seenSdkMessageUuids: new Set<string>(),
      sdkMessages: [],
      initMessage: null,
      pendingPermissionRequests: new Map(),
    })

    // 没有 uuid 的消息不会进 CLI 的重放缓冲，所以也不该被判重丢弃。
    const payload = JSON.stringify({ type: 'result', subtype: 'success', is_error: false })
    service.handleSdkPayload('no-uuid', payload)
    service.handleSdkPayload('no-uuid', payload)

    expect(forwarded).toHaveLength(2)
  })

  test('tolerates sessions created without the replay-dedupe bookkeeping', () => {
    const service = new ConversationService() as any
    const forwarded: any[] = []
    // 故意不带 seenSdkMessageUuids，模拟别处构造出来的会话对象。
    service.sessions.set('legacy-shape', {
      outputCallbacks: [(message: any) => forwarded.push(message)],
      sdkMessages: [],
      initMessage: null,
      pendingPermissionRequests: new Map(),
    })

    const payload = JSON.stringify({
      type: 'assistant',
      uuid: 'uuid-legacy',
      message: { content: [{ type: 'thinking', thinking: 'hello' }] },
    })
    service.handleSdkPayload('legacy-shape', payload)
    service.handleSdkPayload('legacy-shape', payload)

    expect(forwarded).toHaveLength(1)
  })

  test('remembers enough uuids to cover a full CLI replay buffer', () => {
    const service = new ConversationService() as any
    const forwarded: any[] = []
    service.sessions.set('buffer-span', {
      outputCallbacks: [(message: any) => forwarded.push(message)],
      seenSdkMessageUuids: new Set<string>(),
      sdkMessages: [],
      initMessage: null,
      pendingPermissionRequests: new Map(),
    })

    // CLI 侧缓冲上限是 1000 条，整个缓冲区被重放时每一条都必须还认得出来。
    const CLI_REPLAY_BUFFER_SIZE = 1000
    const payload = Array.from({ length: CLI_REPLAY_BUFFER_SIZE }, (_unused, index) =>
      JSON.stringify({ type: 'assistant', uuid: `uuid-${index}`, message: { content: [] } }),
    ).join('\n')

    service.handleSdkPayload('buffer-span', payload)
    expect(forwarded).toHaveLength(CLI_REPLAY_BUFFER_SIZE)

    service.handleSdkPayload('buffer-span', payload)
    expect(forwarded).toHaveLength(CLI_REPLAY_BUFFER_SIZE)
  })

  test('removes an exited CLI session even when one output callback throws', async () => {
    const service = new ConversationService() as any
    const sessionId = 'exit-callback-isolation'
    const proc = {
      exited: Promise.resolve(1),
      kill: () => {},
    }
    let completionObserved = false
    service.sessions.set(sessionId, {
      proc,
      startupPending: false,
      startupExitCode: null,
      outputDrain: Promise.resolve(),
      outputCallbacks: [
        () => { throw new Error('closed client socket') },
        (message: any) => { completionObserved = message.type === 'result' },
      ],
      workDir: tmpDir,
      permissionMode: 'default',
      stdoutLines: [],
      stderrLines: [],
      sdkMessages: [],
      pendingPermissionRequests: new Map(),
    })

    await service.handleProcessExit(sessionId, proc, 1)

    expect(completionObserved).toBe(true)
    expect(service.hasSession(sessionId)).toBe(false)
  })

  test('summarizes SDK diagnostics with transport metadata only', () => {
    const service = new ConversationService()
    const summarized = (service as any).summarizeSdkMessages([{
      type: 'assistant',
      subtype: 'api_error',
      is_error: true,
      status: 'failed',
      result: 'PRIVATE_SDK_RESULT',
      error: 'PRIVATE_SDK_ERROR',
      errorDetails: 'PRIVATE_ERROR_DETAILS',
      message: {
        content: [{ type: 'text', text: 'PRIVATE_ASSISTANT_REPLY' }],
      },
    }])

    expect(summarized).toEqual([{
      type: 'assistant',
      subtype: 'api_error',
      is_error: true,
      status: 'failed',
      errorCategory: 'api_error',
    }])
    const serialized = JSON.stringify(summarized)
    expect(serialized).not.toContain('PRIVATE_SDK_RESULT')
    expect(serialized).not.toContain('PRIVATE_SDK_ERROR')
    expect(serialized).not.toContain('PRIVATE_ERROR_DETAILS')
    expect(serialized).not.toContain('PRIVATE_ASSISTANT_REPLY')
  })
})
