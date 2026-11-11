// 换新会话时把旧会话里还没记的马上记成经历（不等聊天停下来）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test('聊天中枢：换新会话那一刻叫心智把这个聊天记一遍', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aurabot-rotate-'))
  const old = process.env.AURABOT_DATA_DIR
  process.env.AURABOT_DATA_DIR = join(root, 'data')
  const fake = createFakeDsh({ brain: async () => '好' })
  const cfg = normalize({ enabled: true, dryRun: true, setupDone: true, ownerQQ: '8', botQQ: '9', workspaceDir: join(root, 'ws'), merge: { enabled: false }, voice: { enabled: false }, stickers: { autoChance: 0 } })
  let rotate = false
  const encoded = []
  const mind = { shouldRotate: () => (rotate ? '测试换新' : ''), encodeChat: async (chatId) => { encoded.push(chatId); return 1 } }
  const hub = createHub({ dsh: fake.ctx, getConfig: () => cfg, log: { info() {}, warn() {}, debug() {}, error() {} }, onebot: { async call() { return { message_id: 1 } } }, mind })
  fake.ctx.effect(() => fake.ctx.on('session/event', hub.onSessionEvent))
  t.after(() => { hub.dispose(); fake.dispose(); if (old === undefined) delete process.env.AURABOT_DATA_DIR; else process.env.AURABOT_DATA_DIR = old; rmSync(root, { recursive: true, force: true }) })
  const chat = { kind: 'private', chatId: 'private:8', userId: '8', nickname: '主人' }
  await hub.pushToSession(chat, [{ type: 'text', text: '第一句' }], '8')
  const first = hub.sessions()['private:8'].sessionId
  for (let i = 0; i < 30 && fake.turns.length < 1; i++) await new Promise((r) => setTimeout(r, 20))
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual(encoded, [])
  rotate = true
  await hub.pushToSession(chat, [{ type: 'text', text: '第二句' }], '8')
  assert.notEqual(hub.sessions()['private:8'].sessionId, first, '换了新会话')
  assert.deepEqual(encoded, ['private:8'])
})
