import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

test('client：parts 片段能拼回单文件入口，且每个页面函数都在里面', () => {
  execFileSync(process.execPath, [join(process.cwd(), 'scripts/build-client.mjs')], { stdio: 'pipe' })
  const out = readFileSync(join(process.cwd(), 'client/client.js'), 'utf8')
  assert.doesNotMatch(out, /@include /)
  assert.match(out, /function Backup\(\{ toast \}\)/)
  assert.match(out, /备份：打包数据目录/)
  const dir = join(process.cwd(), 'client/parts')
  const parts = readdirSync(dir).filter((name) => name.endsWith('.js'))
  assert.ok(parts.length >= 100, `页面片段太少：${parts.length}`)
  for (const name of parts) {
    const src = readFileSync(join(dir, name), 'utf8')
    const fns = [...src.matchAll(/^\s*(?:async )?function (\w+)\(/gm)].map((m) => m[1])
    for (const fn of fns) assert.match(out, new RegExp(`function ${fn}\\(`), `${name} 里的 ${fn} 没拼进去`)
  }
  assert.match(out, /\.ab-root\{/)
  assert.match(out, /const NAV_GROUPS = \[/)
})
