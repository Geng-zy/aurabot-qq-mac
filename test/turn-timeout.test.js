// 轮次兜底（移植自原项目 9c8c0f5 / 077b56c）：一轮卡住超过「一轮最多等多久」就强制放开；填 0 不兜底。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalize } from '../src/core/config.js'
import { createHub } from '../src/chat/hub.js'
import { createMindAdapter } from '../src/mind-adapter/index.js'
import { createFakeDsh } from './helpers/fake-dsh.js'

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate) }

function setup(t, minutes, { brain, replyMarker = false, withMind = false, buildTools } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aurabot-turn-timeout-'))
  const oldDir = process.env.AURABOT_DATA_DIR
  process.env.AURABOT_DATA_DIR = join(root, 'data')
  let unstick
  const stuck = new Promise((resolve) => { unstick = resolve })
  const fake = createFakeDsh({ brain: brain || (async () => { await stuck; return '终于回了' }) })
  const cfg = normalize({ enabled: true, dryRun: true, setupDone: true, ownerQQ: '8', botQQ: '9', workspaceDir: join(root, 'ws'),
    merge: { enabled: false }, voice: { enabled: false }, stickers: { autoChance: 0 }, chat: { turnTimeoutMinutes: minutes, replyMarker } })
  const warnings = [], logs = []
  const log = { info: (...parts) => logs.push(parts.join(' ')), debug() {}, error() {}, warn: (...a) => warnings.push(a.join(' ')) }
  const mind = withMind ? createMindAdapter({ memoryDb: true, getConfig: () => cfg }) : undefined
  mind?.mind.setPersonaCard('固定的人格卡')
  const hub = createHub({ dsh: fake.ctx, getConfig: () => cfg, log, mind, buildTools, onebot: { async call() { return { message_id: 1 } } } })
  fake.ctx.effect(() => fake.ctx.on('session/event', hub.onSessionEvent))
  t.after(() => {
    unstick()
    hub.dispose()
    mind?.close()
    fake.dispose()
    if (oldDir === undefined) delete process.env.AURABOT_DATA_DIR
    else process.env.AURABOT_DATA_DIR = oldDir
    rmSync(root, { recursive: true, force: true })
  })
  return { hub, fake, warnings, logs, chat: { kind: 'private', chatId: 'private:8', userId: '8', nickname: '主人' } }
}

test('一轮卡住超过上限就强制放开', async (t) => {
  const s = setup(t, 0.05) // 3 秒
  void s.hub.pushToSession(s.chat, [{ type: 'text', text: '卡住试试' }], '8').catch(() => {})
  await settle()
  await new Promise((r) => setTimeout(r, 3600))
  assert.ok(s.warnings.some((m) => m.includes('强制放开')), JSON.stringify(s.warnings))
})

test('填 0 = 不兜底，不会超时放开', async (t) => {
  const s = setup(t, 0)
  void s.hub.pushToSession(s.chat, [{ type: 'text', text: '卡住试试' }], '8').catch(() => {})
  await settle()
  await new Promise((r) => setTimeout(r, 3600))
  assert.ok(!s.warnings.some((m) => m.includes('强制放开')), JSON.stringify(s.warnings))
})

test('配置：默认 30 分钟，0 保留，超出范围夹到 180', () => {
  assert.equal(normalize({}).chat.turnTimeoutMinutes, 30)
  assert.equal(normalize({ chat: { turnTimeoutMinutes: 0 } }).chat.turnTimeoutMinutes, 0)
  assert.equal(normalize({ chat: { turnTimeoutMinutes: 999 } }).chat.turnTimeoutMinutes, 180)
})

test('严格模式重写一次，只发送标记内的正文', async (t) => {
  const s = setup(t, 1, { replyMarker: true, brain: async ({ text, ctxText }) => {
    assert.match(ctxText, /⟦REPLY⟧/)
    return text.includes('请把上一轮') ? '不能发的说明 ⟦REPLY⟧只发这句⟦/REPLY⟧ 草稿' : '第一次缺正文标记'
  } })
  await s.hub.pushToSession(s.chat, [{ type: 'text', text: '重写测试' }], '8')
  await settle()
  assert.equal(s.fake.turns.length, 2)
  assert.equal(s.hub.turnRunning(s.chat.chatId), false)
  const sent = s.logs.filter((line) => line.includes('试运行（没真发）'))
  assert.equal(sent.length, 1, JSON.stringify(s.logs))
  assert.match(sent[0], /只发这句/)
  assert.doesNotMatch(sent[0], /不能发|草稿|第一次/)
})

test('重写请求被宿主拒绝时释放轮次，后续正常消息仍能处理', async (t) => {
  let resume
  const first = new Promise((resolve) => { resume = resolve })
  const s = setup(t, 1, { replyMarker: true, brain: async ({ text }) => {
    if (text === '第一次输入') { await first; return '缺标记' }
    return '⟦REPLY⟧后续正常回话⟦/REPLY⟧'
  } })
  const run = s.hub.pushToSession(s.chat, [{ type: 'text', text: '第一次输入' }], '8')
  await settle()
  const agent = [...s.fake.agents.values()][0]
  assert.ok(agent)
  const followup = agent.followup.bind(agent)
  agent.followup = (message) => message.content.some((block) => block.text?.includes('请把上一轮'))
    ? Promise.reject(new Error('模拟宿主拒绝'))
    : followup(message)
  resume()
  await run
  await settle()
  assert.equal(s.hub.turnRunning(s.chat.chatId), false)
  await s.hub.pushToSession(s.chat, [{ type: 'text', text: '第二次输入' }], '8')
  await settle()
  assert.equal(s.fake.turns.length, 2)
  assert.ok(s.logs.some((line) => line.includes('试运行（没真发）') && line.includes('后续正常回话')))
})

test('空回复先缩短上下文，再换会话用最简人格补写；只发一次', async (t) => {
  const s = setup(t, 1, { withMind: true, brain: async () => '' })
  const requests = []
  s.fake.ctx.llm.stream = async function * (request) {
    requests.push(request)
    if (requests.length === 2) yield { type: 'text-delta', text: '这是兜底正文' }
  }
  await s.hub.pushToSession(s.chat, [{ type: 'text', text: '你好' }], '8')
  await settle()
  assert.equal(requests.length, 2)
  assert.match(requests[0].system, /固定的人格卡/)
  assert.match(requests[1].system, /固定的人格卡/)
  assert.ok(requests[1].system.length < requests[0].system.length)
  assert.equal(s.fake.agents.size, 2)
  assert.equal(s.logs.filter((line) => line.includes('试运行（没真发）') && line.includes('这是兜底正文')).length, 1)
  assert.equal(s.hub.turnRunning(s.chat.chatId), false)
})

test('主动选择沉默或已经执行工具时不补写回复', async (t) => {
  let executions = 0, recoveryCalls = 0
  const s = setup(t, 1, {
    withMind: true,
    brain: async ({ text, callTool }) => {
      if (text === '选择沉默') return '[沉默]'
      await callTool('test_effect', {})
      return ''
    },
    buildTools: () => [{ name: 'test_effect', execute: () => { executions++; return { ok: true } } }],
  })
  s.fake.ctx.llm.stream = async function * () { recoveryCalls++; yield { type: 'text-delta', text: '不该发的话' } }
  for (const text of ['选择沉默', '调用工具']) {
    await s.hub.pushToSession(s.chat, [{ type: 'text', text }], '8')
    await settle()
  }
  assert.equal(executions, 1)
  assert.equal(recoveryCalls, 0)
  assert.ok(s.logs.every((line) => !line.includes('不该发的话')))
})
