/**
 * 批次 N 一次性迁移脚本（散点文件集 → src/server 镜像路径）。幂等。
 * 用法：bun scripts/.batch-migrate.ts <N>
 * 执行后删除本脚本。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const REPO = 'D:/Code/cc-haha'
const BATCH = process.argv[2] ?? '32'
const moved: string[] = JSON.parse(readFileSync(path.join(REPO, `scripts/.batch${BATCH}-files.json`), 'utf8'))
const movedSet = new Set(moved)

function listTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '.git') continue
      out.push(...listTsFiles(p))
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
      out.push(p)
    }
  }
  return out
}

type Resolved = { canonical: string; physical: string }
function resolveSpec(fromFile: string, spec: string): Resolved | null {
  let base: string
  if (spec.startsWith('.')) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile.replaceAll('\\', '/')), spec.replaceAll('\\', '/')))
  } else if (spec.startsWith('src/')) {
    base = spec
  } else {
    return null
  }
  const candidates = [base, base + '.ts', base + '.tsx', base + '.js', base + '.mjs', base + '/index.ts', base + '/index.tsx']
  for (const c of candidates) {
    const mapped = c.endsWith('.js') ? c.slice(0, -3) + '.ts' : c.endsWith('.mjs') ? c.slice(0, -4) + '.ts' : c
    if (existsSync(path.join(REPO, mapped)) && statSync(path.join(REPO, mapped)).isFile()) {
      return { canonical: mapped, physical: mapped }
    }
    if (mapped.startsWith('src/') && !mapped.startsWith('src/server/')) {
      const twin = 'src/server/' + mapped.slice(4)
      if (existsSync(path.join(REPO, twin)) && statSync(path.join(REPO, twin)).isFile()) {
        return { canonical: mapped, physical: twin }
      }
    }
  }
  return null
}

function relSpec(fromFileNew: string, target: string): string {
  let rel = path.posix.relative(path.posix.dirname(fromFileNew), target).replaceAll('\\', '/')
  if (rel.endsWith('.ts')) rel = rel.slice(0, -3) + '.js'
  else if (rel.endsWith('.tsx')) rel = rel.slice(0, -4) + '.js'
  if (!rel.startsWith('.')) rel = './' + rel
  return rel
}

let movedCount = 0
for (const f of moved) {
  const srcAbs = path.join(REPO, f)
  const dstAbs = path.join(REPO, 'src/server', f.slice(4))
  if (!existsSync(srcAbs)) { console.error('MISSING:', f); continue }
  mkdirSync(path.dirname(dstAbs), { recursive: true })
  execSync(`git mv "${srcAbs}" "${dstAbs}"`, { cwd: REPO, stdio: 'pipe' })
  movedCount++
}
console.log('git mv done:', movedCount)

const walkRoots = [path.join(REPO, 'src'), path.join(REPO, 'desktop', 'src'), path.join(REPO, 'tests'), path.join(REPO, 'scripts')]
const specRe = /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"]+)\2/g
let touched = 0
let edgeCount = 0
for (const root of walkRoots) {
  if (!existsSync(root)) continue
  for (const abs of listTsFiles(root)) {
    const relOld = path.relative(REPO, abs).replaceAll('\\', '/')
    const isMoved = relOld.startsWith('src/server/') && movedSet.has('src/' + relOld.slice(11))
    const oldLoc = isMoved ? 'src/' + relOld.slice(11) : relOld
    const text = readFileSync(abs, 'utf8')
    let changed = false
    const out = text.replace(specRe, (whole, head, quote, spec) => {
      const hit = resolveSpec(oldLoc, spec)
      if (!hit) return whole
      if (movedSet.has(hit.canonical)) {
        let newSpec: string
        if (spec.startsWith('src/')) {
          const ext = spec.endsWith('.ts') ? '.ts' : spec.endsWith('.tsx') ? '.tsx' : '.js'
          newSpec = 'src/server/' + hit.canonical.slice(4).replace(/\.tsx?$/, ext)
        } else {
          newSpec = relSpec(relOld, 'src/server/' + hit.canonical.slice(4))
        }
        if (newSpec === spec) return whole
        edgeCount++
        changed = true
        return head + quote + newSpec + quote
      }
      if (isMoved && spec.startsWith('.')) {
        const newSpec = relSpec(relOld, hit.physical)
        if (newSpec === spec) return whole
        edgeCount++
        changed = true
        return head + quote + newSpec + quote
      }
      return whole
    })
    if (changed) { writeFileSync(abs, out); touched++ }
  }
}
console.log('repoint done: files touched =', touched, ', specifiers rewritten =', edgeCount)
