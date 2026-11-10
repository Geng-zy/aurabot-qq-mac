// 要告诉主人的事由她自己说：会话空着推进会话；会话正忙（比如就卡在等授权）单独问一次；都不成才用固定文字。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHerVoice } from '../src/features/her-voice.js'
import { createApprovalRelay } from '../src/security/approval.js'

function setup({ busy = false, replies = [], throwAsk = false } = {}) {
  const notes = [], asks = [], sent = []
  const voice = createHerVoice({
    ownerChatId: () => 'private:8',
    busy: () => busy,
    pushNote: async (note) => { notes.push(note) },
    ask: async (o) => { asks.push(o); if (throwAsk) throw new Error('模型挂了'); return replies.shift() ?? '' },
    persona: () => '你是小鱼，说话软软的。',
    context: () => '【此刻】晚上十点，有点困。',
    send: async (chatId, text) => { sent.push({ chatId, text }) },
    log: { info() {}, warn() {} },
  })
  return { voice, notes, asks, sent }
}

test('私聊会话空着：事情推进会话，由她带着上下文自己说', async () => {
  const s = setup()
  assert.equal(await s.voice.tell({ facts: 'pwsh 卡住了', must: ['确认'] }), 'session')
  assert.equal(s.notes.length, 1)
  assert.match(s.notes[0], /^【你看到的事，不是主人说的话】pwsh 卡住了/)
  assert.match(s.notes[0], /用你自己的口气/)
  assert.match(s.notes[0], /「确认」/)
  assert.equal(s.sent.length, 0, '会话里她自己会说，这里不另发')
})

test('私聊会话正忙：用她的人格和此刻的状态单独问一次，发出去的是她的话', async () => {
  const s = setup({ busy: true, replies: ['诶 我这边要用 pwsh，你回个确认我就接着弄，不想就回取消~'] })
  assert.equal(await s.voice.tell({ facts: '要用 pwsh', must: ['确认', '取消'], fallback: '【要授权】pwsh' }), 'direct')
  assert.equal(s.notes.length, 0)
  assert.match(s.asks[0].system, /你是小鱼/)
  assert.match(s.asks[0].system, /有点困/)
  assert.match(s.asks[0].system, /「确认」、「取消」/)
  assert.equal(s.asks[0].text, '要用 pwsh')
  assert.deepEqual(s.sent, [{ chatId: 'private:8', text: '诶 我这边要用 pwsh，你回个确认我就接着弄，不想就回取消~' }])
})

test('她的话没带上要回的字：再问一次；还不行才用固定文字', async () => {
  const again = setup({ busy: true, replies: ['帮我批一下嘛', '回确认就行，不要就回取消'] })
  assert.equal(await again.voice.tell({ facts: 'x', must: ['确认', '取消'], fallback: '模板' }), 'direct')
  assert.equal(again.asks.length, 2)
  assert.equal(again.sent[0].text, '回确认就行，不要就回取消')

  const give = setup({ busy: true, replies: ['帮我批一下嘛', '快批'] })
  assert.equal(await give.voice.tell({ facts: 'x', must: ['确认'], fallback: '模板' }), 'fallback')
  assert.deepEqual(give.sent.map((m) => m.text), ['模板'])

  const broken = setup({ busy: true, throwAsk: true })
  assert.equal(await broken.voice.tell({ facts: 'x', fallback: '模板' }), 'fallback')
  assert.equal(broken.asks.length, 1, '模型出错不重试')
})

test('direct：不进会话；[沉默] 和 voice 标签不会原样发出去', async () => {
  const s = setup({ replies: ['<voice>好啦好啦</voice>[沉默]'] })
  assert.equal(await s.voice.tell({ facts: 'x', via: 'direct' }), 'direct')
  assert.equal(s.notes.length, 0)
  assert.equal(s.sent[0].text, '好啦好啦')
})

test('QQ 里批准：问、批准、超时都由她说；她的问话里一定有「确认」「取消」', async () => {
  const spoken = []
  let req
  const relay = createApprovalRelay({
    getConfig: () => ({ enabled: true, dryRun: false, approvalViaQQ: true, ownerQQ: '8' }),
    deliver: async () => { throw new Error('不该直接发模板') },
    speak: async (o) => { spoken.push(o) },
    chatOfSession: () => 'private:8',
    timeoutMs: 60_000,
  })
  const pending = relay.onRequest({ toolName: 'bash', reason: '要装依赖', agent: { session: { id: 's' } } }, () => new Promise((r) => { req = r }))
  await new Promise(setImmediate)
  assert.equal(spoken.length, 1)
  assert.deepEqual(spoken[0].must, ['确认', '取消'])
  assert.match(spoken[0].facts, /bash/)
  assert.match(spoken[0].facts, /要装依赖/)
  assert.match(spoken[0].fallback, /【要授权】bash/)
  assert.equal(relay.handleReply('private:8', '8', '确认'), true)
  assert.equal(await pending, 'allowed-once')
  await new Promise(setImmediate)
  assert.match(spoken[1].facts, /批准了这一次「bash」/)
  req('unavailable')
  relay.dispose()
})

test('在别的聊天里说（比如群里点的歌没唱成）：推进那个聊天的会话；单独问时用 clean 洗掉念了内部信息的话', async () => {
  const pushed = []
  const sent = []
  const mk = (busy, reply) => createHerVoice({
    ownerChatId: () => 'private:8',
    busy: () => busy,
    pushNote: async (note, chatId) => { pushed.push({ note, chatId }) },
    ask: async () => reply,
    persona: () => '人格',
    context: (chatId) => `在 ${chatId}`,
    send: async (chatId, text) => { sent.push({ chatId, text }) },
    log: { info() {}, warn() {} },
  })
  assert.equal(await mk(false, '').tell({ chatId: 'group:5', facts: '没唱成' }), 'session')
  assert.equal(pushed[0].chatId, 'group:5')
  assert.match(pushed[0].note, /告诉群里/)
  const leak = (t) => (/ENOENT/.test(t) ? '' : t)
  assert.equal(await mk(true, '报错 ENOENT').tell({ chatId: 'group:5', facts: 'x', clean: leak, fallback: '回头再试' }), 'fallback')
  assert.deepEqual(sent.at(-1), { chatId: 'group:5', text: '回头再试' })
})
