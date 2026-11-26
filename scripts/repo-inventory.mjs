#!/usr/bin/env node
// 全仓清单生成器：用 git ls-files 取受版本控制的文件，算出货真价实的事实
// （行数、导出、内部依赖、被依赖数、引用它的测试），再把「审计结论」合并进来。
//
// 用法：
//   node scripts/repo-inventory.mjs                 # 打印现状摘要 + 缺失结论的文件
//   node scripts/repo-inventory.mjs --md            # 输出 docs/REPO-INVENTORY.md 的表格部分
//   node scripts/repo-inventory.mjs --write         # 直接重写 docs/REPO-INVENTORY.md
//   node scripts/repo-inventory.mjs --tsv           # 机器可读底表
//
// 结论来源：docs/repo-audit/<区域>.json，每条 { path, area, owner, verdict, evidence }
// verdict 取值见 VERDICTS。

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const AUDIT_DIR = join(ROOT, 'docs', 'repo-audit')

export const VERDICTS = {
  keep: '保留',
  keepDoc: '保留·补文档',
  keepGenerated: '保留·生成物',
  split: '拆分',
  merge: '合并',
  rewrite: '重写',
  vendor: '第三方',
  delete: '删除',
}

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.yml', '.yaml', '.txt', '.css', '.html', '.svg', '.sh', '.patch'])
const ASSET_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.ico', '.wav', '.mp3', '.onnx', '.wasm', '.bin', '.tar', '.tgz'])

function gitFiles() {
  const out = execFileSync('/usr/bin/git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 1 << 28 })
  const tracked = out.toString('utf8').split('\0').filter(Boolean)
  // 还没提交的新文件也算「自有代码」：只读 git ls-files 会漏掉它们（踩过一次）。
  let untracked = []
  try {
    untracked = execFileSync('/usr/bin/git', ['ls-files', '-z', '--others', '--exclude-standard'], { cwd: ROOT, maxBuffer: 1 << 28 })
      .toString('utf8').split('\0').filter(Boolean)
  } catch {}
  return [...tracked, ...untracked.filter((p) => !tracked.includes(p))].sort()
}

function countLines(abs) {
  try {
    const buf = readFileSync(abs)
    if (buf.includes(0)) return null // 二进制
    let n = 0
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++
    return buf.length && buf[buf.length - 1] !== 10 ? n + 1 : n
  } catch { return null }
}

const IMPORT_RE = /(?:^|[^\w$])(?:import\s+(?:[^'"]*?\sfrom\s+)?|export\s+[^'"]*?\sfrom\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g

function parseImports(text) {
  const out = new Set()
  for (const m of text.matchAll(IMPORT_RE)) out.add(m[1])
  return [...out]
}

function resolveSpec(spec, fromAbs) {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromAbs), spec)
  const cands = [base, `${base}.js`, `${base}.mjs`, join(base, 'index.js')]
  for (const c of cands) {
    try { if (statSync(c).isFile()) return c } catch {}
  }
  return base
}

function kindOf(rel) {
  if (rel.startsWith('test/') || /\.test\.mjs?$/.test(rel)) return 'test'
  if (rel.startsWith('tests/')) return 'test'
  if (rel.startsWith('docs/')) return 'doc'
  if (rel.startsWith('client/parts/')) return 'client-part'
  if (rel === 'client/client.js') return 'client-build'
  if (rel === 'client/client.template.js') return 'client-template'
  if (rel.startsWith('models/')) return 'vendor-model'
  if (rel.startsWith('assets/') || ASSET_EXT.has(extOf(rel))) return 'asset'
  if (rel.startsWith('scripts/')) return 'script'
  if (rel.startsWith('src/')) return 'source'
  if (rel.startsWith('.github/')) return 'ci'
  return 'config'
}

function extOf(p) {
  const i = p.lastIndexOf('.')
  return i < 0 ? '' : p.slice(i).toLowerCase()
}

function areaOf(rel) {
  const parts = rel.split('/')
  if (parts[0] === 'src') {
    if (parts[1] === 'channels') return parts[1] + '/' + (parts[2] || '')
    if (parts[1] === 'mind' || parts[1] === 'mind-adapter') return parts[1] + '/' + (parts[2] || '')
    if (parts[1] === 'features') return 'features'
    if (parts[1] === 'chat') return 'chat'
    if (parts[1] === 'core') return 'core'
    if (parts[1] === 'modules') return 'modules'
    if (parts[1] === 'song' || parts[1] === 'voice') return parts[1]
    if (parts[1] === 'integration' || parts[1] === 'host' || parts[1] === 'security' || parts[1] === 'persona' || parts[1] === 'local' || parts[1] === 'tools') return parts[1]
    return 'src-root'
  }
  return parts.length > 1 ? parts[0] : 'root'
}

/**
 * 自动结论：只给「依据本来就是全量运行」的那两类文件。
 *
 * - 测试文件：它们的验证依据就是「全量跑过」，逐个手写一条只会把清单变成负担
 *   （本仓为这件事返工过 6 次）。这里按目录自动生成，并在 evidence 里写清「怎么被验证的」。
 * - 审计数据文件：本来就是这份清单的输入。
 *
 * 源码 / 客户端 / 脚本 / 文档仍然必须人工结论：那才是「每个自有源文件有归属」要管的东西。
 */
function autoVerdict(rec) {
  if (rec.kind === 'test') {
    return {
      verdict: 'keep',
      owner: 'test',
      evidence: `测试文件：验证依据是全量运行（node --test "test/**/*.test.js"）；${rec.lines ? `共 ${rec.lines} 行；` : ''}本行由 scripts/repo-inventory.mjs 自动生成。`,
    }
  }
  if (rec.path.startsWith('docs/repo-audit/')) {
    return {
      verdict: 'keepGenerated',
      owner: 'audit',
      evidence: '审计数据（本清单的输入）；由 scripts/repo-inventory.mjs 读取，test/repo-inventory.test.js 校验结构。',
    }
  }
  return null
}

function loadAudits() {
  const map = new Map()
  let names = []
  try { names = readdirSync(AUDIT_DIR).filter((n) => n.endsWith('.json')) } catch { return map }
  for (const n of names) {
    let rows
    try { rows = JSON.parse(readFileSync(join(AUDIT_DIR, n), 'utf8')) } catch (e) {
      throw new Error(`docs/repo-audit/${n} 不是合法 JSON：${e.message}`)
    }
    for (const r of rows) {
      if (!r.path) throw new Error(`docs/repo-audit/${n} 有一条缺 path`)
      if (!VERDICTS[r.verdict]) throw new Error(`docs/repo-audit/${n} 的 ${r.path} verdict 非法：${r.verdict}`)
      if (!r.evidence) throw new Error(`docs/repo-audit/${n} 的 ${r.path} 缺 evidence`)
      map.set(r.path, { ...r, source: n })
    }
  }
  return map
}

export function buildInventory() {
  const files = gitFiles()
  const records = []
  const byAbs = new Map()
  for (const rel of files) {
    const abs = join(ROOT, rel)
    let text = ''
    if (TEXT_EXT.has(extOf(rel)) && !rel.startsWith('models/')) {
      try { text = readFileSync(abs, 'utf8') } catch {}
    }
    const rec = {
      path: rel,
      kind: kindOf(rel),
      area: areaOf(rel),
      lines: countLines(abs),
      bytes: (() => { try { return statSync(abs).size } catch { return 0 } })(),
      imports: [],
      importers: [],
    }
    if (text) {
      rec.imports = parseImports(text).map((s) => resolveSpec(s, abs)).filter(Boolean).map((p) => relative(ROOT, p))
    }
    const auto = autoVerdict(rec)
    if (auto) rec.auto = auto
    records.push(rec)
    byAbs.set(rel, rec)
  }
  // 反查：谁 import 了谁（client parts 是拼接的，不算依赖边）
  for (const rec of records) {
    for (const dep of rec.imports) {
      for (const cand of [dep, `${dep}.js`, join(dep, 'index.js')]) {
        const target = byAbs.get(cand.split(sep).join('/'))
        if (target) { target.importers.push(rec.path); break }
      }
    }
  }
  // 测试覆盖：测试文件里出现该模块的名字（含路径片段）就算引用，供审计时核对，不当作覆盖率
  const tests = records.filter((r) => r.kind === 'test')
  for (const rec of records) {
    if (rec.kind === 'test' || !['source', 'client-part', 'client-template', 'script'].includes(rec.kind)) { rec.tests = []; continue }
    const stem = rec.path.replace(/\.[^.]+$/, '')
    const tail = stem.split('/').slice(-2).join('/')
    rec.tests = tests.filter((t) => {
      try { return readFileSync(join(ROOT, t.path), 'utf8').includes(tail) } catch { return false }
    }).map((t) => t.path)
  }
  return { records, byAbs }
}

function summary({ records }) {
  const byKind = new Map()
  for (const r of records) byKind.set(r.kind, (byKind.get(r.kind) || 0) + 1)
  return [...byKind.entries()].sort((a, b) => b[1] - a[1])
}

function md({ records }, audits) {
  const missing = []
  const lines = []
  lines.push('| 文件 | 类别 | 区域 | 行 | 被依赖 | 测试引用 | 结论 | 归属 | 依据 |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  for (const r of records.sort((a, b) => a.path.localeCompare(b.path))) {
    const a = audits.get(r.path) || r.auto
    if (!a) missing.push(r.path)
    lines.push(`| \`${r.path}\` | ${r.kind} | ${r.area} | ${r.lines ?? '—'} | ${r.importers.length} | ${(r.tests || []).length} | ${a ? VERDICTS[a.verdict] : '**待审**'} | ${a?.owner ?? '—'} | ${a?.evidence ?? '—'} |`)
  }
  return { md: lines.join('\n'), missing }
}

function header({ records }, audits) {
  const counts = new Map()
  for (const r of records) {
    const a = audits.get(r.path) || r.auto
    const k = a ? VERDICTS[a.verdict] : '待审'
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const own = records.filter((r) => ['source', 'client-part', 'client-template', 'script'].includes(r.kind))
  const lines = []
  lines.push('# 全仓清单与审计结论')
  lines.push('')
  lines.push('本文件由 `scripts/repo-inventory.mjs --write` 生成，**不要手改**。')
  lines.push('事实（行数、依赖、被依赖、测试引用）来自 `git ls-files` + 源码解析；结论来自 `docs/repo-audit/*.json`。')
  lines.push('口径见 [REFACTOR-PLAN.md](REFACTOR-PLAN.md)；宿主兼容判定见 [HOST-COMPAT.md](HOST-COMPAT.md)。')
  lines.push('')
  lines.push(`纳入清单的文件：**${records.length}**（受版本控制 + 未提交的新文件）；其中自有代码（src / client 片段 / 脚本）**${own.length}**。`)
  lines.push('')
  lines.push('| 结论 | 文件数 |')
  lines.push('|---|---|')
  for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) lines.push(`| ${k} | ${n} |`)
  lines.push('')
  lines.push('列说明：**被依赖**＝有多少个仓内文件 import 它；**测试引用**＝有多少个测试文件提到它（不是覆盖率，只是线索）。')
  lines.push('')
  return lines.join('\n')
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const inv = buildInventory()
  const audits = loadAudits()
  const mode = process.argv.includes('--tsv') ? 'tsv' : process.argv.includes('--md') ? 'md' : process.argv.includes('--write') ? 'write' : 'summary'
  if (mode === 'write') {
    const { md: table, missing } = md(inv, audits)
    const out = `${header(inv, audits)}\n${table}\n`
    writeFileSync(join(ROOT, 'docs', 'REPO-INVENTORY.md'), out)
    console.log(`docs/REPO-INVENTORY.md 已写入：${inv.records.length} 行，待审 ${missing.length}`)
    process.exit(missing.length ? 1 : 0)
  }
  if (mode === 'tsv') {
    console.log(['path', 'kind', 'area', 'lines', 'importers', 'tests', 'verdict', 'owner'].join('\t'))
    for (const r of inv.records) {
      const a = audits.get(r.path)
      console.log([r.path, r.kind, r.area, r.lines ?? '', r.importers.length, (r.tests || []).length, a?.verdict ?? '', a?.owner ?? ''].join('\t'))
    }
  } else if (mode === 'md') {
    const { md: table, missing } = md(inv, audits)
    console.log(table)
    console.error(`\n待审：${missing.length} 个文件`)
  } else {
    console.log(`受版本控制的文件：${inv.records.length}`)
    for (const [k, n] of summary(inv)) console.log(`  ${k.padEnd(14)} ${n}`)
    const own = inv.records.filter((r) => ['source', 'client-part', 'client-template', 'script'].includes(r.kind))
    const missing = own.filter((r) => !audits.has(r.path) && !r.auto)
    console.log(`\n自有代码文件：${own.length}，已有结论：${own.length - missing.length}，待审：${missing.length}`)
    for (const r of missing.slice(0, 40)) console.log(`  - ${r.path}`)
    if (missing.length > 40) console.log(`  …还有 ${missing.length - 40} 个`)
  }
}
