/**
 * 无头端到端冒烟：真实启动 Bun server + 真实 dal rpc 子进程，
 * 走渲染端同款 WS 协议（create session → user_message → 流式事件 →
 * message_complete → stop_generation），验证 dal 适配器全回路。
 *
 * 用法：bun scripts/e2e-dal-chat.ts [testWorkDir]
 */

import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const workDir = process.argv[2]
  ?? path.join(tmpdir(), `dal-e2e-${Date.now()}`)
mkdirSync(workDir, { recursive: true })

process.env.CC_HAHA_LOCAL_ACCESS_TOKEN = 'e2e-token'
process.env.DAL_CLI_PATH = 'D:\\Code\\cc-haha\\desktop\\src-tauri\\binaries\\dal-sidecar-x86_64-pc-windows-msvc.exe'

const { startServer } = await import('../src/server/index.ts')
startServer(3457, '127.0.0.1')
await new Promise((resolve) => setTimeout(resolve, 2500))

const BASE = 'http://127.0.0.1:3457'

async function main() {
  // 1. 创建会话
  const createRes = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer e2e-token',
    },
    body: JSON.stringify({ workDir }),
  })
  if (!createRes.ok) {
    throw new Error(`create session failed: ${createRes.status} ${await createRes.text()}`)
  }
  const created = await createRes.json() as { sessionId: string }
  const sessionId = created.sessionId
  console.log(`[e2e] session created: ${sessionId}`)

  // 2. WS 连接并驱动一轮对话
  const wsUrl = `ws://127.0.0.1:3457/ws/sessions/${sessionId}?token=e2e-token`
  const ws = new WebSocket(wsUrl)
  let deltaCount = 0
  let assistantChars = 0
  let toolUses = 0
  let complete = false
  let thinkingChars = 0

  const result = await new Promise<{ complete: boolean; deltas: number; chars: number; tools: number; thinking: number; errors: string[] }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('e2e timeout after 180s')), 180_000)
    const errors: string[] = []
    ws.onopen = () => {
      console.log('[e2e] ws open')
      ws.send(JSON.stringify({ type: 'user_message', content: '请直接回复四个字：链路畅通。不要使用任何工具。' }))
    }
    ws.onmessage = (event) => {
      const messages = String(event.data).split('\n').filter(Boolean)
      for (const line of messages) {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        switch (msg.type) {
          case 'content_delta':
            deltaCount += 1
            assistantChars += String(msg.text ?? '').length
            break
          case 'thinking':
            thinkingChars += String(msg.text ?? '').length
            break
          case 'tool_use_complete':
            toolUses += 1
            break
          case 'message_complete':
            complete = true
            console.log(`[e2e] message_complete usage=${JSON.stringify(msg.usage)}`)
            // message_complete 即回合终点（后续 status 时序不稳），留 500ms
            // 缓冲收集尾随帧后收尾。
            clearTimeout(timer)
            setTimeout(() => resolve({ complete, deltas: deltaCount, chars: assistantChars, tools: toolUses, thinking: thinkingChars, errors }), 500)
            return
          case 'error':
            errors.push(String(msg.message))
            break
          case 'status':
            if (msg.state !== 'idle') break
            if (complete) {
              clearTimeout(timer)
              resolve({ complete, deltas: deltaCount, chars: assistantChars, tools: toolUses, thinking: thinkingChars, errors })
              return
            }
            break
          default:
            break
        }
      }
    }
    ws.onerror = (err) => {
      clearTimeout(timer)
      reject(new Error(`ws error: ${String(err)}`))
    }
  })

  console.log(`[e2e] result: ${JSON.stringify(result)}`)
  ws.close()

  const pass = result.complete && result.deltas > 0 && result.chars > 0
  console.log(pass ? '[e2e] PASS' : '[e2e] FAIL')
  try {
    rmSync(workDir, { recursive: true, force: true })
  } catch {
    // dal 子进程可能仍占用临时目录，留给系统清理。
  }
  process.exit(pass ? 0 : 1)
}

main().catch((error) => {
  console.error('[e2e] FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
})
