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

function setup(t, minutes, { brain, replyMarker = false, withMind = false, buildTools, ask } = {}) {
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
  const mind = withMind ? createMindAdapter({ memoryDb: true, getConfig: () => cfg, ask }) : undefined
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
  return { hub, fake, mind, warnings, logs, chat: { kind: 'private', chatId: 'private:8', userId: '8', nickname: '主人' } }
}

test('只向指定群放行核准的片段，撤回使旧会话、断线待发和回忆失效', async (t) => {
  const s = setup(t, 1, { withMind: true, brain: async () => '[沉默]' })
  const { memory } = s.mind.mind
  const privateWindow = 'qq:private:8'
  const group = { kind: 'group', chatId: 'group:20', userId: '8', groupId: '20' }
  const excerpt = '我们一起看了鲸鱼的海洋纪录片'
  const source = memory.insert({ at: Date.now(), window: privateWindow, kind: 'event', gist: excerpt })
  const share = memory.shareEpisode(source, { audience: 'qq:group:20', text: excerpt })
  const queued = { chatId: group.chatId, privacyRevision: memory.audienceRevision(), params: { message: [{ type: 'text', data: { text: excerpt } }] } }
  assert.equal(s.hub.canReplayDelivery(queued), true)
  assert.equal((await s.hub.capture(() => s.hub.deliver(group.chatId, excerpt))).sent.length, 1)
  assert.equal((await s.hub.capture(() => s.hub.deliver('private:12', excerpt))).sent.length, 0)
  await s.hub.pushToSession(group, [{ type: 'text', text: '鱼鱼在吗' }], '8')
  await settle()
  memory.revokeShare(share)
  assert.equal(s.hub.canReplayDelivery(queued), false)
  assert.equal((await s.hub.capture(() => s.hub.deliver(group.chatId, excerpt))).sent.length, 0)
  await s.hub.pushToSession(group, [{ type: 'text', text: '鱼鱼你好' }], '8')
  await settle()
  assert.equal(s.fake.turns.length, 2)
  assert.notEqual(s.fake.turns[0].sessionId, s.fake.turns[1].sessionId)
})

test('群聊回复被判定为转述私事时拦截，普通话题照常发送', async (t) => {
  const checks = []
  const s = setup(t, 1, { withMind: true, ask: async ({ scene, text }) => {
    if (scene !== 'privacy') return '{}'
    const input = JSON.parse(text)
    checks.push(input)
    return JSON.stringify({ block: input.draft.includes('留给你们碰面') })
  } })
  s.mind.mind.memory.insert({ at: Date.now(), window: 'qq:private:8', kind: 'event', gist: '琥珀灯塔是我们约定的秘密地点' })
  const leaked = await s.hub.capture(() => s.hub.deliver('group:20', '琥珀灯塔是留给你们碰面的地方'))
  const ordinary = await s.hub.capture(() => s.hub.deliver('group:20', '帮你找对象？先请我吃烤串吧'))
  assert.equal(leaked.sent.length, 0)
  assert.equal(ordinary.sent.length, 1)
  assert.equal(checks.length, 1)
  assert.match(checks[0].restricted[0], /秘密地点/)
})

test('超长回复在拆成多个气泡时也使用同一个字数上限，保留完整 emoji', async (t) => {
  const s = setup(t, 1)
  const first = '开始看这份说明。'.repeat(140)
  const second = '🙂继续查看测试说明。'.repeat(120)
  const { sent } = await s.hub.capture(() => s.hub.deliver(s.chat.chatId, `${first}|||${second}`, { simulate: true }))
  assert.equal(sent.length, 2)
  const delivered = sent.flatMap(({ message }) => message.filter(({ type }) => type === 'text').map(({ data }) => data.text)).join('')
  assert.equal(Array.from(delivered).length, 1500)
  assert.match(delivered, /…$/)
  assert.doesNotMatch(delivered, /\p{Surrogate}/u)
})

test('审核还没返回时撤回分享，已经生成的旧回复也不投递', async (t) => {
  let finish, entered
  const verdict = new Promise((resolve) => { finish = resolve })
  const checking = new Promise((resolve) => { entered = resolve })
  const s = setup(t, 1, { withMind: true, ask: async ({ scene }) => {
    if (scene !== 'privacy') return '{}'
    entered()
    return verdict
  } })
  t.after(() => finish('{"block":false}'))
  const { memory } = s.mind.mind
  const source = memory.insert({ at: Date.now(), window: 'qq:private:8', kind: 'event', gist: '琥珀灯塔是我们约定的秘密地点' })
  const share = memory.shareEpisode(source, { audience: 'qq:group:20', text: '琥珀灯塔是这次活动的集合点' })
  const delivering = s.hub.capture(() => s.hub.deliver('group:20', '琥珀灯塔是这次活动的集合点'))
  await checking
  memory.revokeShare(share)
  finish('{"block":false}')
  assert.equal((await delivering).sent.length, 0)
})

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
