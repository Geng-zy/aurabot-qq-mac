// 新加的：记得跟谁说过什么、每年的日子、到点的约定、新旧说法打架时更新、每天每周每月的回顾。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMind } from '../src/mind/index.js'
import { createMindAdapter } from '../src/mind-adapter/index.js'

const D = 86400000
const T0 = Date.UTC(2026, 10, 10, 4) // 北京时间 11-10 12:00
function mk() {
  let t = T0
  const m = createMind({ dir: '/nonexistent', memoryDb: true, now: () => t, random: () => 0.99, ownerId: 'qq:1' })
  return { m, mem: m.memory, set: (v) => { t = v }, add: (ms) => { t += ms } }
}

test('跟谁说过什么：想起来的事说出口了，下次在同一个人面前会提醒「说过了」', async () => {
  const { m, mem } = mk()
  m.perceive({ window: 'qq:private:2', who: 'qq:2', name: '小明', text: '最近有啥好玩的', msgId: 'a', at: T0 - 60000 })
  mem.insert({ at: T0 - 5 * D, window: 'qq:group:9', gist: '在群里看到有人用烤箱烤出了一只完整的火鸡', kind: 'event', importance: 0.6 })
  let w = await mem.workingMemory({ cue: '烤箱 火鸡', window: 'qq:private:2', people: ['qq:2'] })
  assert.doesNotMatch(w.text, /说过了/)
  m.said({ window: 'qq:private:2', text: '我前几天看到有人用烤箱烤了一整只火鸡，超夸张', msgId: 'o1' })
  w = await mem.workingMemory({ cue: '烤箱 火鸡', window: 'qq:private:2', people: ['qq:2'] })
  assert.match(w.text, /已经跟小明.*说过了/)
  // 换个人还没说过
  w = await mem.workingMemory({ cue: '烤箱 火鸡', window: 'qq:private:3', people: ['qq:3'] })
  assert.doesNotMatch(w.text, /说过了/)
})

test('说的话和想起的事不沾边，不算说过', async () => {
  const { m, mem } = mk()
  m.perceive({ window: 'qq:private:2', who: 'qq:2', text: '在吗', msgId: 'a', at: T0 - 60000 })
  const id = mem.insert({ at: T0 - 5 * D, window: 'w', gist: '在群里看到有人用烤箱烤出了一只完整的火鸡', kind: 'event' })
  await mem.workingMemory({ cue: '烤箱 火鸡', window: 'qq:private:2', people: ['qq:2'] })
  m.said({ window: 'qq:private:2', text: '在呢，刚睡醒', msgId: 'o1' })
  assert.equal(m.episode(id).data.toldTo, undefined)
})

test('每年的日子：聊天里说到的生日记成 date，到了那天、快到的时候她记得', async () => {
  const { m, mem, set } = mk()
  m.perceive({ window: 'qq:private:1', who: 'qq:1', text: '对了我生日是 11 月 13 号', msgId: 'a', at: T0 - 600e3 })
  mem.connect({ think: async () => JSON.stringify({ episodes: [{ type: 'date', gist: '主人的生日是 11 月 13 日', about: 'qq:1', speaker: 'qq:1', yearly: '11-13', sources: [1] }] }) })
  await mem.encodeWindow('qq:private:1', { force: true })
  assert.equal(mem.specialDays().length, 0)
  assert.match(mem.specialDays({ within: 3 })[0].text, /3 天后：主人的生日/)
  set(T0 + 3 * D)
  const w = await mem.workingMemory({ cue: '在干嘛', window: 'qq:group:9', people: [] })
  assert.match(w.text, /【日子】\n- 今天：主人的生日/)
  // 别人的生日只在他在场时提
  mem.insert({ at: T0, window: 'w', gist: '小明的生日是 11 月 13 日', kind: 'date', about: 'qq:2', extra: { yearly: '11-13' } })
  assert.doesNotMatch((await mem.workingMemory({ cue: 'x', window: 'qq:group:9', people: [] })).text, /小明/)
  assert.match((await mem.workingMemory({ cue: 'x', window: 'qq:group:9', people: ['qq:2'] })).text, /小明的生日/)
})

test('认识满一年：主人和挺熟的人', () => {
  const { m, mem, set } = mk()
  m.notePerson('qq:1', { name: '鱼' })
  m.notePerson('qq:2', { name: '小明' })
  m.notePerson('qq:3', { name: '路人' })
  m.relations.edit('qq:2', { closeness: 0.5 })
  set(T0 + 365 * D)
  const days = mem.specialDays()
  assert.deepEqual(days.map((d) => d.text).sort(), ['今天：和主人认识满 1 年', '今天：和小明认识满 1 年'])
})

test('到点的约定：对接层让她去那个私聊里自己说；睡着也会起来；只提醒一次', async () => {
  let t = T0
  const sent = []
  const a = createMindAdapter({ memoryDb: true, getConfig: () => ({ ownerQQ: '1' }), now: () => t, random: () => 0.99, ask: async () => '{"episodes":[]}', reachOut: async (o) => { sent.push(o) } })
  a.mind.memory.insert({ at: T0, window: 'qq:private:1', gist: '答应明早八点叫主人起床', kind: 'intention', about: 'qq:1', due: T0 + 20 * 3600e3 })
  a.mind.memory.insert({ at: T0, window: 'qq:group:9', gist: '答应群里晚上发攻略', kind: 'intention', due: T0 + 20 * 3600e3 })
  assert.equal(await a.checkPromises(), 0)
  t = T0 + 20 * 3600e3 - 5 * 60000
  a.mind.body.sleepNow()
  assert.equal(await a.checkPromises(), 1)
  assert.equal(sent[0].chatId, 'private:1')
  assert.match(sent[0].note, /答应明早八点叫主人起床/)
  assert.equal(a.mind.body.state().asleep, false, '像闹钟一样起来了')
  assert.equal(await a.checkPromises(), 0, '只提醒一次')
  a.close?.()
})

test('新旧说法打架：睡觉整理时把过时的标上「后来变了」，想起来知道那是以前', async () => {
  const { m, mem } = mk()
  const old = mem.insert({ at: T0 - 40 * D, window: 'qq:private:2', gist: '小明在北京上班', kind: 'fact', about: 'qq:2', speaker: 'qq:2', importance: 0.7 })
  mem.insert({ at: T0 - 3600e3, window: 'qq:private:2', gist: '小明说他下个月搬去上海工作了', kind: 'fact', about: 'qq:2', speaker: 'qq:2', importance: 0.7 })
  let prompt = ''
  mem.connect({ think: async ({ text }) => { prompt = text; return JSON.stringify({ facts: [], outdated: [{ old: 'K1', by: '1', now: '小明搬去上海工作了' }] }) } })
  const r = await m.sleeper.replay(T0 - D)
  assert.match(prompt, /已经知道的事[\s\S]*K1\. .*小明在北京上班/)
  assert.equal(r.outdated, 1)
  assert.equal(m.episode(old).data.outdated.now, '小明搬去上海工作了')
  const got = await mem.recall({ cue: '小明在北京上班', deliberate: true })
  assert.match(got.find((x) => x.id === old).text, /^以前：小明在北京上班.*后来变了：小明搬去上海工作了/)
})

test('过时只能由更新的经历推翻；不能拿旧的推翻新的', async () => {
  const { m, mem } = mk()
  const a = mem.insert({ at: T0 - 40 * D, window: 'w', gist: '小明在北京上班', kind: 'fact', about: 'qq:2' })
  mem.insert({ at: T0 - 3600e3, window: 'w', gist: '小明说他想换工作', kind: 'fact', about: 'qq:2' })
  mem.connect({ think: async () => JSON.stringify({ outdated: [{ old: '1', by: 'K1', now: 'x' }] }) })
  assert.equal((await m.sleeper.replay(T0 - D)).outdated, 0)
  assert.equal(m.episode(a).data.outdated, undefined)
})

test('回顾：睡觉时给前几天各写一段、上周一段、上个月一段；写过的不重写；问「上周」先想起回顾', async () => {
  const { m, mem, set } = mk()
  // 11-02 到 11-09 每天两件事（北京时间中午）
  for (let i = 1; i <= 8; i++) {
    mem.insert({ at: T0 - i * D, window: 'w', gist: `第 ${i} 天前和主人聊了游戏`, kind: 'event', importance: 0.5 })
    mem.insert({ at: T0 - i * D + 3600e3, window: 'w', gist: `第 ${i} 天前吃了面`, kind: 'event', importance: 0.4 })
  }
  const asked = []
  mem.connect({ think: async ({ scene, system }) => { if (scene === 'review') { asked.push(system.match(/回想(这一天|这一周|这个月)/)[1]); return JSON.stringify({ summary: '回顾：' + asked.length }) } return '{}' } })
  const n = await m.sleeper.review()
  assert.equal(n, 4, '前三天各一段 + 上周一段（上个月没有经历）')
  assert.deepEqual(asked, ['这一天', '这一天', '这一天', '这一周'])
  assert.equal(await m.sleeper.review(), 0, '写过的不重写')
  const week = mem.list({ kind: 'week-summary' })[0]
  assert.ok(week)
  const got = await mem.recall({ period: m.memory && (await import('../src/mind/clock.js')).parsePeriod('上周', T0, 'Asia/Shanghai') })
  assert.equal(got[0].kind, 'week-summary')
  set(T0 + 30 * D)
})
