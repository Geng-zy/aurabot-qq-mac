// 换新会话时把旧会话里还没记的马上记成经历（不等聊天停下来）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createMindAdapter } from '../src/mind-adapter/index.js'
import { createHub } from '../src/chat/hub.js'
import { normalize } from '../src/core/config.js'
import { createFakeDsh } from './helpers/fake-dsh.js'

test('对接层：encodeChat 不等聊天停下就记，记完想得起来；调试模式不记', async () => {
  const t = Date.UTC(2026, 10, 10, 4)
  const asks = []
  const answer = JSON.stringify({ episodes: [{ type: 'fact', gist: '他说下个月要搬家', who: ['qq:1'], about: 'qq:1', speaker: 'qq:1', importance: 0.7, sources: [1] }] })
  const mk = (debug) => createMindAdapter({ memoryDb: true, getConfig: () => ({ ownerQQ: '1', debug }), now: () => t, random: () => 0.5, ask: async (o) => { asks.push(o.scene); return answer } })
  const a = mk(false)
  a.mind.updateSettings({ 'identity.age': 18 })
  a.mind.perceive({ window: 'qq:private:1', who: 'qq:1', text: '我下个月要搬家', msgId: 'x', at: t })
  assert.equal(await a.encodeChat('private:1'), 1)
  assert.ok(a.mind.memory.list({ limit: 5 }).some((m) => m.gist === '他说下个月要搬家'))
  assert.equal(await a.encodeChat('private:1'), 0, '记过的不再记')
  const d = mk(true)
  d.mind.perceive({ window: 'qq:private:1', who: 'qq:1', text: '我下个月要搬家', msgId: 'y', at: t })
  assert.equal(await d.encodeChat('private:1'), 0)
})

test('自动换新、手动重开和侧栏归档都在回复前先整理，已归档的旧聊天不复用', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aurabot-rotate-'))
  const old = process.env.AURABOT_DATA_DIR
  process.env.AURABOT_DATA_DIR = join(root, 'data')
  const fake = createFakeDsh({ brain: async () => '好' })
  const cfg = normalize({ enabled: true, dryRun: true, setupDone: true, ownerQQ: '8', botQQ: '9', workspaceDir: join(root, 'ws'), merge: { enabled: false }, voice: { enabled: false }, stickers: { autoChance: 0 } })
  let rotate = false
  const encoded = []
  const observed = []
  const mind = {
    shouldRotate: () => (rotate ? '测试换新' : ''),
    async encodeChat(chatId) {
      await delay(40)
      encoded.push(chatId)
      return 1
    },
    beforeTurn() { observed.push(encoded.length) },
  }
  const hub = createHub({ dsh: fake.ctx, getConfig: () => cfg, log: { info() {}, warn() {}, debug() {}, error() {} }, onebot: { async call() { return { message_id: 1 } } }, mind })
  fake.ctx.effect(() => fake.ctx.on('session/event', hub.onSessionEvent))
  t.after(() => { hub.dispose(); fake.dispose(); if (old === undefined) delete process.env.AURABOT_DATA_DIR; else process.env.AURABOT_DATA_DIR = old; rmSync(root, { recursive: true, force: true }) })
  const chat = { kind: 'private', chatId: 'private:8', userId: '8', nickname: '管理员' }
  await hub.pushToSession(chat, [{ type: 'text', text: '第一句' }], '8')
  const first = hub.sessions()['private:8'].sessionId
  for (let i = 0; i < 30 && fake.turns.length < 1; i++) await new Promise((r) => setTimeout(r, 20))
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual(encoded, [])
  rotate = true
  await hub.pushToSession(chat, [{ type: 'text', text: '第二句' }], '8')
  assert.notEqual(hub.sessions()['private:8'].sessionId, first, '换了新会话')
  assert.deepEqual(encoded, ['private:8'])
  assert.equal(observed.at(-1), 1, '新会话准备回复前能检索刚整理的经历')
  rotate = false
  const second = hub.sessions()['private:8'].sessionId
  const reg = fake.ctx.workspaceRegistry
  await reg.archiveSession(second)
  reg.unarchiveSession = () => assert.fail('侧栏归档的聊天不应解归档')
  await hub.pushToSession(chat, [{ type: 'text', text: '侧栏归档后' }], '8')
  assert.notEqual(hub.sessions()['private:8'].sessionId, second)
  assert.ok(reg.archivedSessionIds.includes(second))
  assert.equal(observed.at(-1), 2)
  await hub.resetSessions()
  await hub.pushToSession(chat, [{ type: 'text', text: '手动重开后' }], '8')
  assert.equal(observed.at(-1), 3)
})

test('换会话时整理全部已收到的批次，后续消息留给下一次整理', async (t) => {
  const now = Date.UTC(2026, 10, 15, 4)
  const window = 'qq:private:8'
  let calls = 0
  const a = createMindAdapter({
    memoryDb: true, getConfig: () => ({ ownerQQ: '8' }), now: () => now,
    ask: async () => {
      if (++calls === 1) a.mind.perceive({ window, who: 'qq:8', text: '换会话期间新来的消息', msgId: 'new', at: now })
      return '{"episodes":[]}'
    },
  })
  t.after(() => a.close())
  for (let i = 0; i < 65; i++) {
    const text = i === 0 ? '约好的深海灯塔集合地点是码头' : '测试用的近期聊天第' + i + '条'
    a.mind.perceive({ window, who: 'qq:8', text, msgId: String(i), at: now - 65_000 + i })
  }
  assert.match(a.carryOver('private:8', { current: '深海灯塔在哪', query: '深海灯塔在哪' }), /集合地点是码头/)
  assert.doesNotMatch(a.carryOver('private:8', { current: '深海灯塔在哪', query: '深海灯塔在哪', allowLine: (r) => !r.text.includes('码头') }), /集合地点是码头/)
  await a.encodeChat('private:8')
  assert.equal(calls, 2)
  assert.equal(a.mind._store.get('encode.cursor.' + window), 65)
  assert.ok(a.mind.memory.pendingThrough(window) > 65)
})

test('QQ 历史补拉失败会在下一轮重试，停止记录的人不会从 QQ 历史补回', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aurabot-history-retry-'))
  const old = process.env.AURABOT_DATA_DIR
  process.env.AURABOT_DATA_DIR = join(root, 'data')
  const cfg = normalize({ enabled: true, dryRun: false, ownerQQ: '8', botQQ: '9', workspaceDir: join(root, 'ws'), chat: { seedHistory: true } })
  const fake = createFakeDsh({ brain: async () => '好' })
  const mind = createMindAdapter({ memoryDb: true, getConfig: () => cfg })
  const log = { info() {}, warn() {}, debug() {}, error() {} }
  let reads = 0
  const hub = createHub({ dsh: fake.ctx, getConfig: () => cfg, log, mind, onebot: {
    async call(action) {
      if (action === 'get_friend_msg_history') {
        if (++reads === 1) throw new Error('网关暂时离线')
        return { messages: [{ sender: { user_id: '10' }, message: '测试历史原文' }] }
      }
      return { message_id: reads + 100 }
    },
  } })
  fake.ctx.effect(() => fake.ctx.on('session/event', hub.onSessionEvent))
  t.after(() => { hub.dispose(); fake.dispose(); mind.close(); if (old === undefined) delete process.env.AURABOT_DATA_DIR; else process.env.AURABOT_DATA_DIR = old; rmSync(root, { recursive: true, force: true }) })
  const chat = { chatId: 'private:10', kind: 'private', userId: '10' }
  const push = async (text) => {
    await hub.pushToSession(chat, [{ type: 'text', text }], '10')
    await delay(80)
    return fake.turns.at(-1)
  }
  assert.doesNotMatch((await push('第一条新消息')).userText, /测试历史原文/)
  assert.match((await push('第二条新消息')).userText, /测试历史原文/)
  assert.equal(reads, 2)
  mind.forgetPerson('10', 'stop', { clear: true })
  await hub.resetSessions()
  assert.doesNotMatch((await push('停止记录后的新消息')).userText, /测试历史原文/)
  assert.equal(mind.mind.history('qq:private:10').length, 0)
})
