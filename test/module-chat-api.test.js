// 模块的聊天接入接口（移植自原项目 5cdbcd4）：本分叉没有原项目的旧记忆和原话档案，管理员输入改为记进心智核心的感知。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFakeDsh } from './helpers/fake-dsh.js'
import { normalize } from '../src/core/config.js'
import { createHub } from '../src/chat/hub.js'
import { buildWav } from '../src/voice/wav.js'

const OWNER = '10001', CHAT = `private:${OWNER}`, GROUP = 'group:555'
const ownerChat = { chatId: CHAT, kind: 'private', userId: OWNER, groupId: '', nickname: '管理员' }
const groupChat = { chatId: GROUP, kind: 'group', userId: OWNER, groupId: '555', nickname: '管理员' }
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
function setup(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-module-chat-'))
  const before = { data: process.env.AURABOT_DATA_DIR, workspace: process.env.AURABOT_WORKSPACE }
  process.env.AURABOT_DATA_DIR = dir; process.env.AURABOT_WORKSPACE = join(dir, 'workspace')
  const cfg = normalize({ enabled: true, dryRun: false, setupDone: true, ownerQQ: OWNER, botQQ: '20002',
    allow: { private: ['10002'], groups: ['555'] }, voice: { enabled: false },
    stickers: { enabled: false }, conversationContext: { enabled: true }, model: { vision: 'on' }, merge: { enabled: false } })
  const fake = createFakeDsh({ brain: async () => '' }), rows = [], calls = [], memory = [], activity = []
  let muted = false
  const hub = createHub({ dsh: fake.ctx, getConfig: () => cfg,
    log: { info() {}, warn() {}, debug() {}, error() {} },
    onebot: { connected: true, async call(action, params) { calls.push({ action, params }); return { message_id: calls.length } } },
    mind: { perceive: (msg) => { memory.push(msg); return true } }, onActivity: (a) => activity.push(a), stickers: options.stickers,
    isMuted: () => muted, hooks: { journal: (row) => rows.push(row), ...options.hooks } })
  const off = fake.ctx.on('session/event', hub.onSessionEvent)
  t.after(() => {
    hub.dispose(); off(); fake.dispose()
    for (const [key, value] of [['AURABOT_DATA_DIR', before.data], ['AURABOT_WORKSPACE', before.workspace]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    rmSync(dir, { recursive: true, force: true })
  })
  return { hub, cfg, fake, rows, calls, memory, activity, mute: (value) => { muted = value } }
}

test('流水通知与落盘同源：来源端标记不落盘，监听失败不影响写入，调试不通知', async (t) => {
  const s = setup(t)
  assert.equal(s.hub.logChat(CHAT, '管理员', 'a'.repeat(600), OWNER, { via: 'external', originId: 'client-1' }), true)
  assert.equal(s.rows.length, 1); assert.equal(s.rows[0].text.length, 500); assert.equal(s.rows[0].originId, 'client-1')
  const [day] = s.hub.chatLogDays(), [row] = s.hub.chatLogOf(day)
  assert.deepEqual(row, Object.fromEntries(Object.entries(s.rows[0]).filter(([k]) => k !== 'originId')))
  assert.equal('originId' in row, false)
  // sendText 只负责网关发送；正常回复由 deliver 统一记账，避免分条/语音重复落盘。
  await s.hub.deliver(CHAT, '实际发出的消息')
  assert.deepEqual(s.calls, [{ action: 'send_private_msg', params: { user_id: Number(OWNER), message: [{ type: 'text', data: { text: '实际发出的消息' } }] } }])
  const replies = s.rows.filter((r) => r.who === 'bot')
  assert.equal(replies.length, 1)
  assert.equal(replies[0].text, '实际发出的消息')
  assert.deepEqual(s.hub.chatLogDays().flatMap((d) => s.hub.chatLogOf(d)).filter((r) => r.who === 'bot'), replies)
  const count = s.rows.length
  s.cfg.debug = true; s.hub.logChat(CHAT, '管理员', '调试内容', OWNER)
  assert.equal(s.rows.length, count); assert.ok(!s.hub.chatLogOf(day).some((r) => r.text === '调试内容'))
  const other = setup(t, { hooks: { journal() { throw new Error('consumer failed') } } })
  assert.equal(other.hub.logChat(CHAT, 'bot', '落盘不回滚'), true)
  assert.equal(other.hub.chatLogOf(other.hub.chatLogDays()[0])[0].text, '落盘不回滚')
})

test('回复分条投递时，流水和活动只记录实际确认的内容', async (t) => {
  const s = setup(t, { hooks: { send(message) {
    if (message[0].data.text === '拦截这条') return null
    return [{ type: 'text', data: { text: '钩子修改后的内容' } }]
  } } })
  const blocked = await s.hub.deliver(CHAT, '拦截这条')
  assert.equal(blocked.delivered, false)
  assert.deepEqual(s.rows, [])
  assert.deepEqual(s.activity, [])
  const partial = await s.hub.deliver(CHAT, '改写这条|||拦截这条')
  assert.equal(partial.delivered, true)
  assert.deepEqual(s.rows.map(({ text }) => text), ['钩子修改后的内容'])
  assert.deepEqual(s.activity.map(({ reply }) => reply), ['钩子修改后的内容'])
  assert.equal(s.hub.lastBotToOwner.text, '钩子修改后的内容')
})

test('表情被拦截时无回执也不增加用量，确认后按真实名称进入流水', async (t) => {
  const used = []
  let blocked = true
  const s = setup(t, {
    hooks: { send: (message) => blocked ? null : message },
    stickers: {
      match: () => ({ name: '收到', md5: 'a12345678' }),
      segmentFor: () => ({ type: 'image', data: { file: 'test.jpg' } }),
      markUsed: (id) => used.push(id),
    },
  })
  s.cfg.stickers.enabled = true
  assert.equal(await s.hub.sendSticker(CHAT, '收到', undefined, undefined, { detailed: true }), 'unconfirmed')
  assert.deepEqual(used, [])
  assert.equal(s.hub.stats().stickers, 0)
  blocked = false
  assert.equal((await s.hub.deliver(CHAT, '<sticker:收到>')).delivered, true)
  assert.deepEqual(used, ['a12345678'])
  assert.equal(s.hub.stats().stickers, 1)
  assert.equal(s.rows[0].text, '[表情：收到]')
})

test('外部管理员输入复用已有会话、心智核心的感知和来源，群会话保留 social 权限', async (t) => {
  const s = setup(t)
  await s.hub.pushToSession(ownerChat, [{ type: 'text', text: '准备' }], OWNER)
  const sid = s.hub.sessions()[CHAT].sessionId
  let checks = 0
  assert.deepEqual(await s.hub.receiveOwnerMessage(CHAT, { text: '记住：喜欢蓝色', via: 'companion', originId: 'source-1', assertAuthorized: () => { checks++ } }), { ok: true })
  const turn = s.fake.turns.at(-1)
  assert.equal(turn.sessionId, sid); assert.equal(turn.source.speaker.role, 'owner'); assert.ok(checks >= 3)
  const seen = s.memory.find((m) => m.text === '记住：喜欢蓝色')
  assert.ok(seen, '她感知到了这句')
  assert.equal(seen.chatId, CHAT); assert.equal(seen.userId, OWNER); assert.equal(seen.messageId, 'companion:source-1')
  const row = s.rows.find((r) => r.text === '记住：喜欢蓝色')
  assert.equal(row.via, 'companion'); assert.equal(row.originId, 'source-1'); assert.equal(row.uid, OWNER)
  assert.ok(s.activity.some((a) => a.kind === 'in' && a.owner && a.text.includes('喜欢蓝色')))
  await s.hub.pushToSession(groupChat, [{ type: 'text', text: '群准备' }], OWNER)
  const groupSid = s.hub.sessions()[GROUP].sessionId
  await s.hub.receiveOwnerMessage(GROUP, { text: '来自外部的群消息', via: 'companion' })
  assert.equal(s.fake.turns.at(-1).sessionId, groupSid); assert.equal(s.fake.turns.at(-1).preset, 'aurabot-social')
  assert.equal(s.fake.turns.at(-1).source.speaker.chat, 'group')
  assert.equal(s.fake.turns.at(-1).source.speaker.role, 'owner'); assert.equal(Object.keys(s.hub.sessions()).length, 2)
  await assert.rejects(s.hub.receiveOwnerMessage('private:999', { text: '不创建会话' }), { status: 404 })
  await assert.rejects(s.hub.receiveOwnerMessage('system:other', { text: '不创建系统会话' }), { status: 404 })
  s.cfg.allow.groups = []
  await assert.rejects(s.hub.receiveOwnerMessage(GROUP, { text: '不绕白名单' }), { status: 403 })
  s.mute(true)
  await assert.rejects(s.hub.receiveOwnerMessage(CHAT, { text: '不绕暂停' }), { status: 403 })
  s.mute(false); s.cfg.enabled = false
  await assert.rejects(s.hub.receiveOwnerMessage(CHAT, { text: '不绕总开关' }), { status: 503 })
})

test('外部 WAV 直接走既有 DSH 识别，不调用 QQ 音频接口；撤销期间不写迟到流水或提交模型', async (t) => {
  const s = setup(t)
  await s.hub.pushToSession(ownerChat, [{ type: 'text', text: '准备' }], OWNER)
  const wav = buildWav(new Int16Array(160), 16000)
  let seen = false
  s.fake.ctx.services.speechToText = { resolve: ({ audio }) => { seen = Buffer.from(audio).equals(wav); return {} }, transcribe: async () => '外部语音内容' }
  await s.hub.receiveOwnerMessage(CHAT, { wav })
  assert.equal(seen, true); assert.ok(s.fake.turns.at(-1).userText.includes('外部语音内容'))
  assert.ok(!s.calls.some((c) => ['get_record', 'fetch_ptt_text'].includes(c.action)))
  const gate = deferred(), entered = deferred()
  s.fake.ctx.services.speechToText.transcribe = () => { entered.resolve(); return gate.promise }
  let authorized = true
  const pending = s.hub.receiveOwnerMessage(CHAT, { wav, assertAuthorized: () => { if (!authorized) throw Object.assign(new Error('revoked'), { status: 401 }) } })
  await entered.promise; authorized = false; gate.resolve('迟到输入')
  await assert.rejects(pending, { status: 401 })
  assert.ok(!s.rows.some((r) => r.text.includes('迟到输入'))); assert.ok(!s.fake.turns.some((r) => r.userText.includes('迟到输入')))
})

test('异步 prompt 准备期间撤销身份，投递前再次鉴权；旧管理员在途输入不能交给新管理员会话', async (t) => {
  let block = false
  const entered = deferred(), gate = deferred()
  const s = setup(t, { hooks: { prompt: async (content) => { if (block) { entered.resolve(); await gate.promise }; return content } } })
  await s.hub.pushToSession(ownerChat, [{ type: 'text', text: '准备' }], OWNER)
  block = true
  const pending = s.hub.receiveOwnerMessage(CHAT, { text: '异步输入' })
  await entered.promise; s.cfg.ownerQQ = '10009'; gate.resolve()
  await assert.rejects(pending, { status: 503 })
  assert.ok(!s.fake.turns.some((r) => r.userText.includes('异步输入')))
})
