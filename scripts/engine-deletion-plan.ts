/**
 * 引擎删除闭包分析：以「桌面壳 + server 骨架 + adapters + scripts」的存活入口
 * 为根做 import 可达性遍历，src/ 下不可达文件即 Claude 引擎死代码。
 * 用法：bun scripts/engine-deletion-plan.ts [--delete]
 */
import { buildModuleGraph, listGraphSourceFiles, GRAPH_SOURCE_ROOTS, normalizeGraphPath } from './pr/module-graph.ts'
import { rmSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dir, '..')
const files = listGraphSourceFiles(repoRoot, GRAPH_SOURCE_ROOTS)
const graph = buildModuleGraph(repoRoot, files)

// 存活入口：server、sidecar 分发入口、desktop 全部、adapters 全部、scripts 全部、preload
const roots = files.filter((file) => {
  if (file.startsWith('desktop/')) return true
  if (file.startsWith('adapters/')) return true
  if (file.startsWith('scripts/')) return true
  if (file === 'preload.ts') return true
  // server 骨架：入口链
  if (file === 'src/server/index.ts') return true
  if (file === 'src/server/server.ts') return true
  return false
})

const reachable = new Set<string>()
const queue = [...roots]
while (queue.length > 0) {
  const current = queue.pop()!
  if (reachable.has(current)) continue
  reachable.add(current)
  const imports = graph.imports.get(current)
  if (!imports) continue
  for (const next of imports) {
    if (!reachable.has(next)) queue.push(next)
  }
}

const engineFiles = files
  .filter((file) => file.startsWith('src/') && !file.startsWith('src/server/'))
  .filter((file) => !reachable.has(file))
  .sort()

const totalBytes = engineFiles.reduce((sum, file) => sum + (graph.imports.has(file) ? 0 : 0), 0)
console.log(`[engine-deletion] graph files=${graph.fileCount} reachable=${reachable.size}`)
console.log(`[engine-deletion] engine (unreachable, src/ 非 server): ${engineFiles.length} 个文件`)

// 可达性健全性抽查：这些文件必须可达（它们是保留骨架的一部分）
for (const mustHave of ['src/server/index.ts', 'src/server/ws/handler.ts', 'src/server/dal/dalSdkAdapter.ts']) {
  if (!reachable.has(normalizeGraphPath(mustHave))) {
    console.error(`[engine-deletion] FATAL: 存活文件被判为不可达: ${mustHave}`)
    process.exit(1)
  }
}

if (process.argv.includes('--delete')) {
  let deleted = 0
  for (const file of engineFiles) {
    try {
      rmSync(path.join(repoRoot, file), { force: true })
      deleted += 1
    } catch (error) {
      console.warn(`[engine-deletion] 删除失败 ${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  console.log(`[engine-deletion] 已删除 ${deleted}/${engineFiles.length} 个文件`)
} else {
  console.log('[engine-deletion] dry-run（加 --delete 执行删除）。前 40 个样例：')
  for (const file of engineFiles.slice(0, 40)) console.log(`  - ${file}`)
  void totalBytes
}
