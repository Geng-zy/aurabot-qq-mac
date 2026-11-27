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

test('presetToNote：宿主报的优先；新建用请求值；重挂且宿主没报就不猜', async () => {
  const { presetToNote } = await import('../src/chat/session-create.js')
  assert.equal(presetToNote({ reported: 'aurabot-social', requested: 'aurabot-private-long' }), 'aurabot-social',
    '宿主报了就用宿主报的（最权威）')
  assert.equal(presetToNote({ requested: 'aurabot-private-long' }), 'aurabot-private-long', '新建：用请求值')
  assert.equal(presetToNote({ requested: 'aurabot-social', recovered: true }), '',
    '重挂到已有会话且宿主没报：不记，交给 agent.preset / header 回落')
  assert.equal(presetToNote({}), '', '什么都没有就是空')
})
