// 表单小工具的守卫：密钥框与结果提示都必须走共享实现。
//
// 抓过的现状：13 处密钥框各写一遍「已保存就不回显」的占位逻辑（文案三种写法），
// 21 处提示各写一遍 toast(r.message, r.ok ? 'ok' : 'err')。改一处很容易漏掉另一半。
// 现在统一成 f.secret(...) / notify(...)，用这条测试防止再长回去。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PARTS = join(ROOT, 'client/parts')

function partSources() {
  return readdirSync(PARTS).filter((n) => n.endsWith('.js')).map((n) => ({ name: n, src: readFileSync(join(PARTS, n), 'utf8') }))
}

test('密钥框统一走 f.secret / secretPlaceholder，不再手写「已保存 ? … : …」', () => {
  const bad = []
  for (const { name, src } of partSources()) {
    for (const m of src.matchAll(/(\w+)Set\s*\?\s*'已保存[^']*'\s*:\s*[^,)]+/g)) {
      bad.push(`${name}: ${m[0].slice(0, 60)}`)
    }
  }
  assert.deepEqual(bad, [], `这些地方还在手写密钥占位逻辑，改用 f.secret / secretPlaceholder：\n${bad.join('\n')}`)
})

test('结果提示统一走 notify(...)，不再手写 toast(x.message, x.ok ? ...)', () => {
  const bad = []
  for (const { name, src } of partSources()) {
    for (const m of src.matchAll(/toast\(\s*(\w+)\.message\s*,\s*\1\.ok\s*\?/g)) {
      bad.push(`${name}: ${m[0]}`)
    }
  }
  assert.deepEqual(bad, [], `这些地方还在手写成功/失败提示，改用 notify(toast, x)：\n${bad.join('\n')}`)
})

test('共享实现只有一份：secretPlaceholder 与 notify 都有定义', () => {
  const kit = readFileSync(join(PARTS, 'useField.js'), 'utf8')
  assert.match(kit, /function secretPlaceholder\(/, 'useField.js 里应有 secretPlaceholder')
  assert.match(kit, /function notify\(toast, result/, 'useField.js 里应有 notify(toast, result)')
  assert.match(kit, /secret: \(path, props = \{\}\) =>/, 'useField.js 里应有 f.secret')
})
