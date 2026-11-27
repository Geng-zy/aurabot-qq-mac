// 预设的来源：宿主 header 只是「创建时的事实」，会话中途换过预设它就过期了。
// 我们建会话时自己记一份当前值，优先级高于 header —— 这条测试把顺序钉住。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { presetOfAgent, createPurgeScope, presetKey } from '../src/integration/purge-scope.js'

const agentWith = ({ id = 's1', header = undefined, preset = undefined } = {}) => ({
  session: { id, header: header === undefined ? {} : { agentPreset: header } },
  ...(preset === undefined ? {} : { preset }),
})

test('自己记的预设优先于 header（header 是创建事实，可能已过期）', () => {
  const scope = createPurgeScope({ log: { debug() {} } })
  const agent = agentWith({ id: 's1', header: 'aurabot-private' })
  assert.equal(presetOfAgent(agent, (id) => scope.presetFor(id)), 'aurabot-private')
  scope.notePreset('s1', 'aurabot-social')
  assert.equal(presetOfAgent(agent, (id) => scope.presetFor(id)), 'aurabot-social',
    '会话中途换成 social 后，header 里的 private 不能再被当成当前预设')
})

test('没记过时退回 agent.preset，再退回 header', () => {
  const lookup = () => ''
  assert.equal(presetOfAgent(agentWith({ preset: 'aurabot-subagent', header: 'aurabot-private' }), lookup), 'aurabot-subagent')
  assert.equal(presetOfAgent(agentWith({ header: 'aurabot-private' }), lookup), 'aurabot-private')
  assert.equal(presetOfAgent(agentWith({}), lookup), '')
})

test('拿不到 id / 抛错都不影响：返回空串，调用方按「没有预设」处理', () => {
  const scope = createPurgeScope({})
  assert.equal(presetOfAgent(null, (id) => scope.presetFor(id)), '')
  assert.equal(presetOfAgent({ session: { get id() { throw new Error('boom') } } }, () => ''), '')
})

test('键归一化：hub 的 sessionKey 会去掉 session- 前缀，记录与查询必须都能对上', () => {
  const scope = createPurgeScope({})
  scope.notePreset('session-abc', 'aurabot-social')
  assert.equal(scope.presetFor('abc'), 'aurabot-social', '去掉前缀查得到')
  assert.equal(scope.presetFor('session-abc'), 'aurabot-social', '带前缀也查得到')
  assert.equal(presetOfAgent({ session: { id: 'session-abc' } }, (id) => scope.presetFor(id)), 'aurabot-social',
    'agent.session.id 带前缀时也要命中（真机上就是这种形态）')
  scope.forgetPreset('session-abc')
  assert.equal(scope.presetFor('abc'), '', '忘掉时两种写法都清')
})

test('notePreset / forgetPreset：会话销毁后忘掉，别让表无限长', () => {
  const scope = createPurgeScope({})
  scope.notePreset('s9', 'aurabot-private')
  assert.equal(scope.presetFor('s9'), 'aurabot-private')
  scope.forgetPreset('s9')
  assert.equal(scope.presetFor('s9'), '')
})

test('会话中途换预设：agent-preset/selected 事件会更新「当前预设」', async () => {
  const { createSessionEventHandler } = await import('../src/chat/session-events.js')
  const noted = []
  const handler = createSessionEventHandler({
    sessionKey: (id) => String(id ?? '').replace(/^session-/, ''),
    sessionToChat: new Map(), chatOfSession: () => '', turnState: new Map(), running: new Map(),
    turnCurrent: () => '', markRunning: () => {}, accountUsage: () => {}, sessionTarget: () => null,
    reasoningOf: () => '', assistantReplyText: () => '', cleaningFor: () => ({ protectedText: () => false }),
    blockSessionPrivacy: () => {}, log: { debug() {}, info() {}, warn() {} }, getConfig: () => ({}),
    getMind: () => null, noteUsage: () => {}, takeInterim: () => '', extractReply: () => ({ text: '' }),
    guardReply: (x) => x, chainSend: () => {}, deliver: () => {}, map: () => ({ chats: {} }),
    audienceRevision: () => '', release: () => {}, rememberFinished: () => {}, slowNoticeSent: new Set(),
    clearSlowNotices: () => {}, clearRunning: () => {}, stopTyping: () => {}, rescueFromThinking: () => {},
    isSilence: () => false, requestReplyRewrite: () => {}, completedTurn: () => {}, redact: (x) => x,
    recoverReply: () => {}, debugWaiters: new Map(), turnSessionCurrent: () => true,
    outputSources: new Map(), turnEpochs: new Map(), sendChain: () => {},
    notePreset: (id, preset) => noted.push([id, preset]),
  })
  handler({ id: 'session-abc' }, { type: 'agent-preset/selected', data: { agentPreset: 'aurabot-social' } })
  assert.deepEqual(noted, [['abc', 'aurabot-social']], '要用 sessionKey 归一化后的 id，并记录新预设')
  // 别的事件不受影响（这条事件在 chatId 兜底之前就该被消费掉）
  handler({ id: 'session-abc' }, { type: 'turn/start', data: { turn: 1 } })
  assert.equal(noted.length, 1)
})

test('建会话不再登记预设：源码里 createSessionNow 不调用 notePreset', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/chat/session-create.js', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('async function createSessionNow'))
  assert.ok(!/notePreset\s*\(/.test(body),
    '建会话时不允许登记预设：DSH 的 create 可能复用已有会话，请求值不可信（会在真机上造成登记值≠header）')
})

test('环形缓冲：最近几次登记都能查到，不会被后来的记录冲掉', () => {
  const scope = createPurgeScope({})
  scope.notePreset('s1', 'standard', { source: 'event' })
  scope.notePreset('s1', 'aurabot-social', { source: 'event' })
  scope.notePreset('s2', 'aurabot-private-long', { source: 'event' })
  const recent = scope.recentPresets()
  assert.equal(recent.length, 3)
  assert.deepEqual(recent.map((r) => r.preset), ['standard', 'aurabot-social', 'aurabot-private-long'])
  assert.deepEqual(recent.map((r) => r.source), ['event', 'event', 'event'])
})

test('hub 的事件处理器要把 source 透传给 notePreset（否则「切换」会被记成「创建」）', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/chat/hub.js', import.meta.url), 'utf8')
  assert.ok(/notePreset: \(id, preset, info\) => purge\.notePreset\(id, preset, info\)/.test(src),
    'hub 包装必须把第三个参数原样传下去：丢了 source 就分不清「建会话」和「中途切换」')
})
