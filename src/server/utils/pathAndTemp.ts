/**
 * server 侧路径/临时目录小工具 —— 解耦批次 5 提取。
 *
 * 原实现位于引擎支撑层（src/server/utils/permissions/{pathValidation,filesystem}.ts），
 * server 仅消费其中的 expandTilde 与 getClaudeTempDir 两个函数；此处以 node
 * 内建能力内联等价实现，切断 server → permissions 子系统的直接依赖边
 * （permissions 余量 2400+ 行含 Tool/bootstrap/analytics 深依赖，随引擎休眠）。
 */
import { homedir, tmpdir } from 'node:os'
import { realpathSync } from 'node:fs'
import { join, sep } from 'node:path'

const memoized = new Map<string, string>()

/** 把 `~/x` 形式的路径展开为绝对路径（其余原样返回）。 */
export function expandTilde(path: string): string {
  if (
    path === '~' ||
    path.startsWith('~/') ||
    (process.platform === 'win32' && path.startsWith('~\\'))
  ) {
    return homedir() + path.slice(1)
  }
  return path
}

function getPlatformName(): 'windows' | 'unix' {
  return process.platform === 'win32' ? 'windows' : 'unix'
}

function getClaudeTempDirName(): string {
  if (getPlatformName() === 'windows') {
    return 'claude'
  }
  // Unix 下按 UID 隔离，避免多用户共用 /tmp 时权限冲突
  const uid = process.getuid?.() ?? 0
  return `claude-${uid}`
}

/**
 * 临时目录（带符号链接解析，确保与权限检查用的解析路径一致）。
 * 结果按进程缓存：输入（env + 平台）在启动后不变。
 */
export function getClaudeTempDir(): string {
  const cached = memoized.get('dir')
  if (cached) return cached
  const baseTmpDir =
    process.env.CLAUDE_CODE_TMPDIR ||
    (getPlatformName() === 'windows' ? tmpdir() : '/tmp')
  let resolvedBaseTmpDir = baseTmpDir
  try {
    resolvedBaseTmpDir = realpathSync(baseTmpDir)
  } catch {
    // 解析失败时退回原路径
  }
  const result = join(resolvedBaseTmpDir, getClaudeTempDirName()) + sep
  memoized.set('dir', result)
  return result
}
