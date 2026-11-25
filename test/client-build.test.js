import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('client：parts 片段能拼回单文件入口，且没有残留 include', () => {
  execFileSync(process.execPath, [join(process.cwd(), 'scripts/build-client.mjs')], { stdio: 'pipe' })
  const out = readFileSync(join(process.cwd(), 'client/client.js'), 'utf8')
  assert.doesNotMatch(out, /@include /)
  assert.match(out, /function Backup\(\{ toast \}\)/)
  assert.match(out, /备份：打包数据目录/)
})
