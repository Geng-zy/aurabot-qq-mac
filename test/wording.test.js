// 角色措辞：插件里统一叫“管理员”，不再出现旧称呼。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const TEXT = new Set(['.js', '.mjs', '.md', '.yml', '.yaml', '.json', '.txt', '.ts', '.svg', '.mjs'])
const SKIP = new Set(['.git', 'node_modules', 'models'])

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const file = join(dir, name)
    const st = statSync(file)
    if (st.isDirectory()) yield* walk(file)
    else if (TEXT.has(name.slice(name.lastIndexOf('.')))) yield file
  }
}

test('源码、面板和文档里不再出现旧角色称呼', () => {
  const hits = []
  for (const file of walk(ROOT)) {
    if (file.endsWith('test/wording.test.js')) continue
    const text = readFileSync(file, 'utf8')
    if (text.includes('主人')) hits.push(file.replace(ROOT, ''))
  }
  assert.deepEqual(hits, [])
})

test('默认称呼和管理员字段都已改成管理员', () => {
  const config = readFileSync(join(ROOT, 'src/core/config.js'), 'utf8')
  assert.match(config, /ownerName:\s*'管理员'/)
  assert.match(config, /c\.ownerName === '\\u4e3b\\u4eba'\) c\.ownerName = '管理员'/)
})
