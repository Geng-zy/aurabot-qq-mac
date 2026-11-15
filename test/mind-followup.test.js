// 惦记别人的事（第 17 项）：别人说的还没结果的事记成 pending；到时候和他聊天时提醒她问一句，问过往后推，
// 问够了 / 有结果了 / 说别问了就放下；越在乎的人问得越多。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMindAdapter } from '../src/mind-adapter/index.js'

const T0 = Date.UTC(2026, 10, 10, 4) // 上海 11-10 12:00
const DAY = 86400000
function setup(answer) {
  let t = T0
  const a = createMindAdapter({ memoryDb: true, getConfig: () => ({ ownerQQ: '1' }), now: () => t, random: () => 0.5, ask: async () => answer })
  a.mind.updateSettings({ 'identity.age': 18, 'identity.timezone': 'Asia/Shanghai' })
  return { a, m: a.mind, set: (v) => { t = v } }
}
const pendingAnswer = (who, due) => JSON.stringify({ episodes: [{ type: 'pending', gist: '明天下午面试', importance: 0.7, who: [who], about: who, speaker: who, due, sources: [1] }] })
const ctx = async (a, userId, cue = '那个面试呢') => {
  const w = await a.mind.memory.workingMemory({ cue, window: 'qq:private:' + userId, people: ['qq:' + userId] })
  // 只看「惦记着别人的事」那一段（这件事本身也会作为普通记忆被想起来，那是对的）
  const i = w.text.indexOf('【你惦记着别人的事')
  return { text: i < 0 ? '' : w.text.slice(i) }
}

test('记成惦记的事：结果出来的时间到了才问，问过往后推，问够了就放下', async () => {
  const { a, m, set } = setup(pendingAnswer('qq:1', '2026-11-11 18:00'))
  m.perceive({ window: 'qq:private:1', who: 'qq:1', text: '我明天下午面试', msgId: 'a', at: T0 })
  await m.memory.encodeWindow('qq:private:1', { force: true })
  const [f] = m.memory.followups()
  assert.equal(f.gist, '2026-11-11下午面试')
  assert.equal(f.about, 'qq:1')
  assert.doesNotMatch((await ctx(a, 1)).text, /惦记着别人的事/, '还没到结果出来的时候')
  set(Date.UTC(2026, 10, 11, 11)) // 11-11 19:00
  assert.equal((await ctx(a, 1, '刚醒')).text, '')
  assert.equal(m.memory.followups()[0].asks, 0)
  const first = (await ctx(a, 1)).text
  assert.match(first, /^【你惦记着别人的事，还不知道结果】[\s\S]*2026-11-11下午面试/)
  assert.match(first, /mind_followup_done/)
  assert.equal(m.memory.followups()[0].asks, 0, '只有提示时不消耗次数')
  assert.match((await ctx(a, 1)).text, /面试/)
  const window = 'qq:private:1'
  const incoming = (msgId) => m.perceive({ window, who: 'qq:1', text: '说说那个面试', msgId })
  incoming('received')
  m.said({ window, text: '记得你提过下午面试。现在有空吗？', msgId: 'unrelated' })
  assert.equal(m.memory.followups()[0].asks, 0, '相关陈述后面的无关问题不算')
  m.said({ window, text: '你面试有结果了吗？', msgId: 'asked-0' })
  m.said({ window, text: '那场面试有消息了吗？', msgId: 'asked-0b' })
  assert.equal(m.memory.followups()[0].asks, 1, '同一轮的重述只算一次')
  assert.doesNotMatch((await ctx(a, 1)).text, /面试/, '刚问过，往后推')
  // 主人：在乎程度高，最多问 3 次左右；隔几天再问
  let asked = 1
  for (let d = 1; d <= 20; d++) {
    set(Date.UTC(2026, 10, 11, 11) + d * DAY)
    if (/面试/.test((await ctx(a, 1)).text)) {
      incoming('received-' + d)
      m.said({ window, text: '你面试有结果了吗？', msgId: 'asked-' + d })
      asked++
    }
  }
  assert.ok(asked >= 2 && asked <= 3, `问了 ${asked} 次`)
  assert.equal(m.memory.followups({ all: true })[0].asks, asked)
  assert.equal(m.memory.followups().length, 0)
})

test('有结果了 / 说别问了：她用工具放下；主人在面板里也能取消', async () => {
  const { a, m, set } = setup(pendingAnswer('qq:1', null))
  m.perceive({ window: 'qq:private:1', who: 'qq:1', text: '我明天下午面试', msgId: 'a', at: T0 })
  await m.memory.encodeWindow('qq:private:1', { force: true })
  const tool = a.tools({ chat: { chatId: 'private:1', kind: 'private', userId: '1' }, ownerTurn: true }).find((t) => t.name === 'mind_followup_done')
  assert.equal((await tool.execute({ what: '面试' })).ok, true)
  set(T0 + 3 * DAY)
  assert.doesNotMatch((await ctx(a, 1)).text, /面试/)
  assert.equal(m.memory.followups().length, 0)
  assert.equal(m.memory.followups({ all: true })[0].done > 0, true)
})

test('不熟的人（她又不是特别心疼人）：不惦记；只有本人说自己的事才算', async () => {
  const { a, m, set } = setup(pendingAnswer('qq:9', null))
  m.perceive({ window: 'qq:group:5', who: 'qq:9', text: '我明天面试', msgId: 'a', at: T0 })
  await m.memory.encodeWindow('qq:group:5', { force: true })
  set(T0 + 3 * DAY)
  const w = await m.memory.workingMemory({ cue: '在吗', window: 'qq:group:5', people: ['qq:9'] })
  assert.doesNotMatch(w.text, /惦记着别人的事/, '陌生人的事不追问')
  const hearsay = setup(JSON.stringify({ episodes: [{ type: 'pending', gist: '小红明天面试', who: ['qq:3'], about: 'qq:3', speaker: 'qq:2', sources: [1] }] }))
  hearsay.m.perceive({ window: 'qq:group:5', who: 'qq:2', text: '小红明天面试', msgId: 'b', at: T0 })
  await hearsay.m.memory.encodeWindow('qq:group:5', { force: true })
  assert.equal(hearsay.m.memory.followups().length, 0)
  assert.equal(hearsay.m.memory.list({ limit: 5 })[0].kind, 'hearsay')
})

test('既有待跟进摘要按原话日期解读，跨会话核对只展示允许查看的依据', async (t) => {
  const { a, m, set } = setup('{}')
  t.after(() => a.close())
  const group = 'qq:group:5'
  m.perceive({ window: group, who: 'qq:1', text: '今天刚取消订阅，这应该会退回来吧', msgId: 'refund', at: T0 })
  const source = m._store.prep('SELECT id FROM perception WHERE window = ?').get(group).id
  const id = m.memory.insert({ at: T0, window: group, gist: '主人今天刚取消订阅，问能不能退款',
    kind: 'pending', about: 'qq:1', speaker: 'qq:1', sources: [source], extra: { followup: { asks: 0, nextAt: T0 + DAY } } })
  set(T0 + 2 * DAY)
  const window = 'qq:private:1'
  const chat = { chatId: 'private:1', kind: 'private', userId: '1' }
  const reply = (cue) => m.memory.workingMemory({ cue, window, people: ['qq:1'] })
  assert.doesNotMatch((await reply('刚醒')).text, /退款|订阅/)
  assert.equal(m.memory.followups()[0].asks, 0)
  const sameTopic = await reply('昨晚？退款？？')
  assert.match(sameTopic.text, /2026-11-10刚取消订阅/)
  assert.match(sameTopic.text, /结果待确认/)
  assert.doesNotMatch(sameTopic.text.split('【待跟进事项原话')[0], /今天刚取消/)
  assert.match(sameTopic.text, /【待跟进事项原话[^\n]+\n- 2026-11-10 12:00 [^\n]+：今天刚取消订阅/)
  const tool = a.tools({ chat, ownerTurn: true }).find(({ name }) => name === 'mind_recall_more')
  const result = await tool.execute({ id })
  assert.match(result.message, /记录于 2026-11-10/)
  assert.match(result.message, /2026-11-10 12:00 [^\n]*：今天刚取消订阅，这应该会退回来吧/)
  m.memory.setPrivateOnly(id, true)
  assert.equal(m.memory.recallMore(id, { audienceWindow: 'qq:private:2' }), null)
})

test('模型只引用她自己的旧回复时，不会建立对方的待跟进事项', async (t) => {
  const { a, m } = setup(pendingAnswer('qq:1', null))
  t.after(() => a.close())
  const window = 'qq:private:1'
  m.said({ window, text: '你明天下午面试？', at: T0, msgId: 'a' })
  await m.memory.encodeWindow(window, { force: true })
  assert.equal(m.memory.followups().length, 0)
})
