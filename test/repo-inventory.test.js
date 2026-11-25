// 全仓清单回归：每个受版本控制的文件都必须有审计结论，每条结论都要能对上真实文件。
// 这条测试是「每个自有源文件都有归属、处理结论与验证依据」的机械闸门，
// 结论落在 docs/repo-audit/*.json，人读版由 scripts/repo-inventory.mjs 合成。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const AUDIT_DIR = join(ROOT, 'docs', 'repo-audit')
const VERDICTS = new Set(['keep', 'keepDoc', 'keepGenerated', 'split', 'merge', 'rewrite', 'vendor', 'delete'])

// 本批新增、尚未提交的文件：提交后从名单里删掉，测试会强制它们也被审计覆盖
const PENDING_TRACK = new Set([
  'scripts/repo-inventory.mjs',
  'docs/REPO-INVENTORY.md',
  'docs/REFACTOR-PLAN.md',
  'docs/HOST-COMPAT.md',
  'docs/ACCEPTANCE-LOG.md',
])

function tracked() {
  try {
    return execFileSync('/usr/bin/git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 1 << 28 })
      .toString('utf8').split('\0').filter(Boolean)
  } catch {
    return null // 不是 git 检出（比如解包后的 tgz）就跳过这组检查
  }
}

function audits() {
  if (!existsSync(AUDIT_DIR)) return new Map()
  const rows = new Map()
  for (const name of readdirSync(AUDIT_DIR).filter((n) => n.endsWith('.json'))) {
    const list = JSON.parse(readFileSync(join(AUDIT_DIR, name), 'utf8'))
    assert.ok(Array.isArray(list), `docs/repo-audit/${name} 必须是数组`)
    for (const row of list) {
      assert.ok(row.path, `docs/repo-audit/${name} 有一条缺 path`)
      // 注意：断言消息是立即求值的，重复判断不能把 rows.get() 写进模板串（踩过：TypeError）
      if (rows.has(row.path)) assert.fail(`${row.path} 在 ${name} 和 ${rows.get(row.path).__file} 里重复出现`)
      rows.set(row.path, { ...row, __file: name })
    }
  }
  return rows
}

const git = tracked()

test('审计结论覆盖每一个受版本控制的文件', { skip: !git && '不是 git 检出' }, () => {
  const rows = audits()
  const missing = git.filter((p) => !rows.has(p))
  assert.deepEqual(missing, [], `这些文件还没有审计结论：\n${missing.join('\n')}`)
})

test('审计结论里没有指向不存在文件的条目', { skip: !git && '不是 git 检出' }, () => {
  const rows = audits()
  const known = new Set([...git, ...PENDING_TRACK])
  const ghosts = [...rows.keys()].filter((p) => !known.has(p) && !existsSync(join(ROOT, p)))
  assert.deepEqual(ghosts, [], `审计结论指向已不存在的文件：\n${ghosts.join('\n')}`)
})

test('每个文件都有合法 verdict、归属和可核对的证据', () => {
  const rows = audits()
  assert.ok(rows.size > 0, 'docs/repo-audit/ 下还没有任何结论')
  const bad = []
  for (const [path, row] of rows) {
    if (!VERDICTS.has(row.verdict)) bad.push(`${path}：verdict=${row.verdict}`)
    if (!row.owner) bad.push(`${path}：缺 owner`)
    if (!row.area) bad.push(`${path}：缺 area`)
    const ev = String(row.evidence || '')
    if (ev.length < 20) bad.push(`${path}：evidence 太短`)
    // 证据里必须有可核对的东西：文件路径、测试名、路由/配置键，或明确写了 0 引用
    if (!/(\.js|\.mjs|\.md|\.yml|\.json|test|tests|路由|route|配置|config|引用|import|行)/.test(ev)) {
      bad.push(`${path}：evidence 没有可核对事实`)
    }
    // 删除/合并这类破坏性结论必须带证据来源
    // 破坏性结论要能指出「删了会怎样」：删除测试、唯一引用、0 引用、grep 结果，四种说法都算
    if (['delete', 'merge'].includes(row.verdict) && !/grep|删除测试|只被|唯一|0 引用|无引用|无 import|重复/.test(ev)) {
      bad.push(`${path}：${row.verdict} 结论缺少删除测试/唯一引用/grep 证据`)
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'))
})
