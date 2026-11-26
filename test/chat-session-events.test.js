// 会话事件状态机的直接测试。
//
// src/chat/session-events.js 决定「这一轮发不发、发什么」——它有 43 个注入依赖、0 个直接测试，
// 以前只能靠 e2e 间接覆盖。这里用一个假依赖袋直接驱动它，把关键判定钉住：
//   正常一轮发一次 / 旧会话不发 / 隐私拦截改发沉默 / 非正常结束不发 / 工具用量归到模块 / system 轮次回答 promise。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSessionEventHandler } from '../src/chat/session-events.js'

function harness({ protectedText = false, chats = null, everyStep = false, mind = null } = {}) {
  const calls = { deliver: [], release: [], recordUsage: [], blockSessionPrivacy: [], warn: [], info: [] }
  const sessionToChat = new Map([['s1', 'private:1']])
  const turnState = new Map()
  const running = new Map()
  const turnEpochs = new Map()
  const sendChain = new Map()
  const outputSources = new Map()
  const debugWaiters = new Map()
  const slowNoticeSent = new Set()
  const sessionTarget = new Map([['s1', { provider: 'deepseek-official', model: 'deepseek-flash' }]])
  const accountUsage = (p) => {
    calls.recordUsage.push({
      module: p.st.lastTool && p.st.lastTool.turn === p.turn ? 'imagegen' : 'chat',
      chat: p.chatId,
      provider: p.target?.provider || '',
      model: p.target?.model || '',
      usage: p.usage,
      at: p.time,
    })
    p.st.lastTool = null
  }
  const handler = createSessionEventHandler({
    sessionKey: (id) => String(id || ''),
    sessionToChat,
    chatOfSession: (key) => (sessionToChat.get(key) ? '' : ''),
    turnState,
    running,
    turnCurrent: () => true,
    markRunning: (chatId, st) => running.set(chatId, st.runToken),
    accountUsage,
    sessionTarget,
    reasoningOf: () => '',
    assistantReplyText: (msg) => (msg?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''),
    cleaningFor: () => ({ protectedText: () => protectedText }),
    blockSessionPrivacy: (chatId, key) => calls.blockSessionPrivacy.push([chatId, key]),
    log: {
      debug() {}, info: (m) => calls.info.push(m), warn: (m) => calls.warn.push(m), error() {},
      child() { return this },
    },
    getConfig: () => ({ chat: { everyStep }, debug: false }),
    getMind: () => mind,
    noteUsage: () => {},
    takeInterim: (st, cur) => {
      const prev = st.interim
      st.interim = cur
      return prev && prev.text !== cur.text ? prev.text : ''
    },
    extractReply: (t) => t,
    guardReply: (t) => t,
    chainSend: (chatId, fn) => fn(),
    deliver: async (chatId, text, opts) => { calls.deliver.push({ chatId, text, opts }); return { delivered: true } },
    map: () => ({ chats: chats || { 'private:1': { sessionId: 's1', mode: 'live' } } }),
    audienceRevision: () => '',
    release: (chatId, token) => calls.release.push([chatId, token]),
    rememberFinished: (st, turn) => { (st.finishedTurns ||= new Set()).add(turn) },
    slowNoticeSent,
    clearSlowNotices: () => slowNoticeSent.clear(),
    clearRunning: (chatId) => running.delete(chatId),
    stopTyping() {},
    rescueFromThinking: () => '',
    isSilence: (t) => !t || t === '[沉默]',
    requestReplyRewrite() {},
    completedTurn: (d) => d?.reason?.kind === 'completed',
    redact: (s) => s,
    recoverReply: () => false,
    debugWaiters,
    turnSessionCurrent: () => true,
    outputSources,
    turnEpochs,
    sendChain,
  })
  return { handler, calls, turnState, running, turnEpochs, sessionToChat, debugWaiters }
}

const start = (turn) => ({ type: 'turn/start', data: { turn } })

/** 模拟 hub 起一轮：turnState 里放 runToken，running 里占位（会话事件靠它判断「这一轮还算不算数」）。 */
function arm(h, key = 's1', chatId = 'private:1', token = 'tk') {
  const st = h.turnState.get(key) || { lastTurn: -1, text: '', senders: new Set() }
  st.runToken = token
  h.turnState.set(key, st)
  h.running.set(chatId, token)
  h.turnEpochs.set(chatId, { token })
  return st
}
const say = (turn, text, extra = {}) => ({ type: 'assistant/message', data: { turn, message: { content: [{ type: 'text', text }] }, ...extra } })
const end = (turn, kind = 'completed') => ({ type: 'turn/end', data: { turn, reason: { kind } } })

test('正常一轮：turn/end 把正文发一次，并释放这一轮', async () => {
  const h = harness()
  arm(h)
  h.handler({ id: 's1' }, start(1))
  h.handler({ id: 's1' }, say(1, '你好呀'))
  h.handler({ id: 's1' }, end(1))
  await new Promise((r) => setImmediate(r))
  assert.equal(h.calls.deliver.length, 1)
  assert.equal(h.calls.deliver[0].text, '你好呀')
  assert.equal(h.calls.deliver[0].chatId, 'private:1')
  assert.equal(h.calls.release.length, 1, '发完要释放这一轮')
})

test('旧会话（映射指向别的 sessionId）这一轮不发', async () => {
  const h = harness({ chats: { 'private:1': { sessionId: 's9', mode: 'live' } } })
  arm(h)
  h.handler({ id: 's1' }, start(1))
  h.handler({ id: 's1' }, say(1, '这句话不该发出去'))
  h.handler({ id: 's1' }, end(1))
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(h.calls.deliver, [])
  assert.equal(h.calls.release.length, 1, '不发也要释放，别把这一轮挂住')
})

test('回复触及私密内容：改发「[沉默]」并标记更换会话', async () => {
  const h = harness({ protectedText: true })
  arm(h)
  h.handler({ id: 's1' }, start(1))
  h.handler({ id: 's1' }, say(1, '这段不能发'))
  h.handler({ id: 's1' }, end(1))
  await new Promise((r) => setImmediate(r))
  assert.equal(h.calls.blockSessionPrivacy.length, 1)
  assert.equal(h.calls.deliver.length, 1)
  assert.equal(h.calls.deliver[0].text, '[沉默]', '原文不能落到 QQ')
})

test('这一轮没正常结束：不发，但要释放', async () => {
  const h = harness()
  arm(h)
  h.handler({ id: 's1' }, start(1))
  h.handler({ id: 's1' }, say(1, '写到一半断了'))
  h.handler({ id: 's1' }, end(1, 'error'))
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(h.calls.deliver, [])
  assert.equal(h.calls.release.length, 1)
  assert.ok(h.calls.warn.some((m) => m.includes('没正常结束')))
})

test('工具调用后的那次模型调用，用量记到工具所属模块名下', () => {
  const h = harness()
  arm(h)
  h.handler({ id: 's1' }, start(1))
  h.handler({ id: 's1' }, { type: 'tool/call', data: { name: 'qq_draw_image', turn: 1 } })
  h.handler({ id: 's1' }, say(1, '画好了', { usage: { inputTokens: 10, outputTokens: 5 } }))
  assert.equal(h.calls.recordUsage.length, 1)
  assert.equal(h.calls.recordUsage[0].module, 'imagegen', '生图的消耗不能算成聊天')
  assert.equal(h.calls.recordUsage[0].chat, 'private:1')
  assert.equal(h.calls.recordUsage[0].provider, 'deepseek-official')
})

test('system: 会话的轮次交给等待方，不发到 QQ', async () => {
  const h = harness()
  h.sessionToChat.set('s2', 'system:jobs')
  let resolved = ''
  const st = { lastTurn: -1, text: '', senders: new Set(), runToken: 'tk', system: { resolve: (t) => { resolved = t }, reject() {} } }
  h.turnState.set('s2', st)
  h.handler({ id: 's2' }, say(1, '后台结果'))
  h.handler({ id: 's2' }, end(1))
  await new Promise((r) => setImmediate(r))
  assert.equal(resolved, '后台结果')
  assert.deepEqual(h.calls.deliver, [])
})

test('只有一个聊天在等调试对话时，正文交给它', async () => {
  const h = harness()
  let got = ''
  h.debugWaiters.set('private:1', (text) => { got = text })
  arm(h)
  h.handler({ id: 's1' }, start(1))
  h.handler({ id: 's1' }, say(1, '调试回复'))
  h.handler({ id: 's1' }, end(1))
  await new Promise((r) => setImmediate(r))
  assert.equal(got, '调试回复')
})

// ---------- 记账规则本身（src/chat/usage-accounting.js） ----------

test('记账：四类 token 求和，系统会话累到 st.system.tokens', async () => {
  const { createUsageAccounting } = await import('../src/chat/usage-accounting.js')
  const rows = []
  const account = createUsageAccounting({ recordUsage: (r) => rows.push(r), moduleLabel: () => 'chat', moduleOfTool: () => '' })
  const st = { system: { tokens: 100 }, deliveryReceipt: () => {}, deliveryTokens: 0, lastTool: null }
  const used = account({ st, chatId: 'system:jobs', target: { provider: 'p', model: 'm' }, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1 }, turn: 1, time: 7 })
  assert.equal(used, 18)
  assert.equal(st.system.tokens, 118)
  assert.equal(st.deliveryTokens, 18)
  assert.equal(rows[0].chat, 'system:jobs')
})

test('记账：紧跟 tool/call 的那次算到工具模块，工具名用过就清掉', async () => {
  const { createUsageAccounting } = await import('../src/chat/usage-accounting.js')
  const rows = []
  const account = createUsageAccounting({
    recordUsage: (r) => rows.push(r),
    moduleLabel: () => 'chat',
    moduleOfTool: (name) => (name === 'qq_draw_image' ? 'imagegen' : ''),
  })
  const st = { lastTool: { name: 'qq_draw_image', turn: 3 } }
  account({ st, chatId: 'private:1', target: {}, usage: { inputTokens: 1 }, turn: 3, time: 1 })
  assert.equal(rows[0].module, 'imagegen')
  assert.equal(st.lastTool, null, '用过一次就要清掉，否则后面每一步都会算到工具名下')
  account({ st, chatId: 'private:1', target: {}, usage: { inputTokens: 1 }, turn: 3, time: 2 })
  assert.equal(rows[1].module, 'chat')
})

test('记账：recordUsage 抛错不能把这一轮带下水', async () => {
  const { createUsageAccounting } = await import('../src/chat/usage-accounting.js')
  const account = createUsageAccounting({
    recordUsage: () => { throw new Error('写盘失败') },
    moduleLabel: () => 'chat',
    moduleOfTool: () => '',
  })
  assert.doesNotThrow(() => account({ st: {}, chatId: 'private:1', target: {}, usage: { inputTokens: 1 }, turn: 1, time: 1 }))
})
