/**
 * 桌面侧 DAL 数据目录解析（与 src/utils/envUtils.ts 的约定保持一致）。
 *
 * 布局：
 *   <数据根>/          默认 ~/.dal，可由 DAL_CONFIG_DIR 覆盖（便携模式）
 *     agent/           dal 引擎配置（settings.json / mcp.json / trust.json）
 *     desktop/         桌面自有状态（窗口、外观、终端、pet 等）
 *       cc-haha/       桌面应用自有数据（数据库、生成图片等）
 *
 * CLAUDE_CONFIG_DIR 仍被兼容读取：既有的便携目录选择和外部启动环境
 * 在迁移期可能仍提供旧变量。
 */

import os from 'node:os'
import path from 'node:path'

export type DataDirAppLike = { getPath(name: 'home'): string }

function resolveHome(
  app: DataDirAppLike | undefined,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string {
  if (app) return app.getPath('home')
  return platform === 'win32'
    ? env.USERPROFILE || os.homedir()
    : env.HOME || os.homedir()
}

/** 数据根目录：DAL_CONFIG_DIR 优先，旧 CLAUDE_CONFIG_DIR 兼容，默认 ~/.dal。 */
export function dalDataDir(
  app: DataDirAppLike | undefined,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const configured = env.DAL_CONFIG_DIR || env.CLAUDE_CONFIG_DIR
  if (configured) return configured
  return path.join(resolveHome(app, env, platform), '.dal')
}

/** dal 引擎配置目录（settings.json / mcp.json 所在）：DAL_CODING_AGENT_DIR 优先，默认 <数据根>/agent。 */
export function dalAgentDir(
  app: DataDirAppLike | undefined,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return env.DAL_CODING_AGENT_DIR || path.join(dalDataDir(app, env, platform), 'agent')
}

/** 桌面自有状态目录：<数据根>/desktop。 */
export function desktopStateDir(
  app: DataDirAppLike | undefined,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(dalDataDir(app, env, platform), 'desktop')
}
