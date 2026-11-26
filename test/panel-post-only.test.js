// 需要包体的接口必须只收 POST。
//
// 三道检查：
//   1. 源码契约：每个读了 readBody / readRaw 的 route 都要被 writeLike 或 POST_ONLY 覆盖；
//   2. 表里没有僵尸条目（每条 POST_ONLY 路径都真的注册了）；
//   3. 行为：GET 打这些路径返回 405 且带 Allow: POST —— 这才是「不会被空包体改配置」的证据。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFakeDsh } from './helpers/fake-dsh.js'
import { POST_ONLY } from '../src/host/post-only.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WRITE_LIKE = /(?:^|\/)(?:save|delete|reset|restore|remove|create|reload|install|upload|push|config|revoke|share|change|feed|wake|sleepnow|sleep|close|drop|edit|use|pin|infer|confirm|act|test-send|move|trust|setup|sync|reconnect|tidy|organize|forget|boost|private|scope|note)(?:\/|$)/

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-post-'))
  process.env.AURABOT_DATA_DIR = dir
  process.env.AURABOT_TRASH_DIR = join(dir, 'trash')
  process.env.AURABOT_WORKSPACE = join(dir, 'ws')
  mkdirSync(join(dir, 'ws'), { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    enabled: false, dryRun: true, setupDone: true, botQQ: '2', ownerQQ: '1',
    // 关键：默认值里 approval 是 true，「空包体写回 true」看不出变化，必须从 false 起测
    notice: { enabled: true, approval: false, question: false, workspaces: {} },
    snowluma: { autoStart: false, autoAttach: false },
  }))
  const fake = createFakeDsh({ brain: async () => '好' })
  const host = await import(`${ROOT}/src/host.js`)
  const api = host.apply(fake.ctx)
  return { fake, api }
}

test('源码契约：读包体的 route 必须被写操作闸或 POST_ONLY 覆盖', () => {
  const dir = join(ROOT, 'src/features')
  const missing = []
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(join(dir, f), 'utf8')
    const heads = [...src.matchAll(/^\s*route\('([^']+)'/gm)]
    for (let i = 0; i < heads.length; i++) {
      const start = heads[i].index
      const end = i + 1 < heads.length ? heads[i + 1].index : src.length
      const body = src.slice(start, end)
      const path = heads[i][1]
      if (!/readBody\(|readRaw\(/.test(body)) continue
      if (WRITE_LIKE.test(path) || POST_ONLY.has(path)) continue
      missing.push(`${f} ${path}`)
    }
  }
  assert.deepEqual(missing, [], `这些接口读了包体却没登记 POST_ONLY：\n${missing.join('\n')}`)
})

test('POST_ONLY 里没有僵尸条目，且每条都在路由表里', async () => {
  const { fake, api } = await boot()
  try {
    const paths = new Set(fake.routes.keys())
    const ghosts = [...POST_ONLY].filter((p) => !paths.has('/aurabot/api' + p))
    assert.deepEqual(ghosts, [], `POST_ONLY 里这些路径没有注册：\n${ghosts.join('\n')}`)
  } finally {
    try { api?.dispose?.() } catch {}
    try { fake.dispose() } catch {}
  }
})

test('GET 打需要包体的接口一律 405，且不执行 handler', async () => {
  const { fake, api } = await boot()
  try {
    const bad = []
    for (const path of POST_ONLY) {
      const res = await fake.call(path) // 不带 body ⇒ fake 用 GET
      if (res.status !== 405) bad.push(`${path} → ${res.status}`)
    }
    assert.deepEqual(bad, [], `这些接口 GET 没被拦住：\n${bad.join('\n')}`)
    // 再抽一条看响应体，确认是闸门而不是 handler 自己的 return
    const r = await fake.call('/notice/toggle')
    assert.equal(r.status, 405)
    assert.match(r.raw(), /只能用 POST/)
  } finally {
    try { api?.dispose?.() } catch {}
    try { fake.dispose() } catch {}
  }
})

test('GET /notice/toggle 不再偷偷改配置（回归：空包体会把通知打开/关掉）', async () => {
  const { fake, api } = await boot()
  try {
    const readNotice = async () => {
      const body = (await fake.call('/state')).json()
      return body?.state?.config?.notice || body?.config?.notice || {}
    }
    const before = await readNotice()
    await fake.call('/notice/toggle') // GET：以前会把 approval 取反并写盘
    const after = await readNotice()
    assert.deepEqual(after, before, 'GET 不应该改动 notice 配置')
  } finally {
    try { api?.dispose?.() } catch {}
    try { fake.dispose() } catch {}
  }
})
