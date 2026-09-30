import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ConversationService,
  ConversationStartupError,
} from '../services/conversationService.js'

describe('ConversationService startup output', () => {
  let service: ConversationService
  let tmpDir: string
  const originalEnv = new Map<string, string | undefined>()
  const envKeys = [
    'CLAUDE_CLI_PATH',
    'CLAUDE_CONFIG_DIR',
    'CC_HAHA_DISABLE_TERMINAL_SHELL_ENV',
    'MOCK_SDK_STARTUP_STDOUT',
  ]

  beforeEach(async () => {
    service = new ConversationService()
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-haha-startup-output-'))
    for (const key of envKeys) {
      originalEnv.set(key, process.env[key])
    }

    // DAL 直连 spawn CLI 覆盖路径：.ts 脚本不能被直接执行（Windows ENOENT，
    // POSIX 无 shebang），用平台原生可执行包装 bun 调用 fixture。包装名含
    // `mock-sdk-cli`：本用例验证的是 legacy lane「SDK 反连前退出 → 透传
    // stdout」的契约，需显式命中 legacy 判定。
    const fixturePath = fileURLToPath(
      new URL('./fixtures/mock-startup-exit-cli.ts', import.meta.url),
    )
    if (process.platform === 'win32') {
      const wrapperPath = path.join(tmpDir, 'mock-sdk-cli-startup-exit.cmd')
      await fs.writeFile(
        wrapperPath,
        `@echo off\r\n"${process.execPath}" "${fixturePath}" %*\r\n`,
        'utf-8',
      )
      process.env.CLAUDE_CLI_PATH = wrapperPath
    } else {
      const wrapperPath = path.join(tmpDir, 'mock-sdk-cli-startup-exit.sh')
      await fs.writeFile(
        wrapperPath,
        `#!/bin/sh\nexec "${process.execPath}" "${fixturePath}" "$@"\n`,
        { encoding: 'utf-8', mode: 0o755 },
      )
      process.env.CLAUDE_CLI_PATH = wrapperPath
    }
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.CC_HAHA_DISABLE_TERMINAL_SHELL_ENV = '1'
    process.env.MOCK_SDK_STARTUP_STDOUT = 'provider rejected request: invalid model id'
  })

  afterEach(async () => {
    await service.stopAllSessionsAndWait(1_000)
    for (const key of envKeys) {
      const value = originalEnv.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    originalEnv.clear()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('includes CLI stdout when the process exits before SDK messages', async () => {
    let startupError: unknown

    try {
      await service.startSession(
        `startup-output-${crypto.randomUUID()}`,
        tmpDir,
        'ws://127.0.0.1:1/sdk/startup-output?token=test-token',
      )
    } catch (error) {
      startupError = error
    }

    expect(startupError).toBeInstanceOf(ConversationStartupError)
    expect(startupError).toMatchObject({ code: 'CLI_START_FAILED' })
    expect((startupError as Error).message).toContain(
      'CLI exited during startup (code 1): provider rejected request: invalid model id',
    )
  }, 10_000)
})
