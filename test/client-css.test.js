// 面板样式的死代码守卫：样式里定义的每个类名都要真的有人用。
//
// 抓过的现状：client/parts/styles.js 定义了 230 个 .ab-* 类，其中 37 个没人用
// （28 个 .ab-pm-* 是已删页面的遗留，83 行纯死代码）。删掉之后用这条测试防止再长回来。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PARTS = join(ROOT, 'client/parts')

function classesDefined() {
  const styles = readFileSync(join(PARTS, 'styles.js'), 'utf8')
  return new Set([...styles.matchAll(/\.(ab-[a-z0-9-]+)/g)].map((m) => m[1]))
}

function consumers() {
  const files = readdirSync(PARTS).filter((n) => n.endsWith('.js') && n !== 'styles.js')
  return files.map((n) => readFileSync(join(PARTS, n), 'utf8')).join('\n')
    + readFileSync(join(ROOT, 'client/client.template.js'), 'utf8')
}

test('样式里的每个 .ab-* 类都有人用（防止删页面后样式堆积）', () => {
  const text = consumers()
  const used = new Set([...text.matchAll(/\b(ab-[a-z0-9-]+)\b/g)].map((m) => m[1]))
  // 模板里 `ab-hit-${x}` 这种动态拼接：前缀也算用到
  const dynamic = [...text.matchAll(/(ab-[a-z0-9-]*)-?\$\{/g)].map((m) => m[1])
  const dead = [...classesDefined()].filter((c) => !used.has(c) && !dynamic.some((d) => d.startsWith(c) || c.startsWith(d)))
  assert.deepEqual(dead.sort(), [], `这些样式类没人用，删掉：\n${dead.sort().join(' ')}`)
})

test('变量定义不缺：用到的 --ab-* 变量都有声明', () => {
  const styles = readFileSync(join(PARTS, 'styles.js'), 'utf8')
  const declared = new Set([...styles.matchAll(/(--ab-[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
  const used = new Set([...styles.matchAll(/var\((--ab-[a-z0-9-]+)/g)].map((m) => m[1]))
  const missing = [...used].filter((v) => !declared.has(v))
  assert.deepEqual(missing, [], `这些 CSS 变量用了但没声明：\n${missing.join(' ')}`)
})
