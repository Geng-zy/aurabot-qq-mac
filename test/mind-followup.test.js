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
const ctx = async (a, userId) => {
  const w = await a.mind.memory.workingMemory({ cue: '在吗', window: 'qq:private:' + userId, people: ['qq:' + userId] })
  // 只看「惦记着别人的事」那一段（这件事本身也会作为普通记忆被想起来，那是对的）
  const i = w.text.indexOf('【你惦记着别人的事')
  return { text: i < 0 ? '' : w.text.slice(i) }
}

test('记成惦记的事：结果出来的时间到了才问，问过往后推，问够了就放下', async () => {
  const { a, m, set } = setup(pendingAnswer('qq:1', '2026-11-11 18:00'))
  m.perceive({ window: 'qq:private:1', who: 'qq:1', text: '我明天下午面试', msgId: 'a', at: T0 })
  await m.memory.encodeWindow('qq:private:1', { force: true })
  const [f] = m.memory.followups()
  assert.equal(f.gist, '明天下午面试')
  assert.equal(f.about, 'qq:1')
  assert.doesNotMatch((await ctx(a, 1)).text, /惦记着别人的事/, '还没到结果出来的时候')
  set(Date.UTC(2026, 10, 11, 11)) // 11-11 19:00
  const first = (await ctx(a, 1)).text
  assert.match(first, /^【你惦记着别人的事，还不知道结果】[\s\S]*明天下午面试/)
  assert.match(first, /mind_followup_done/)
  assert.doesNotMatch((await ctx(a, 1)).text, /明天下午面试/, '刚问过，往后推')
  // 主人：在乎程度高，最多问 3 次左右；隔几天再问
  let asked = 1
  for (let d = 1; d <= 20; d++) {
    set(Date.UTC(2026, 10, 11, 11) + d * DAY)
    if (/明天下午面试/.test((await ctx(a, 1)).text)) asked++
  }
  assert.ok(asked >= 2 && asked <= 3, `问了 ${asked} 次`)
  assert.equal(m.memory.followups()[0].asks, asked)
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
