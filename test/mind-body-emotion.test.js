// 第三阶段：身体（精力、困、饿、睡眠、倒时差）和情绪（持续时间、对象、专一和年龄、调节、心情、迁怒），
// 以及对接层：<feel> 标记、谁叫得醒她、投喂、醒来补回消息。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMind } from '../src/mind/index.js'
import { createMindAdapter } from '../src/mind-adapter/index.js'
import { ANCHOR_HOURS, EMOTIONS, emotionOf, baseHours } from '../src/mind/emotion/catalog.js'

const H = 3600000
const T0 = Date.UTC(2026, 10, 10, 0, 0) // 上海 08:00

function mind({ at = T0, random = () => 0.99, settings = {} } = {}) {
  let t = at
  const m = createMind({ memoryDb: true, now: () => t, ownerId: 'qq:1', random })
  m.updateSettings({ 'identity.age': 18, ...settings })
  return { m, set: (v) => { t = v }, get: () => t }
}

// ---------- 情绪清单 ----------

test('情绪清单：持续时间来自原文 27 种情绪；清单里每种都有依据；近义说法认得出', () => {
  assert.equal(Object.keys(ANCHOR_HOURS).length, 27)
  assert.equal(ANCHOR_HOURS.sadness, 120)
  assert.equal(ANCHOR_HOURS.shame, 0.5)
  for (const e of EMOTIONS) assert.ok(ANCHOR_HOURS[e.anchor] > 0, e.name + ' 没有持续时间依据')
  assert.equal(emotionOf('开心').name, '快乐')
  assert.equal(emotionOf('吃醋').name, '嫉妒')
  assert.equal(emotionOf('不存在的情绪'), null)
  assert.ok(baseHours('难过') > baseHours('害羞') * 100)
})

// ---------- 情绪 ----------

test('情绪持续多久：难过比害羞久得多；越重要的事越久', () => {
  const { m, set } = mind()
  m.emotion.feel([{ name: '难过', intensity: 0.8, why: 'a' }, { name: '害羞', intensity: 0.8, why: 'b' }])
  set(T0 + 2 * H)
  const names = m.emotion.state().active.map((e) => e.name)
  assert.ok(names.includes('难过'))
  assert.ok(!names.includes('害羞'), '害羞早就过去了')
  const { m: m2, set: set2 } = mind()
  m2.emotion.feel([{ name: '生气', intensity: 0.8, target: 'qq:2', importance: 1 }, { name: '烦躁', intensity: 0.8, importance: 0 }])
  set2(T0 + 2 * H)
  const by = Object.fromEntries(m2.emotion.state().active.map((e) => [e.name, e.intensity]))
  assert.ok((by['生气'] || 0) > (by['烦躁'] || 0), '重要的事气得更久')
})

test('专一：对别人的心动变成喜爱（最多中等），性欲去掉，嫉妒变成羡慕；对主人照常', () => {
  const { m } = mind()
  const got = m.emotion.feel([
    { name: '心动', intensity: 0.9, target: 'qq:2' },
    { name: '性欲', intensity: 0.9, target: 'qq:2' },
    { name: '嫉妒', intensity: 0.6, target: 'qq:3' },
    { name: '心动', intensity: 0.7, target: 'qq:1' },
    { name: '爱慕', intensity: 0.5 },
  ])
  const list = got.map((e) => [e.name, e.target, e.i0])
  assert.deepEqual(list, [['喜爱', 'qq:2', 0.5], ['羡慕', 'qq:3', 0.6], ['心动', 'qq:1', 0.7]])
  m.updateSettings({ 'identity.exclusive': false })
  assert.equal(m.emotion.feel([{ name: '心动', intensity: 0.8, target: 'qq:4' }])[0].name, '心动', '关掉专一后可以喜欢别人')
})

test('年龄：没满 18 或没填，没有性欲', () => {
  const { m } = mind()
  assert.equal(m.emotion.feel([{ name: '性欲', intensity: 0.6, target: 'qq:1' }]).length, 1)
  m.updateSettings({ 'identity.age': 17 })
  assert.equal(m.emotion.feel([{ name: '性欲', intensity: 0.6, target: 'qq:1' }]).length, 0)
  m.updateSettings({ 'identity.age': null })
  assert.equal(m.emotion.feel([{ name: '性欲', intensity: 0.6, target: 'qq:1' }]).length, 0)
})

test('调节：换个角度想真的变弱；忍着的标出来；被带动的按传染强度打折；同一种同一个对象不叠两份', () => {
  const { m } = mind()
  const [r] = m.emotion.feel([{ name: '生气', intensity: 1, target: 'qq:2', reg: 'reappraise' }])
  assert.ok(Math.abs(r.i0 - 0.6) < 1e-9)
  const [s] = m.emotion.feel([{ name: '难过', intensity: 0.5, reg: 'suppress' }])
  assert.equal(s.hidden, true)
  const [c] = m.emotion.feel([{ name: '快乐', intensity: 1, src: 'contagion' }])
  assert.ok(Math.abs(c.i0 - 0.6) < 1e-9, '默认传染强度 0.3 → 打六折')
  m.emotion.feel([{ name: '生气', intensity: 0.3, target: 'qq:2' }])
  assert.equal(m.emotion.state().active.filter((e) => e.name === '生气').length, 1)
})

test('心情：被情绪带着走，有惯性；没事了慢慢回到平时的水位；很饿时差一点', () => {
  const { m, set } = mind({ settings: { 'body.hunger': false } })
  const base = m.emotion.state().mood.v
  m.emotion.feel([{ name: '快乐', intensity: 1, importance: 1 }])
  set(T0 + 0.5 * H)
  const up = m.emotion.state().mood.v
  assert.ok(up > base + 0.1, '开心了')
  set(T0 + 30 * 24 * H)
  assert.ok(Math.abs(m.emotion.state().mood.v - 0.15) < 0.02, '一个月后回到平时的水位')
  const { m: m2 } = mind()
  const hungry = m2.emotion.state({ energy: 0.8, sleepiness: 0.2, hunger: 1 })
  assert.ok(hungry.mood.v <= 0.15, '饿了不会更开心')
})

test('情绪有对象：对别人的气提醒她别撒在眼前的人身上；又气又累时才可能漏一点，越亲近越忍得住', () => {
  const { m } = mind({ random: () => 0 })
  m.emotion.feel([{ name: '生气', intensity: 0.9, target: 'qq:2', why: '群里吵架' }])
  const fresh = m.emotion.describe({ people: ['qq:1'], body: { energy: 0.9, sleepiness: 0.1 }, name: (x) => x })
  assert.match(fresh, /对qq:2很生气（群里吵架）/)
  assert.match(fresh, /不是眼前的人/)
  assert.doesNotMatch(fresh, /压不住/, '精神好时不会迁怒')
  const tiredStranger = m.emotion.describe({ people: ['qq:3'], body: { energy: 0.1, sleepiness: 0.9 }, name: (x) => x })
  assert.match(tiredStranger, /压不住/)
  const { m: m2 } = mind({ random: () => 0.1 })
  m2.emotion.feel([{ name: '生气', intensity: 0.9, target: 'qq:2' }])
  assert.doesNotMatch(m2.emotion.describe({ people: ['qq:1'], body: { energy: 0.1, sleepiness: 0.9 } }), /压不住/, '对主人更忍得住')
})

test('想起带着情绪的事，情绪会重新冒出来一点', async () => {
  const { m } = mind()
  m.memory.connect({ embed: async (xs) => xs.map((t) => { const v = new Array(64).fill(0); for (const ch of t) v[ch.codePointAt(0) % 64]++; return v }) })
  const id = m.memory.insert({ at: T0, gist: '被甲当众嘲笑了', kind: 'event', emotion: { name: '难过', intensity: 0.8, valence: -0.7 }, about: 'qq:2' })
  await m.memory.embedEpisodes([id])
  await m.memory.workingMemory({ cue: '被甲当众嘲笑了' })
  const sad = m.emotion.state().active.find((e) => e.name === '难过')
  assert.ok(sad && sad.intensity > 0.3, '重新难过起来')
  assert.equal(sad.target, 'qq:2')
})

test('感受里的 emoji 不会被切成半个', () => {
  const { m } = mind()
  m.emotion.feel([{ name: '快乐', intensity: 0.5, why: '一'.repeat(79) + '😀😀' }])
  const why = m.emotion.state().active[0].why
  assert.equal(why.isWellFormed(), true)
  assert.equal([...why].length, 80)
})

// ---------- 身体 ----------

test('睡觉：白天不睡；醒着很久又到了夜里就睡；睡够了早上自己醒；刚醒迷糊一会儿', () => {
  const { m, set } = mind()
  assert.deepEqual(m.body.tick().events, [])
  set(T0 + 15.8 * H) // 上海 23:48
  assert.deepEqual(m.body.tick().events.map((e) => e.kind), ['slept'])
  assert.equal(m.body.state().asleep, true)
  set(T0 + 18 * H) // 02:00
  assert.deepEqual(m.body.tick().events, [], '半夜不醒')
  set(T0 + 24 * H) // 08:00
  const [woke] = m.body.tick().events
  assert.equal(woke.kind, 'woke')
  assert.ok(woke.hours > 7.5 && woke.quality >= 0.95)
  assert.equal(m.body.state().groggy, true)
  set(T0 + 24.5 * H)
  assert.equal(m.body.state().groggy, false)
  assert.ok(m.body.state().energy > 0.8, '睡一觉精力回来了')
})

test('和主人聊着就熬着不睡，代价是第二天早上更困', () => {
  const { m, set } = mind({ settings: { 'body.hunger': false } })
  set(T0 + 15.8 * H)
  m.body.noteOwner()
  assert.deepEqual(m.body.tick().events, [], '刚和主人聊过，熬着')
  set(T0 + 18 * H) // 02:00
  assert.deepEqual(m.body.tick().events.map((e) => e.kind), ['slept'])
  set(T0 + 24 * H)
  m.body.tick()
  const late = m.body.state()
  const { m: m2, set: set2 } = mind({ settings: { 'body.hunger': false } })
  set2(T0 + 15.8 * H); m2.body.tick(); set2(T0 + 24 * H); m2.body.tick()
  assert.ok(late.asleep || late.sleepiness > m2.body.state().sleepiness, '熬夜的那个早上更困（或者还没醒）')
})

test('精力：做事花，醒着歇着慢慢回来', () => {
  const { m, set } = mind()
  const e0 = m.body.state().energy
  m.body.spend(0.3)
  assert.ok(Math.abs(m.body.state().energy - (e0 - 0.3)) < 1e-6)
  set(T0 + 2 * H)
  assert.ok(m.body.state().energy > e0 - 0.3 + 0.1)
})

test('饿：饭点前后饿了自己吃；只靠主人投喂时不吃；关掉就不会饿', () => {
  const { m, set } = mind()
  set(T0 + 3.9 * H) // 11:54，离上次 0.2 饱已经过了快 4 小时
  const ev = m.body.tick().events
  assert.deepEqual(ev.map((e) => e.kind), ['ate'])
  assert.ok(m.body.state().hunger < 0.2)
  const { m: m2, set: set2 } = mind({ settings: { 'body.feedOnlyByOwner': true } })
  set2(T0 + 3.9 * H)
  assert.deepEqual(m2.body.tick().events, [])
  assert.ok(m2.body.state().hunger > 0.7, '饿着等你喂')
  m2.body.feed('奶茶', 'qq:1')
  assert.ok(m2.body.state().hunger < 0.1)
  const { m: m3, set: set3 } = mind({ settings: { 'body.hunger': false } })
  set3(T0 + 10 * H)
  assert.equal(m3.body.state().hunger, 0)
})

test('倒时差：改了时区生物钟慢慢跟上，大约一天一个小时；关掉就立刻切换', () => {
  const { m, set } = mind()
  m.body.state()
  m.updateSettings({ 'identity.timezone': 'Asia/Tokyo' }) // 往东一个小时
  assert.equal(m.body.state().shift, 1)
  set(T0 + 12 * H)
  assert.ok(Math.abs(m.body.state().shift - 0.5) < 0.05)
  set(T0 + 30 * H)
  assert.equal(m.body.state().shift, 0)
  const { m: m2 } = mind({ settings: { 'body.jetLag': false } })
  m2.body.state()
  m2.updateSettings({ 'identity.timezone': 'Asia/Tokyo' })
  assert.equal(m2.body.state().shift, 0)
})

// ---------- 对接层 ----------

function adapter({ at = T0, random = () => 0.99 } = {}) {
  let t = at
  const replays = []
  const a = createMindAdapter({ memoryDb: true, getConfig: () => ({ ownerQQ: '1' }), now: () => t, random, onWakeReplay: async (list) => { replays.push(...list) } })
  a.mind.updateSettings({ 'identity.age': 18 })
  return { a, set: (v) => { t = v }, replays }
}

test('<feel>：发出去之前收走，情绪记下，对象按 QQ 号；坏的 JSON 不影响回复', () => {
  const { a } = adapter()
  const text = a.feel('private:1', '好呀<feel>{"e":[{"n":"开心","i":0.6,"who":"1","why":"被夸了"},{"n":"生气","i":0.4,"who":"qq:22","why":"刚才群里"}]}</feel>', { senders: ['1'] })
  assert.equal(text, '好呀')
  const act = a.mind.emotion.state().active
  assert.deepEqual(act.map((e) => [e.name, e.target]).sort(), [['快乐', 'qq:1'], ['生气', 'qq:22']])
  assert.equal(a.feel('private:1', '嗯<feel>{坏的</feel>', {}), '嗯')
  assert.equal(a.feel('private:1', '嗯<feel>{"e":[', {}), '嗯', '没闭合的也收走')
})

test('投喂：只认这一轮真的在跟她说话的人；/投喂 后她又说一遍不算两次；记成经历、对人感激', () => {
  const { a } = adapter()
  a.feel('group:9', '谢谢<feel>{"e":[],"fed":{"food":"奶茶","by":"2"}}</feel>', { senders: ['3'] })
  assert.equal(a.mind.body.state().lastMeal, null, '2 不在这一轮里，不算')
  a.feel('private:5', '谢啦<feel>{"fed":{"food":"蛋糕"}}</feel>', { senders: ['5'] })
  assert.equal(a.mind.body.state().lastMeal.food, '蛋糕')
  assert.equal(a.mind.body.state().lastMeal.by, 'qq:5')
  const r1 = a.feed('奶茶', '1', 'private:1')
  const r2 = a.feed('奶茶', '1', 'private:1')
  assert.equal(r1.duplicate, undefined)
  assert.equal(r2.duplicate, true)
  assert.ok(a.mind.memory.list().some((m) => m.gist === '主人给我吃了奶茶'))
  assert.ok(a.mind.emotion.state().active.some((e) => e.name === '感激' && e.target === 'qq:1'))
  assert.equal(a.mind.person('qq:5'), null, '没见过的人不硬建档案')
})

test('睡着时：主人叫才醒（按人不按地方）；别人的消息等她醒了按轻重补回', async () => {
  const { a, replays } = adapter()
  a.mind.body.sleepNow()
  const ev = (id) => ({ id })
  assert.deepEqual(a.gate({ chatId: 'group:9', kind: 'group', userId: '2', direct: true, event: ev('g2') }), { reply: false, reason: '她睡着了' })
  assert.equal(a.gate({ chatId: 'group:9', kind: 'group', userId: '1', direct: false, event: ev('g1') }).reply, false, '主人在群里没叫她，不会被吵醒')
  assert.equal(a.gate({ chatId: 'private:3', kind: 'private', userId: '3', direct: true, event: ev('p3') }).reply, false)
  const g = a.gate({ chatId: 'group:9', kind: 'group', userId: '1', direct: true, event: ev('g1b') })
  assert.deepEqual(g, { reply: true, woke: true, reason: '被叫醒了' })
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(replays.map((x) => x.chatId), ['private:3'], '叫醒她的那个群不用补；私聊先于群')
  assert.equal(a.mind.body.state().groggy, true)
})

test('醒着但累坏了：不插话；不熟的人找她可能懒得理；主人一定回', () => {
  const { a } = adapter({ random: () => 0 })
  a.mind.body.spend(1)
  assert.equal(a.gate({ chatId: 'group:9', kind: 'group', userId: '2', direct: false }).reply, false)
  assert.equal(a.gate({ chatId: 'group:9', kind: 'group', userId: '2', direct: true }).reply, false)
  assert.equal(a.gate({ chatId: 'private:1', kind: 'private', userId: '1', direct: true }).reply, true)
})

test('上下文里有身体和心情；规矩里教她写 <feel>', async () => {
  const { a } = adapter()
  a.mind.emotion.feel([{ name: '生气', intensity: 0.8, target: 'qq:2', why: '被抢话' }])
  const chat = { chatId: 'private:1', kind: 'private', userId: '1' }
  await a.beforeTurn(chat, '在吗', ['1'])
  const ctx = a.contextFor({ chat })
  assert.match(ctx, /【身体】精力/)
  assert.match(ctx, /【心情】/)
  assert.match(ctx, /对2很生气（被抢话）/)
  assert.match(ctx, /不是眼前的人/)
  assert.ok(a.rules().some((r) => r.includes('<feel>')))
  assert.ok(a.rules().every((r) => !/大肥鱼|鲸/.test(r)), '规矩是通用的')
})

test('一轮聊完花精力；和主人聊着会熬夜', () => {
  const { a } = adapter()
  a.mind.updateSettings({ 'body.energyPerTurn': 0.05 })
  const e0 = a.mind.body.state().energy
  a.noteTurn('group:9', ['2'])
  assert.ok(Math.abs(a.mind.body.state().energy - (e0 - 0.05)) < 1e-6)
  a.noteTurn('private:1', ['1'])
  assert.ok(a.mind._store.get('body').ownerAt > 0)
})
