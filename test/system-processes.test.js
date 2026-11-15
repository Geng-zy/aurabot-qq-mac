import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { createFakeDsh } from './helpers/fake-dsh.js'
import { createGroupRoles } from '../src/chat/group-roles.js'

async function setup(t, brain = async () => '') {
  const root = mkdtempSync(join(tmpdir(), 'aurabot-processes-'))
  const previous = Object.fromEntries(['AURABOT_DATA_DIR', 'AURABOT_WORKSPACE', 'AURABOT_TRASH_DIR', 'DSH_HOME'].map((key) => [key, process.env[key]]))
  Object.assign(process.env, { AURABOT_DATA_DIR: root, AURABOT_WORKSPACE: join(root, 'work'), AURABOT_TRASH_DIR: join(root, 'trash'), DSH_HOME: join(root, 'dsh') })
  writeFileSync(join(root, 'config.json'), JSON.stringify({
    ownerQQ: '10000001', botQQ: '20000002', enabled: false, setupDone: true,
    snowluma: { autoStart: false, autoAttach: false, dir: join(root, 'no-snowluma') },
  }))
  const fake = createFakeDsh({ brain })
  let closed = false
  const dispose = () => {
    if (closed) return
    closed = true
    fake.dispose()
  }
  t.after(() => {
    dispose()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(root, { recursive: true, force: true })
  })
  const { apply } = await import('../src/host.js')
  const api = apply(fake.ctx)
  await api.ready
  return { fake, api, dispose }
}

test('管理接口拒绝损坏或类型错误的 JSON，并且不改变现有设置', async (t) => {
  const { fake } = await setup(t)
  assert.equal((await fake.call('/notice/toggle', { kind: 'approval', value: false })).json().ok, true)
  for (const value of [Buffer.from('{"kind":'), [], Buffer.from('null')]) {
    const r = (await fake.call('/notice/toggle', value)).json()
    assert.equal(r.ok, false)
    assert.match(r.message, /JSON/)
    assert.equal((await fake.call('/notice/state')).json().approval, false)
  }
})

test('连接自测只接受主动提交，排队或模拟的消息不算送达', async (t) => {
  const { fake, api } = await setup(t)
  await fake.call('/save', { enabled: true, debug: false, dryRun: false })
  const calls = []
  let receipt = { queued: true }
  t.mock.method(api.hub, 'sendText', async (...args) => { calls.push(args); return receipt })
  assert.equal((await fake.call('/test-send')).json().ok, false)
  assert.equal(calls.length, 0)
  assert.equal((await fake.call('/test-send', {})).json().ok, false)
  assert.deepEqual(calls[0][5], { allowQueue: false, system: true })
  receipt = { simulated: true }
  assert.equal((await fake.call('/test-send', {})).json().ok, false)
  receipt = { message_id: 10 }
  assert.equal((await fake.call('/test-send', {})).json().ok, true)
})

test('刚启用插件便卸载时，迟到的看门狗不会重新打开 QQ 网关', async (t) => {
  const { fake, api, dispose } = await setup(t)
  assert.equal((await fake.call('/save', { enabled: true })).json().ok, true)
  dispose()
  await delay(150)
  assert.equal(api.onebot.state, 'stopped')
})

test('开启调试的开场白期间，面板请求不会拿到开场白的回执', async (t) => {
  let greet
  const greeting = new Promise((resolve) => { greet = resolve })
  let started
  const greetingStarted = new Promise((resolve) => { started = resolve })
  t.after(() => greet('开场白'))
  const { fake } = await setup(t, async ({ text }) => {
    if (text.includes('调试模式刚开始')) {
      started()
      return greeting
    }
    return '专门回答测试消息'
  })
  await fake.call('/save', { debug: true })
  await greetingStarted
  const early = (await fake.call('/debug/say', { text: '测试消息' })).json()
  assert.equal(early.ok, false)
  assert.match(early.message, /等一下/)
  greet('开场白')
  for (let i = 0; i < 50; i++) {
    const result = (await fake.call('/debug/say', { text: '测试消息' })).json()
    if (result.ok) {
      assert.equal(result.text, '专门回答测试消息')
      return
    }
    await delay(10)
  }
  assert.fail('开场白后没有收到测试消息的回复')
})

test('定时云备份遇到本地打包后，空闲时完成 WebDAV 推送并重排次日任务', async (t) => {
  const { fake } = await setup(t)
  const now = new Date(2026, 10, 15, 2, 59)
  t.mock.timers.enable({ apis: ['Date'], now })
  const timers = []
  const original = globalThis.setTimeout
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {
    if (ms !== 60_000) return original(callback, ms, ...args)
    timers.push(callback)
    return original(() => {}, 60_000).unref()
  })
  const sent = []
  const { pushHooks } = await import('../src/core/backup-push.js')
  const previousFetch = pushHooks.fetch
  t.after(() => { pushHooks.fetch = previousFetch })
  pushHooks.fetch = async (_url, init) => {
    sent.push(init.method)
    return { ok: true, status: 200, text: async () => '<d:multistatus />' }
  }
  const headers = { 'x-aurabot-backup': '1' }
  await fake.call('/backup/remote/config', {
    enabled: true, time: '03:00', provider: 'webdav',
    webdav: { url: 'https://dav.example.com', username: 'u', password: 'fixture-password' },
  }, headers)
  const state = async () => (await fake.call('/backup/remote/state')).json()
  assert.equal((await state()).nextAt, new Date(2026, 10, 15, 3).toISOString())
  assert.equal(timers.length, 1)
  assert.equal((await fake.call('/backup/create', {}, headers)).json().ok, true)
  assert.equal((await fake.call('/backup/state')).json().job.running, true)
  t.mock.timers.setTime(+now + 60_000)
  timers.shift()()
  assert.equal((await state()).nextAt, new Date(2026, 10, 15, 3, 1).toISOString())
  assert.equal(timers.length, 1)
  assert.deepEqual(sent, [])
  for (let i = 0; i < 100 && (await fake.call('/backup/state')).json().job.running; i++) await delay(10)
  t.mock.timers.setTime(+now + 120_000)
  timers.shift()()
  for (let i = 0; i < 100 && (await state()).job?.running; i++) await delay(10)
  assert.equal((await state()).job?.ok, true)
  assert.ok(sent.includes('PUT'))
  assert.equal((await state()).nextAt, new Date(2026, 10, 16, 3).toISOString())
})

test('刷新群角色时失败不沿用管理员权限，旧账号迟到的回执也不会覆盖新账号', async () => {
  let botQQ = '1'
  let lookup = async () => ({ role: 'owner' })
  const roles = createGroupRoles({
    getConfig: () => ({ botQQ }),
    onebot: { call: (_action, params) => lookup(params) },
  })
  assert.equal(await roles.get('42'), 'owner')
  lookup = async () => { throw new Error('查询失败') }
  assert.equal(await roles.get('42', { fresh: true }), '')
  let completeOld
  lookup = ({ user_id }) => user_id === 1 ? new Promise((resolve) => { completeOld = resolve }) : { role: 'member' }
  const previous = roles.get('42', { fresh: true })
  await Promise.resolve()
  botQQ = '2'
  assert.equal(await roles.get('42'), 'member')
  completeOld({ role: 'admin' })
  assert.equal(await previous, '')
  assert.equal(roles.peek('42'), 'member')
})
