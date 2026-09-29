/**
 * 引擎解耦量化报告：src/server 对 src/ 引擎支撑层的依赖全景。
 * 产出：直接依赖（按目录/类型分类）+ 传递闭包规模 + 分批解耦建议。
 * 用法：bun scripts/engine-decoupling-report.ts
 */
import { buildModuleGraph, listGraphSourceFiles, GRAPH_SOURCE_ROOTS, normalizeGraphPath } from './pr/module-graph.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dir, '..')
const files = listGraphSourceFiles(repoRoot, GRAPH_SOURCE_ROOTS)
const graph = buildModuleGraph(repoRoot, files)

const isEngine = (file: string) => file.startsWith('src/') && !file.startsWith('src/server/')
const serverFiles = files.filter((file) => file.startsWith('src/server/'))

// 直接依赖：server 文件对引擎文件的直接 import
const direct: Array<{ from: string; to: string }> = []
for (const from of serverFiles) {
  for (const to of graph.imports.get(from) ?? []) {
    if (isEngine(to)) direct.push({ from, to })
  }
}

// 传递闭包：从全部直接依赖出发可达的引擎文件
const closure = new Set<string>()
const queue = direct.map((edge) => edge.to)
while (queue.length > 0) {
  const current = queue.pop()!
  if (!isEngine(current) || closure.has(current)) continue
  closure.add(current)
  for (const next of graph.imports.get(current) ?? []) {
    if (!closure.has(next)) queue.push(next)
  }
}

// 类型-only 依赖估计：import type / 仅为类型路径
const typeOnlyDirect = direct.filter(({ from, to }) => {
  const source = graph.imports.has(from) ? undefined : undefined
  void source
  // 词法层无法区分 type-only，此处以 .d.ts 或 utils/model 等类型目录粗分
  return to.includes('/model/') || to.endsWith('.d.ts') || to.includes('/types')
})

// 按引擎目录聚合直接依赖
const byDir = new Map<string, Set<string>>()
for (const { to } of direct) {
  const dir = to.split('/').slice(0, 3).join('/')
  if (!byDir.has(dir)) byDir.set(dir, new Set())
  byDir.get(dir)!.add(to)
}

// 被 server 引用的引擎文件（直接）里，反向还被哪些引擎文件引用（扇入排行）
const fanIn = new Map<string, number>()
for (const file of closure) {
  let count = 0
  for (const importer of graph.importedBy.get(file) ?? []) {
    if (closure.has(importer) || serverFiles.includes(importer)) count += 1
  }
  fanIn.set(file, count)
}
const hubs = [...fanIn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)

const lines: string[] = [
  '# 引擎解耦量化报告',
  '',
  `> 自动生成：bun scripts/engine-decoupling-report.ts（词法模块图，${graph.fileCount} 文件）`,
  '',
  '## 总量',
  '',
  `- src/server 文件数：${serverFiles.length}`,
  `- server → 引擎 **直接依赖边**：${direct.length}（涉及 ${new Set(direct.map((d) => d.to)).size} 个引擎文件）`,
  `- 引擎传递闭包（直接+间接可达）：**${closure.size} 个文件**`,
  `- 其中疑似类型/模型定义类直接依赖：${typeOnlyDirect.length}`,
  '',
  '## 直接依赖按引擎目录分布',
  '',
  '| 目录 | 被引用文件数 |',
  '|---|---|',
]
for (const [dir, set] of [...byDir.entries()].sort((a, b) => b[1].size - a[1].size)) {
  lines.push(`| ${dir} | ${set.size} |`)
}
lines.push('', '## 解耦枢纽（闭包内扇入 Top 25——先解耦它们可级联释放最多文件）', '', '| 文件 | 被依赖次数 |', '|---|---|')
for (const [file, count] of hubs) {
  lines.push(`| ${file} | ${count} |`)
}
lines.push(
  '',
  '## 分批解耦建议',
  '',
  '1. **类型层先行**：server 对引擎的 type-only 引用改为 `src/server/types/` 本地声明或 `src/shared/` 共享包——零运行时风险，预计消解一批纯类型边。',
  '2. **常量/配置层**：constants/messages/xml 等纯数据文件复制进 `src/server/constants/`（引擎侧等删除）。',
  '3. **工具层按扇入顺序**：先解耦上表枢纽（每解耦一个按 closure 重算，收益级联）。',
  '4. **每批跑**：`bun scripts/engine-deletion-plan.ts --delete`（现成闭包分析器）+ `tsc --noEmit` + `bun scripts/e2e-dal-chat.ts`。',
  '5. **判定线**：当 engine-deletion-plan 报告的「不可达文件数」趋近 0 时，引擎即彻底删除。',
)

mkdirSync(path.join(repoRoot, 'docs/dal-integration'), { recursive: true })
writeFileSync(path.join(repoRoot, 'docs/dal-integration/engine-decoupling-report.md'), lines.join('\n'))
console.log(`[decoupling] direct edges=${direct.length} files=${new Set(direct.map((d) => d.to)).size} closure=${closure.size}`)
console.log('[decoupling] report -> docs/dal-integration/engine-decoupling-report.md')
