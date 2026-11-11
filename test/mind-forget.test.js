// 忘掉一个人（第 16 项）：关于他的事移进恢复区、能整份放回来；「以后不记」不再记他说的话；主人不能忘。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMindAdapter } from '../src/mind-adapter/index.js'

const T0 = Date.UTC(2026, 10, 10, 4)
function setup() {
  let t = T0
  const a = createMindAdapter({ memoryDb: true, getConfig: () => ({ ownerQQ: '1' }), now: () => t, random: () => 0.5, ask: async () => '{"episodes":[]}' })
  a.mind.updateSettings({ 'identity.age': 18 })
  const m = a.mind
  m.notePerson('qq:2', { name: '小明' })
  m.relations.edit('qq:2', { closeness: 0.6, note: '爱打游戏' })
  m.memory.insert({ at: T0, window: 'qq:private:2', gist: '小明说他明天面试', kind: 'fact', about: 'qq:2', speaker: 'qq:2', who: ['qq:2'] })
  m.memory.insert({ at: T0, window: 'qq:group:5', gist: '小明和小红一起开黑', kind: 'event', who: ['qq:2', 'qq:3'] })
  m.memory.insert({ at: T0, window: 'qq:group:5', gist: '小红换了头像', kind: 'event', about: 'qq:3', who: ['qq:3'] })
  m.perceive({ window: 'qq:private:2', who: 'qq:2', text: '我明天面试', msgId: 'a', at: T0 })
  m.perceive({ window: 'qq:group:5', who: 'qq:2', text: '开黑吗', msgId: 'b', at: T0 })
  return { a, m, set: (v) => { t = v } }
}
const gists = (m) => m.memory.list({ limit: 50 }).map((x) => x.gist)

test('忘掉这个人：关于他的、和他的私聊、他的原话都移进恢复区；和别人一起的事留着；能整份放回来', async () => {
  const { a, m } = setup()
  const r = a.forgetQQ('2', 'delete')
  assert.equal(r.ok, true)
  assert.equal(r.episodes, 1)
  assert.equal(r.perception, 2)
  assert.deepEqual(gists(m).sort(), ['小明和小红一起开黑', '小红换了头像'])
  assert.equal(m.person('qq:2'), null)
  assert.equal(m.history('qq:private:2').length, 0)
  const list = m.forgottenList()
  assert.equal(list.length, 1)
  assert.equal(list[0].name, '小明')
  const back = await a.restoreQQ('2')
  assert.equal(back.ok, true)
  assert.ok(gists(m).includes('小明说他明天面试'))
  assert.equal(m.person('qq:2').name, '小明')
  assert.equal(m.relations.get('qq:2').tom.note, '爱打游戏', '关系也回来了')
  assert.equal(m.history('qq:private:2').length, 1)
  assert.equal(m.forgottenList().length, 0)
  assert.equal(m.deletions().filter((d) => d.kind === 'episode').length, 0, '放回来的不再算删掉的')
})

test('以后不记他：他的话不进感知、私聊里她说的也不记；可以撤销；选了清掉就把以前的也移走', async () => {
  const { a, m } = setup()
  assert.equal(a.forgetQQ('2', 'stop').ok, true)
  assert.ok(gists(m).includes('小明说他明天面试'), '不选清掉，以前的留着')
  assert.equal(a.perceive({ chatId: 'private:2', kind: 'private', userId: '2', nickname: '小明', text: '在吗', messageId: 'c' }), false)
  assert.equal(a.said({ chatId: 'private:2', message: '在呀', messageId: 'd' }), false)
  assert.equal(m.relations.list().find((p) => p.id === 'qq:2').noMemory, true)
  a.forgetQQ('2', 'resume')
  assert.notEqual(a.perceive({ chatId: 'private:2', kind: 'private', userId: '2', nickname: '小明', text: '在吗', messageId: 'e' }), false)
  const r = a.forgetQQ('2', 'stop', { clear: true })
  assert.equal(r.ok, true)
  assert.ok(!gists(m).includes('小明说他明天面试'))
  assert.equal(m.person('qq:2').noMemory, true, '人还在')
  assert.equal(m.forgottenList()[0].keepPerson, true)
})

test('主人不能忘；恢复区 30 天后清掉', async () => {
  const { a, m, set } = setup()
  assert.equal(a.forgetQQ('1', 'delete').ok, false)
  assert.equal(a.forgetQQ('1', 'stop').ok, false)
  a.forgetQQ('2', 'delete')
  set(T0 + 31 * 86400000)
  assert.equal(m.forgottenList().length, 0)
  assert.equal((await a.restoreQQ('2')).ok, false)
})
