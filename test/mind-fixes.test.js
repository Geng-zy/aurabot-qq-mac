// 心智核心通读后修的问题：中文关键词想起、模型乱回不丢聊天、知道的事不重复、梦不当依据、没时间的约定会淡。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMind } from '../src/mind/index.js'
import { keywords } from '../src/mind/memory/words.js'

const D = 86400000
const T0 = Date.UTC(2026, 10, 10, 4)
function mk() {
  let t = T0
  const m = createMind({ dir: '/nonexistent', memoryDb: true, now: () => t, random: () => 0.99, ownerId: 'qq:1' })
  return { m, mem: m.memory, at: () => t, set: (v) => { t = v }, add: (ms) => { t += ms } }
}

test('关键词：分词，词典里没有的词用连着的单字拼；虚词不算', () => {
  const ws = keywords('你还记得我说要去北京面试吗？上次吃烤串').map((x) => x.w)
  assert.ok(ws.includes('北京') && ws.includes('面试') && ws.includes('烤串'))
  assert.ok(!ws.includes('记得') && !ws.includes('上次'))
})

test('没有向量也能按中文关键词想起来；只有到处都有的词、或记忆里没有的词时不乱想', async () => {
  const { mem } = mk()
  mem.insert({ at: T0 - 3600e3, window: 'w', gist: '主人说下周三要去北京面试', kind: 'event', importance: 0.7 })
  const topics = ['吃烤串', '看了电影', '打游戏到半夜', '下雨没带伞', '买了新键盘']
  for (let i = 0; i < 40; i++) mem.insert({ at: T0 - i * 3600e3, window: 'w', gist: '主人说' + topics[i % 5], kind: 'event' })
  assert.match((await mem.recall({ cue: '你还记得我说要去北京面试吗' }))[0].text, /北京面试/)
  assert.match((await mem.recall({ cue: '新键盘手感如何' }))[0].text, /新键盘/)
  assert.equal((await mem.recall({ cue: '主人你在干嘛' })).length, 0)
  assert.equal((await mem.recall({ cue: '今天天气不错' })).length, 0)
  assert.ok(mem.topicScore('北京那个面试后来怎么样') > 0.5)
  assert.equal(mem.topicScore('今天天气不错'), 0)
})

test('记经历时模型没按格式回：这段不丢，下次再记；连着三次不行才跳过', async () => {
  const { m, mem } = mk()
  for (let i = 0; i < 3; i++) m.perceive({ window: 'qq:private:1', who: 'qq:1', text: '我明天体检 ' + i, msgId: 'a' + i, at: T0 - 600e3 })
  let reply = '抱歉，我没法输出 JSON'
  mem.connect({ think: async () => reply })
  assert.equal((await mem.encodeWindow('qq:private:1', { force: true })).failed, true)
  assert.equal(mem.pendingWindows().length, 1, '还没记，留着')
  reply = JSON.stringify({ episodes: [{ type: 'pending', gist: '主人明天体检', about: 'qq:1', speaker: 'qq:1', sources: [1] }] })
  assert.equal((await mem.encodeWindow('qq:private:1', { force: true })).encoded, 1)
  assert.equal(mem.pendingWindows().length, 0)
  // 一直乱回：第三次跳过，不卡死
  m.perceive({ window: 'qq:private:1', who: 'qq:1', text: '再来一句', msgId: 'b', at: T0 - 600e3 })
  reply = 'nope'
  for (let i = 0; i < 2; i++) await mem.encodeWindow('qq:private:1', { force: true })
  assert.equal(mem.pendingWindows().length, 1)
  assert.equal((await mem.encodeWindow('qq:private:1', { force: true })).skipped, 1)
  assert.equal(mem.pendingWindows().length, 0)
})

test('睡觉整理：已经知道的事不重复记，新依据并进去、记得更牢', async () => {
  const { m, mem, add } = mk()
  mem.insert({ at: T0 - 3 * D, window: 'w', gist: '主人又点了烤串', kind: 'event' })
  mem.insert({ at: T0 - 1 * D, window: 'w', gist: '主人晚饭吃烤串', kind: 'event' })
  mem.connect({ think: async ({ scene }) => scene === 'consolidate' ? JSON.stringify({ facts: [{ text: '主人很爱吃烤串', about: 'qq:1', sources: ['1', '2'] }] }) : '{}' })
  const first = await m.sleeper.replay(T0 - 5 * D)
  const s0 = mem.list({ kind: 'semantic' })[0].stability
  add(D)
  const second = await m.sleeper.replay(T0 - 5 * D)
  assert.deepEqual([first.facts, second.facts, second.merged], [1, 0, 1])
  const facts = mem.list({ kind: 'semantic' })
  assert.equal(facts.length, 1)
  assert.ok(facts[0].stability > s0)
})

test('梦不会被拿来当「知道的事」的依据', async () => {
  const { m, mem } = mk()
  mem.insert({ at: T0 - 10 * D, window: '', gist: '梦见主人变成了猫', kind: 'dream' })
  const real = mem.insert({ at: T0 - 1 * D, window: 'w', gist: '主人说想养猫', kind: 'event' })
  // 两条向量一模一样，回放时会去找「相关的旧经历」
  const v = Array.from({ length: 8 }, (_, i) => i + 1)
  const model = m.setting('memory.embedModel')
  for (const id of mem.list({ limit: 10, status: 'live' }).map((x) => x.id)) mem.vectors.put(id, model, v)
  let seen = ''
  mem.connect({ think: async ({ text }) => { seen = text; return '{"facts":[]}' } })
  await m.sleeper.replay(T0 - 2 * D)
  assert.match(seen, /想养猫/)
  assert.doesNotMatch(seen, /梦见/)
  assert.ok(real)
})

test('没说时间的约定：一周内每轮记着，之后不再时时提醒，聊到了还想得起来；很久没想起会归档', async () => {
  const { mem, add } = mk()
  mem.insert({ at: T0, window: 'w', gist: '答应给主人画一张猫猫头像', kind: 'intention', importance: 0.6 })
  assert.equal(mem.dueIntentions({ window: 'w' }).length, 1)
  add(8 * D)
  assert.equal(mem.dueIntentions({ window: 'w' }).length, 0)
  assert.match((await mem.recall({ cue: '猫猫头像' }))[0]?.text || '', /猫猫头像/)
})

test('老库（第 2 版）打开时补上种类和「关于谁」的索引列，数据不动、能按它查', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { SCHEMA, MIGRATIONS, openStore } = await import('../src/mind/store.js')
  const file = join(mkdtempSync(join(tmpdir(), 'mind-v2-')), 'mind.sqlite')
  const old = new DatabaseSync(file)
  old.exec(SCHEMA)
  old.exec(MIGRATIONS[2])
  old.exec('PRAGMA user_version = 2')
  old.prepare('INSERT INTO episodes (id, at, window, gist, strength, stability, status, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('m:1', T0, 'w', '答应周末陪主人看电影', 0.6, 1, 'live', JSON.stringify({ kind: 'intention', about: 'qq:1' }))
  old.close()
  const s = openStore(file)
  assert.equal(s.prep('PRAGMA user_version').get().user_version, 3)
  assert.deepEqual({ ...s.prep('SELECT id, kind, about FROM episodes').get() }, { id: 'm:1', kind: 'intention', about: 'qq:1' })
  assert.match(JSON.stringify(s.prep("EXPLAIN QUERY PLAN SELECT * FROM episodes WHERE kind = 'intention' AND status = 'live'").all()), /episodes_kind/)
  s.close()
})

test('需要的强弱跟着性格走：爱社交、依恋焦虑高的更需要陪伴，缺得也更快', async () => {
  const { needStrengths } = await import('../src/mind/motivation/index.js')
  const plain = needStrengths(() => 0.5)
  assert.ok(Object.values(plain).every((x) => x === 0.5))
  const clingy = needStrengths((t) => ({ sociability: 0.9, attachAnxiety: 0.9, attachAvoidance: 0.1 })[t] ?? 0.5)
  assert.ok(clingy.companion > 0.85)
  const { m } = mk()
  m.personality.confirm({ sociability: 0.9, attachAnxiety: 0.9, attachAvoidance: 0.1 })
  assert.ok(m.motivation.state().needs.find((n) => n.id === 'companion').strength > 0.85)
})
