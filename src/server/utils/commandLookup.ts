/**
 * 命令查找与缓存清理的 server 本地实现（窄提取）。
 *
 * 语义对齐引擎 src/commands.ts 的同名导出：
 *   - findCommand/hasCommand/getCommand 为纯函数（按 name/userFacingName/
 *     aliases 匹配），直接移植；
 *   - clearCommandsCache 原版清理引擎命令表的多层 memo
 *     （getSkillToolCommands/getSlashCommandToolSkills/clearSkillIndexCache）
 *     与插件/技能缓存。server 侧不装载引擎命令表，引擎 memo 层不存在，
 *     故只清理 server 侧实际持有的缓存：插件命令/插件技能/技能目录缓存。
 *
 * getSkillToolCommands（技能装配）仍走引擎 commands.js——它挂在 getCommands
 * 全量装载器上，属引擎功能链，随 services/api 大组一并处理。
 */
import {
  getCommandName,
  type Command,
} from '../types/command.js'
import { clearPluginCommandCache, clearPluginSkillsCache } from './plugins/loadPluginCommands.js'
import { clearSkillCaches } from '../skills/loadSkillsDir.js'

export { getCommandName }

export function findCommand(
  commandName: string,
  commands: Command[],
): Command | undefined {
  return commands.find(
    _ =>
      _.name === commandName ||
      getCommandName(_) === commandName ||
      _.aliases?.includes(commandName),
  )
}

export function hasCommand(commandName: string, commands: Command[]): boolean {
  return findCommand(commandName, commands) !== undefined
}

export function getCommand(commandName: string, commands: Command[]): Command {
  const command = findCommand(commandName, commands)
  if (!command) {
    throw ReferenceError(
      `Command ${commandName} not found. Available commands: ${commands
        .map(_ => {
          const name = getCommandName(_)
          return _.aliases ? `${name} (aliases: ${_.aliases.join(', ')})` : name
        })
        .sort((a, b) => a.localeCompare(b))
        .join(', ')}`,
    )
  }

  return command
}

export function clearCommandsCache(): void {
  clearPluginCommandCache()
  clearPluginSkillsCache()
  clearSkillCaches()
}
