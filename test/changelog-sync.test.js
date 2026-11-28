import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// 回归：2026-11-29 审查 H2 —— CHANGELOG 里 1.7.10 的「补发理由」与包内容实测相反，
// 躺了十几个版本没人发现。这里把「文档与发布事实对齐」变成机械检查。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
const acceptance = readFileSync(join(ROOT, 'docs/ACCEPTANCE-LOG.md'), 'utf8')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const sections = [...changelog.matchAll(/^## (\d+\.\d+\.\d+)$/gm)].map((m) => m[1])
const pairs = [...acceptance.matchAll(/dsh-aurabot-qq-(\d+\.\d+\.\d+)\.tgz[\s\S]{0,400}?sha256\s+([0-9a-f]{64})/g)]
const released = [...new Set(pairs.map((m) => m[1]))]

test('CHANGELOG 最新一段就是 package.json 的版本', () => {
  assert.equal(sections[0], pkg.version, `CHANGELOG 顶部是 ${sections[0]}，package.json 是 ${pkg.version}`)
})

test('验收记录里有发布哈希的每个版本，CHANGELOG 都要有段', () => {
  const missing = released.filter((v) => !sections.includes(v))
  assert.deepEqual(missing, [], `这些版本发过但 CHANGELOG 没写：${missing.join('、')}`)
})

test('CHANGELOG 段号不重复（否则「最新一段」不可信）', () => {
  const dup = sections.filter((v, i) => sections.indexOf(v) !== i)
  assert.deepEqual([...new Set(dup)], [], `重复的版本段：${[...new Set(dup)].join('、')}`)
})
