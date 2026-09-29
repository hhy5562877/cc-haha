/**
 * DAL CLI 会话存储的只读访问层。
 *
 * dal 把会话以「首行 session header + 树形条目」的 JSONL 落盘在
 * ~/.dal/agent/sessions/--<编码后 cwd>--/<ISO时间戳>_<uuid>.jsonl
 * （编码算法原样转写自 packages/coding-agent/src/core/session-manager.ts
 * getDefaultSessionDirPath：去掉首部斜杠、[/\\:] 全部替换为 '-'，再以 -- 包裹）。
 *
 * 本模块只读；写路径由 dal 进程自身负责（桌面端经 --session-id/--fork 驱动）。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface DalSessionHeader {
  type: 'session'
  version?: number
  id: string
  timestamp: string
  cwd: string
  name?: string
}

export interface DalContentBlock {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  arguments?: unknown
  data?: string
  mimeType?: string
  [key: string]: unknown
}

export interface DalMessage {
  role: 'user' | 'assistant' | 'toolResult' | string
  content?: string | DalContentBlock[]
  stopReason?: string
  errorMessage?: string
  usage?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    totalTokens?: number
  }
  model?: string
  provider?: string
  timestamp?: number
  [key: string]: unknown
}

export interface DalSessionEntry {
  type: 'message' | 'model_change' | 'thinking_level_change' | 'compaction'
    | 'branch_summary' | 'custom' | 'custom_message' | 'label' | 'session_info' | string
  id: string
  parentId: string | null
  timestamp: string
  message?: DalMessage
  [key: string]: unknown
}

export interface DalSessionSummary {
  id: string
  sessionFile: string
  title: string | null
  createdAt: string
  modifiedAt: string
  messageCount: number
  cwd: string
}

/** dal 配置根（DAL_CODING_AGENT_DIR 可覆盖），会话目录为 <root>/agent/sessions。 */
export function getDalAgentDir(): string {
  const override = process.env.DAL_CODING_AGENT_DIR?.trim()
  if (override) return override
  return path.join(os.homedir(), '.dal', 'agent')
}

/** 原样转写 dal 的 cwd→目录名编码。 */
export function encodedSessionDirName(cwd: string): string {
  const resolved = path.resolve(cwd)
  return `--${resolved.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
}

export function getDalSessionDir(cwd: string): string {
  return path.join(getDalAgentDir(), 'sessions', encodedSessionDirName(cwd))
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

export function readDalSessionHeader(filePath: string): DalSessionHeader | null {
  try {
    const fd = fs.openSync(filePath, 'r')
    try {
      const buffer = Buffer.alloc(64 * 1024)
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0)
      const firstLine = buffer.toString('utf8', 0, bytes).split('\n')[0] ?? ''
      const parsed = parseJsonLine(firstLine.trim())
      if (!parsed || parsed.type !== 'session' || typeof parsed.id !== 'string') return null
      return parsed as unknown as DalSessionHeader
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
}

/** 按 uuid（可前缀）在 cwd 对应的会话目录中定位会话文件。 */
export function findDalSessionFile(sessionId: string, cwd: string): string | null {
  const dir = getDalSessionDir(cwd)
  let entries: string[]
  try {
    entries = fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl'))
  } catch {
    return null
  }
  const match = entries.find((name) => name.includes(sessionId))
    ?? entries.find((name) => name.slice(name.lastIndexOf('_') + 1, -6).startsWith(sessionId))
  if (!match) return null
  return path.join(dir, match)
}

/**
 * 跨项目全局定位：桌面端的 sessionId 就是传给 dal 的 --session-id（uuid），
 * 会话文件名形如 <时间戳>_<uuid>.jsonl，遍历所有项目目录按 uuid 后缀匹配。
 */
export function findDalSessionFileGlobal(sessionId: string): string | null {
  const sessionsRoot = path.join(getDalAgentDir(), 'sessions')
  let projectDirs: string[]
  try {
    projectDirs = fs.readdirSync(sessionsRoot)
  } catch {
    return null
  }
  for (const projectDir of projectDirs) {
    const dir = path.join(sessionsRoot, projectDir)
    try {
      const match = fs.readdirSync(dir)
        .filter((name) => name.endsWith('.jsonl'))
        .find((name) => {
          const uuidPart = name.slice(name.lastIndexOf('_') + 1, -'.jsonl'.length)
          return uuidPart === sessionId || uuidPart.startsWith(sessionId) || name.includes(sessionId)
        })
      if (match) return path.join(dir, match)
    } catch {
      // 目录不可读则跳过。
    }
  }
  return null
}

export function readDalSessionEntries(filePath: string): DalSessionEntry[] {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return []
  }
  const entries: DalSessionEntry[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed = parseJsonLine(trimmed)
    if (!parsed || typeof parsed.type !== 'string' || parsed.type === 'session') continue
    entries.push(parsed as unknown as DalSessionEntry)
  }
  return entries
}

export function countDalSessionMessages(filePath: string): number {
  return readDalSessionEntries(filePath)
    .filter((entry) => entry.type === 'message' && entry.message?.role === 'user')
    .length
}

function firstUserText(entries: DalSessionEntry[]): string | null {
  for (const entry of entries) {
    if (entry.type !== 'message' || entry.message?.role !== 'user') continue
    const content = entry.message.content
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
          .filter((block) => block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text as string)
          .join('\n')
        : ''
    const trimmed = text.trim()
    if (trimmed) return trimmed.slice(0, 200)
  }
  return null
}

/** 列出某 cwd 下的 dal 会话（按修改时间倒序）。 */
export function listDalSessions(cwd: string, limit = 20, offset = 0): { sessions: DalSessionSummary[]; total: number } {
  const dir = getDalSessionDir(cwd)
  let files: string[]
  try {
    files = fs.readdirSync(dir)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => path.join(dir, name))
      .filter((filePath) => fs.statSync(filePath).isFile())
  } catch {
    return { sessions: [], total: 0 }
  }

  const summaries: DalSessionSummary[] = []
  for (const filePath of files) {
    const stat = fs.statSync(filePath)
    const header = readDalSessionHeader(filePath)
    if (!header) continue
    const entries = readDalSessionEntries(filePath)
    summaries.push({
      id: header.id,
      sessionFile: filePath,
      title: header.name ?? firstUserText(entries),
      createdAt: header.timestamp,
      modifiedAt: stat.mtime.toISOString(),
      messageCount: entries.filter((entry) => entry.type === 'message').length,
      cwd: header.cwd,
    })
  }
  summaries.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1))
  return {
    sessions: summaries.slice(offset, offset + limit),
    total: summaries.length,
  }
}
