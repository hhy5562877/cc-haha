/**
 * Settings Service — 读写用户级和项目级设置文件（DAL 体系）
 *
 * 设置文件为 JSON 格式：
 *   - 用户级: ~/.dal/agent/settings.json（dal 全局设置，DAL_CODING_AGENT_DIR 可覆盖）
 *   - 项目级: {projectRoot}/.dal/settings.json（dal 项目设置，需项目信任）
 *
 * 键映射（其余键原样透传，dal SettingsManager 会保留未知键）：
 *   桌面 model  <-> dal defaultModel
 *   桌面 effort <-> dal defaultThinkingLevel
 *
 * 生效时机：dal sidecar 进程在会话启动时读取 settings.json；写入后对
 * 已运行会话不即时生效（新会话/重启 sidecar 后生效）。桌面 UI 经本服务
 * 读写文件，立即反映最新值。
 */

import * as fs from 'fs/promises'
import { randomBytes } from 'node:crypto'
import * as path from 'path'
import * as os from 'os'
import { ApiError } from '../middleware/errorHandler.js'
import { normalizeJsonObject, readRecoverableJsonFile } from './recoverableJsonFile.js'
import { ensurePersistentStorageUpgraded } from './persistentStorageMigrations.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { addFileGlobRuleToGitignore } from '../../utils/git/gitignore.js'
import { getCcHahaDir, getClaudeConfigHomeDir, isEnvTruthy } from '../../utils/envUtils.js'
import { getProcessEnvWithTerminalShellEnvironment } from '../../utils/terminalShellEnvironment.js'
import type { ModelMapping } from '../types/provider.js'

/** 迁移期旧 Claude 配置根（仅读，用于一次性搬迁）。 */
function legacyClaudeConfigDir(): string {
  return path.join(os.homedir(), '.claude')
}

export const VALID_PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
  'dontAsk',
  'auto',
] as const

export type PermissionMode = (typeof VALID_PERMISSION_MODES)[number]

export function isValidPermissionMode(mode: unknown): mode is PermissionMode {
  return typeof mode === 'string' && VALID_PERMISSION_MODES.includes(mode as PermissionMode)
}

export class SettingsService {
  private static writeLocks = new Map<string, Promise<void>>()
  private projectRoot?: string

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot
  }

  /** dal 引擎配置目录（~/.dal/agent，DAL_CODING_AGENT_DIR 可覆盖） */
  private getConfigDir(): string {
    return getClaudeConfigHomeDir()
  }

  /** 用户级设置文件路径（dal 全局设置） */
  private getUserSettingsPath(): string {
    return path.join(this.getConfigDir(), 'settings.json')
  }

  /** 项目级设置文件路径（dal 项目设置） */
  private getProjectSettingsPath(projectRoot?: string): string {
    const root = projectRoot || this.projectRoot
    if (!root) {
      throw ApiError.badRequest('Project root is required for project settings')
    }
    return path.join(root, '.dal', 'settings.json')
  }

  /**
   * 项目本地设置文件路径。dal 体系只有全局+项目两层，local 层并入项目层
   * （同文件浅合并，互不覆盖其他键）。
   */
  private getLocalSettingsPath(projectRoot?: string): string {
    return this.getProjectSettingsPath(projectRoot)
  }

  // ---------------------------------------------------------------------------
  // 键映射与旧数据迁移
  // ---------------------------------------------------------------------------

  /**
   * 桌面 API 键 → dal settings 键。只有两组语义映射，其余键原样透传
   * （dal SettingsManager 按需读取已知键，未知键在保存时保留）。
   */
  private static toDalSettings(settings: Record<string, unknown>): Record<string, unknown> {
    const { model, effort, ...rest } = settings
    if (model !== undefined) rest.defaultModel = model
    if (effort !== undefined) rest.defaultThinkingLevel = effort
    return rest
  }

  /** dal settings 键 → 桌面 API 键；旧 model/effort 键作为迁移期 fallback。 */
  private static fromDalSettings(settings: Record<string, unknown>): Record<string, unknown> {
    const { defaultModel, defaultThinkingLevel, model, effort, ...rest } = settings
    if (defaultModel !== undefined || model !== undefined) {
      rest.model = defaultModel ?? model
    }
    if (defaultThinkingLevel !== undefined || effort !== undefined) {
      rest.effort = defaultThinkingLevel ?? effort
    }
    return rest
  }

  /**
   * 一次性迁移：旧 ~/.claude/settings.json → ~/.dal/agent/settings.json，
   * 同时完成 model→defaultModel、effort→defaultThinkingLevel 键转换。
   * 新文件已存在（或旧文件不存在）时不做任何事。
   */
  private async ensureUserSettingsMigrated(): Promise<void> {
    if (this.userSettingsMigration) return this.userSettingsMigration
    this.userSettingsMigration = (async () => {
      const targetPath = this.getUserSettingsPath()
      try {
        await fs.access(targetPath)
        return
      } catch {
        // 目标不存在，继续迁移
      }
      const legacyPath = path.join(legacyClaudeConfigDir(), 'settings.json')
      let legacy: string
      try {
        legacy = await fs.readFile(legacyPath, 'utf-8')
      } catch {
        return
      }
      try {
        const parsed = JSON.parse(legacy.replace(/^\uFEFF/, ''))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
        await fs.mkdir(path.dirname(targetPath), { recursive: true })
        await fs.writeFile(
          targetPath,
          JSON.stringify(SettingsService.toDalSettings(normalizeJsonObject(parsed)), null, 2) + '\n',
          'utf-8',
        )
      } catch {
        // 旧文件损坏时不阻塞新体系的读取
      }
    })()
    return this.userSettingsMigration
  }

  /** 供测试重置一次性迁移状态。 */
  resetUserSettingsMigrationForTests(): void {
    this.userSettingsMigration = null
  }

  // ---------------------------------------------------------------------------
  // 读取
  // ---------------------------------------------------------------------------

  /** 安全读取 JSON 文件，文件不存在时返回空对象 */
  private async readJsonFile(filePath: string): Promise<Record<string, unknown>> {
    await ensurePersistentStorageUpgraded()
    return readRecoverableJsonFile({
      filePath,
      label: 'settings',
      defaultValue: {},
      normalize: normalizeJsonObject,
    })
  }

  /** 获取合并后的设置（user + project） */
  async getSettings(projectRoot?: string): Promise<Record<string, unknown>> {
    const user = await this.getUserSettings()
    try {
      const project = await this.getProjectSettings(projectRoot)
      return Object.assign({}, user, project)
    } catch {
      // project root 未指定时，仅返回 user settings
      return user
    }
  }

  /** 获取用户级设置 */
  async getUserSettings(): Promise<Record<string, unknown>> {
    return this.readJsonFile(this.getUserSettingsPath())
  }

  /** Read-time upgrade for older settings that only stored the team env flag.
   * Keep the original file intact until the user explicitly saves a choice.
   */
  async getAgentTeamsEnabled(): Promise<boolean> {
    const user = await this.getUserSettings()
    if (typeof user.agentTeamsEnabled === 'boolean') return user.agentTeamsEnabled
    const managed = await this.readJsonFile(path.join(this.getConfigDir(), 'cc-haha', 'settings.json'))
    const inherited = await getProcessEnvWithTerminalShellEnvironment()
    const key = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'
    const legacyValue = normalizeJsonObject(managed.env)?.[key] ??
      normalizeJsonObject(user.env)?.[key] ?? inherited[key]
    return typeof legacyValue === 'string' ? isEnvTruthy(legacyValue) : true
  }

  /** 获取项目级设置 */
  async getProjectSettings(projectRoot?: string): Promise<Record<string, unknown>> {
    return this.readJsonFile(this.getProjectSettingsPath(projectRoot))
  }

  /** 获取项目本地设置 */
  async getLocalSettings(projectRoot?: string): Promise<Record<string, unknown>> {
    return this.readJsonFile(this.getLocalSettingsPath(projectRoot))
  }

  // ---------------------------------------------------------------------------
  // 写入（原子写入：先写临时文件，再 rename）
  // ---------------------------------------------------------------------------

  /** 原子写入 JSON 文件 */
  private async withWriteLock<T>(
    filePath: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previousWrite = SettingsService.writeLocks.get(filePath) ?? Promise.resolve()
    const nextWrite = previousWrite
      .catch(() => {})
      .then(task)

    SettingsService.writeLocks.set(filePath, nextWrite)

    try {
      return await nextWrite
    } finally {
      if (SettingsService.writeLocks.get(filePath) === nextWrite) {
        SettingsService.writeLocks.delete(filePath)
      }
    }
  }

  private async writeJsonFile(
    filePath: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const dir = path.dirname(filePath)
    const contents = JSON.stringify(data, null, 2) + '\n'
    let lastError: unknown

    for (let attempt = 0; attempt < 2; attempt++) {
      const tmpFile = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomBytes(6).toString('hex')}`
      try {
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(tmpFile, contents, 'utf-8')
        await fs.rename(tmpFile, filePath)
        resetSettingsCache()
        return
      } catch (err) {
        lastError = err
        await fs.unlink(tmpFile).catch(() => {})

        if (
          (err as NodeJS.ErrnoException).code !== 'ENOENT' ||
          attempt === 1
        ) {
          break
        }
      }
    }

    throw ApiError.internal(
      `Failed to write settings to ${filePath}: ${lastError}`,
    )
  }

  /** 更新用户级设置（顶层浅合并，并保留桌面终端的未知子字段） */
  async updateUserSettings(settings: Record<string, unknown>): Promise<void> {
    if (Object.hasOwn(settings, 'agentTeamsEnabled') && typeof settings.agentTeamsEnabled !== 'boolean') {
      throw ApiError.badRequest('agentTeamsEnabled must be a boolean')
    }
    const filePath = this.getUserSettingsPath()
    await this.withWriteLock(filePath, async () => {
      const current = await this.readJsonFile(filePath)
      const merged = Object.assign({}, current, settings)
      const currentDesktopTerminal = normalizeJsonObject(current.desktopTerminal)
      const updatedDesktopTerminal = normalizeJsonObject(settings.desktopTerminal)
      if (currentDesktopTerminal && updatedDesktopTerminal) {
        merged.desktopTerminal = Object.assign(
          {},
          currentDesktopTerminal,
          updatedDesktopTerminal,
        )
      }
      await this.writeJsonFile(filePath, merged)
    })
  }

  /**
   * Persist the model aliases owned by the built-in Claude OAuth provider while
   * preserving unrelated user env keys. The provider picker writes all aliases
   * as one locked update so two settings actions cannot lose each other's env.
   */
  async updateOfficialModelMapping(models: ModelMapping): Promise<void> {
    const filePath = this.getUserSettingsPath()
    await this.withWriteLock(filePath, async () => {
      const current = await this.readJsonFile(filePath)
      const env = {
        ...(normalizeJsonObject(current.env) as Record<string, string> | undefined),
        ANTHROPIC_MODEL: models.main,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: models.haiku,
        ANTHROPIC_DEFAULT_SONNET_MODEL: models.sonnet,
        ANTHROPIC_DEFAULT_OPUS_MODEL: models.opus,
      }
      if (models.fable) {
        env.ANTHROPIC_DEFAULT_FABLE_MODEL = models.fable
      } else {
        delete env.ANTHROPIC_DEFAULT_FABLE_MODEL
      }

      const next = {
        ...current,
        model: models.main,
        env,
      }
      delete next.modelContext
      await this.writeJsonFile(filePath, next)
    })
  }

  /** 更新项目级设置（浅合并） */
  async updateProjectSettings(
    settings: Record<string, unknown>,
    projectRoot?: string,
  ): Promise<void> {
    const filePath = this.getProjectSettingsPath(projectRoot)
    await this.withWriteLock(filePath, async () => {
      const current = await this.readJsonFile(filePath)
      const merged = Object.assign({}, current, settings)
      await this.writeJsonFile(filePath, merged)
    })
  }

  /** 更新项目本地设置（浅合并） */
  async updateLocalSettings(
    settings: Record<string, unknown>,
    projectRoot?: string,
  ): Promise<void> {
    const root = projectRoot || this.projectRoot
    const filePath = this.getLocalSettingsPath(projectRoot)
    await this.withWriteLock(filePath, async () => {
      const current = await this.readJsonFile(filePath)
      const merged = Object.assign({}, current, settings)
      await this.writeJsonFile(filePath, merged)
    })
    if (root) {
      void addFileGlobRuleToGitignore('.claude/settings.local.json', root)
    }
  }

  /**
   * 合并单个内置 Agent 的 model/effort 覆盖。
   *
   * `patch` 为 null 时删除 model/effort；字段值为 null 时只删该字段。
   * 条目清空后连同条目一起删除，`builtInAgentOverrides` 变空时删掉这个 key，
   * 不在用户的 settings.json 里留下空壳。
   *
   * 不走 updateUserSettings：那是顶层浅合并，传一个 builtInAgentOverrides 会
   * 整体替换 record。若在调用方先读再算差量，读改写就落在写锁之外，连点两个
   * Agent 会丢掉一次更新。
   */
  async updateBuiltInAgentOverride(
    agentType: string,
    patch: {
      model?: string | null
      effort?: string | number | null
    } | null,
  ): Promise<void> {
    const filePath = this.getUserSettingsPath()
    await this.withWriteLock(filePath, async () => {
      const current = await this.readJsonFile(filePath)
      const overrides = { ...(normalizeJsonObject(current.builtInAgentOverrides) ?? {}) }

      const entry = { ...(normalizeJsonObject(overrides[agentType]) ?? {}) }
      if (patch === null) {
        // Clear only the fields this API owns. The schema deliberately allows
        // future per-agent fields, so reset must not erase data written by a
        // newer client or another settings editor.
        delete entry.model
        delete entry.effort
      } else {
        for (const field of ['model', 'effort'] as const) {
          if (!Object.hasOwn(patch, field)) continue
          if (patch[field] === null) {
            delete entry[field]
          } else {
            entry[field] = patch[field]
          }
        }
      }
      if (Object.keys(entry).length === 0) {
        delete overrides[agentType]
      } else {
        overrides[agentType] = entry
      }

      const merged = Object.assign({}, current)
      if (Object.keys(overrides).length === 0) {
        delete merged.builtInAgentOverrides
      } else {
        merged.builtInAgentOverrides = overrides
      }
      await this.writeJsonFile(filePath, merged)
    })
  }

  // ---------------------------------------------------------------------------
  // 权限模式
  // ---------------------------------------------------------------------------

  /** 获取当前权限模式 */
  async getPermissionMode(): Promise<string> {
    const settings = await this.getUserSettings()
    const mode = settings.defaultMode
    return isValidPermissionMode(mode)
      ? mode
      : 'default'
  }

  /** 设置权限模式 */
  async setPermissionMode(mode: string): Promise<void> {
    if (!isValidPermissionMode(mode)) {
      throw ApiError.badRequest(
        `Invalid permission mode: "${mode}". Valid modes: ${VALID_PERMISSION_MODES.join(', ')}`,
      )
    }
    await this.updateUserSettings({ defaultMode: mode })
  }
}
