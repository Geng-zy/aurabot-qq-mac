// 面板路由表快照：加/删/改路由必须显式改这份 fixture，避免重构时悄悄丢接口。
// 契约来源：docs/REFACTOR-PLAN.md §1.1 第 4 条（/aurabot/api/* 的路径与返回字段不变）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFakeDsh } from './helpers/fake-dsh.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SNAPSHOT = join(ROOT, 'test/fixtures/host-routes.json')

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-routes-'))
  process.env.AURABOT_DATA_DIR = dir
  process.env.AURABOT_TRASH_DIR = join(dir, 'trash')
  process.env.AURABOT_WORKSPACE = join(dir, 'ws')
  mkdirSync(join(dir, 'ws'), { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    enabled: false, dryRun: true, setupDone: true, botQQ: '2', ownerQQ: '1',
    snowluma: { autoStart: false, autoAttach: false },
  }))
  const fake = createFakeDsh({ brain: async () => '好' })
  const host = await import(`${ROOT}/src/host.js`)
  const api = host.apply(fake.ctx)
  return { fake, api }
}

test('面板路由表与快照一致（增删改都要显式更新 fixture）', async () => {
  const { fake, api } = await boot()
  try {
    const actual = [...fake.routes.keys()].sort()
    const expected = JSON.parse(readFileSync(SNAPSHOT, 'utf8')).sort()
    assert.deepEqual(actual, expected)
  } finally {
    try { api?.dispose?.() } catch {}
    try { fake.dispose() } catch {}
  }
})

test('面板接口挂在同一个前缀下，且都是 JSON 路由', async () => {
  const { fake, api } = await boot()
  try {
    const paths = [...fake.routes.keys()]
    assert.ok(paths.includes('/aurabot/api'), '前缀路由必须存在')
    const outside = paths.filter((p) => !p.startsWith('/aurabot/api'))
    assert.deepEqual(outside, [], `有路由跑到前缀之外：${outside.join(', ')}`)
    assert.ok(paths.length > 100, `路由数量异常：${paths.length}`)
  } finally {
    try { api?.dispose?.() } catch {}
    try { fake.dispose() } catch {}
  }
})
