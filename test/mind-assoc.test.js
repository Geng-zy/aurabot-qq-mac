// 内部联想可以跨聊天。对话只使用当前会话可见的经历。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMindAdapter } from '../src/mind-adapter/index.js'

const T0 = Date.UTC(2026, 10, 10, 4)
function setup(settings = {}) {
  const a = createMindAdapter({ memoryDb: true, getConfig: () => ({ ownerQQ: '1' }), now: () => T0, random: () => 0.5, ask: async () => '{"episodes":[]}' })
  a.mind.updateSettings({ 'identity.age': 18, ...settings })
  const m = a.mind
  const ins = (gist, window, extra = {}) => m.memory.insert({ at: T0 - 3600000, window, gist, kind: 'event', importance: 0.8, ...extra })
  const A = ins('一起去海边看了日出', 'qq:group:5')
  const B = ins('主人说海边那天他其实很累', 'qq:private:1')
  const C = ins('小红悄悄说她也想去海边', 'qq:private:3', { extra: { secret: true } })
  const D = ins('今天吃了火锅', 'qq:group:5')
  const link = m._store.prep('INSERT INTO links (a, b, kind, weight) VALUES (?, ?, ?, ?)')
  link.run(A, B, 'followup', 0.9)
  link.run(B, C, 'similar', 0.85)
  return { m, A, B, C, D }
}
const recallA = (m, window = 'qq:group:5') => m.memory.recall({ cue: '海边看了日出', window, limit: 1, deliberate: true })

test('从一件事想到下一件、再下一件，越远越淡（两步外只记得大概）', async () => {
  const { m, A, B, C } = setup()
  const got = await recallA(m)
  assert.equal(got[0].id, A)
  const b = got.find((x) => x.id === B)
  const c = got.find((x) => x.id === C)
  assert.ok(b && b.associated && b.hop === 1)
  assert.ok(c && c.associated && c.hop === 2)
  assert.equal(c.level, 'vague')
})

test('对话的联想跳过受保护的来源，内部联想保留', async () => {
  const { m } = setup()
  const w = await m.memory.workingMemory({ cue: '海边看了日出', window: 'qq:group:5', people: [] })
  assert.match(w.text, /看了日出/)
  assert.doesNotMatch(w.text, /其实很累|想去海边/)
})

test('回顾和提炼结果继承来源范围，其他人的私聊可以跨会话', async (t) => {
  const a = createMindAdapter({ memoryDb: true, getConfig: () => ({ ownerQQ: '1' }), now: () => T0 })
  t.after(() => a.close())
  const mem = a.mind.memory
  const dm = 'qq:private:1'
  const insert = (fields) => mem.insert({ at: T0, importance: 0.8, ...fields })
  const source = insert({ window: dm, gist: '山路的约定', kind: 'event' })
  const summary = insert({ gist: '回顾：山路的约定', kind: 'day-summary', extra: { from: [source] } })
  insert({ gist: '提炼：山路的约定', kind: 'semantic', extra: { derivedFrom: [summary] } })
  const other = insert({ window: 'qq:private:2', gist: '小红提过山路上的观景台', kind: 'event' })
  const otherSummary = insert({ gist: '回顾：山路上的观景台', kind: 'day-summary', extra: { from: [other] } })
  insert({ gist: '提炼：山路上的观景台', kind: 'semantic', extra: { derivedFrom: [otherSummary] } })
  insert({ window: 'qq:group:5', gist: '群里在聊山路', kind: 'event' })
  const recall = (chat) => a.tools({ chat }).find((tool) => tool.name === 'mind_recall').execute({ query: '山路' })
  const group = await recall({ chatId: 'group:5', kind: 'group', groupId: '5' })
  assert.match(group.message, /群里在聊山路/)
  assert.match(group.message, /回顾：山路上的观景台/)
  assert.match(group.message, /提炼：山路上的观景台/)
  assert.doesNotMatch(group.message, /山路的约定/)
  const same = await recall({ chatId: 'private:1', kind: 'private', userId: '1' })
  assert.match(same.message, /回顾：山路的约定/)
})

test('能关、能限条数、能限步数；按日期查的时候不联想', async () => {
  assert.equal((await recallA(setup({ 'memory.assoc': false }).m)).length, 1)
  assert.equal((await recallA(setup({ 'memory.assocLimit': 1 }).m)).length, 2)
  const oneHop = await recallA(setup({ 'memory.assocHops': 1 }).m)
  assert.ok(oneHop.every((x) => (x.hop || 0) <= 1))
  const { m } = setup()
  const got = await m.memory.recall({ cue: '海边看了日出', limit: 1, deliberate: true, period: { start: T0 - 86400000, end: T0 + 1 } })
  assert.equal(got.filter((x) => x.associated).length, 0)
})
