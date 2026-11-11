// 心智核心不认识任何聊天平台：QQ、飞书、微信的窗口和人一样对待；同一个人在不同平台的 id 能连起来。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMind, placeOf, shortId } from '../src/mind/index.js'

const T0 = Date.UTC(2026, 10, 10, 4)
const mk = (o = {}) => createMind({ dir: '/nonexistent', memoryDb: true, now: () => T0, random: () => 0.5, ownerId: 'qq:1', ...o })

test('窗口约定：任何平台的 private / group 都认得；认不出的算 other', () => {
  assert.deepEqual(placeOf('feishu:group:oc_9'), { kind: 'group', id: 'oc_9', platform: 'feishu' })
  assert.deepEqual(placeOf('wechat:private:wxid_a_b'), { kind: 'private', id: 'wxid_a_b', platform: 'wechat' })
  assert.equal(placeOf('system:sleep').kind, 'other')
  assert.equal(shortId('wechat:wxid_a'), 'wxid_a')
})

test('对接层可以自己告诉核心窗口是什么', () => {
  const m = mk({ place: (w) => ({ kind: w.startsWith('room-') ? 'group' : 'private' }) })
  assert.equal(m.place('room-1').kind, 'group')
  assert.equal(m.place('dm-1').kind, 'private')
})

test('群的了解按整个窗口记：不同平台同一个群号不串', () => {
  const m = mk()
  const rows = [{ id: 1, at: T0, who: 'feishu:7', dir: 'in' }]
  m.relations.observe({ rel: [], group: { style: '飞书工作群' } }, { window: 'feishu:group:9', rows })
  m.relations.observe({ rel: [], group: { style: 'QQ 水群' } }, { window: 'qq:group:9', rows })
  assert.deepEqual(m.relations.groupOf('feishu:group:9').style, ['飞书工作群'])
  assert.deepEqual(m.relations.groupOf('qq:group:9').style, ['QQ 水群'])
  assert.match(m.relations.describe([], { window: 'feishu:group:9' }), /飞书工作群/)
})

test('私聊里的事在别的平台的群里想起来：一样提醒分寸', async () => {
  const m = mk()
  m.memory.insert({ at: T0, window: 'wechat:private:wxid_2', gist: '小明说他在准备考研复试', kind: 'fact', about: 'wechat:wxid_2', speaker: 'wechat:wxid_2', importance: 0.8 })
  const w = await m.memory.workingMemory({ cue: '考研复试', window: 'feishu:group:9', people: ['wechat:wxid_2'] })
  assert.match(w.text, /考研复试.*私聊里的事/)
})

test('同一个人：主人的微信连到主人以后，算主人；原话、经历、名字都并过去', () => {
  const m = mk()
  m.perceive({ window: 'wechat:private:wxid_o', who: 'wechat:wxid_o', name: '鱼哥', text: '在吗', msgId: 'w1', at: T0 })
  m.memory.insert({ at: T0, window: 'wechat:private:wxid_o', gist: '他说周末去爬山', kind: 'fact', about: 'wechat:wxid_o', speaker: 'wechat:wxid_o', who: ['wechat:wxid_o'] })
  m.notePerson('qq:1', { name: '主人QQ' })
  assert.equal(m.isOwner('wechat:wxid_o'), false)
  assert.equal(m.linkPerson('qq:1', 'wechat:wxid_o').ok, false, '不能把主人并到别人身上')
  assert.equal(m.linkPerson('wechat:wxid_o', 'qq:1').ok, true)
  assert.equal(m.isOwner('wechat:wxid_o'), true)
  assert.equal(m.canon('wechat:wxid_o'), 'qq:1')
  assert.equal(m.person('wechat:wxid_o').id, 'qq:1')
  assert.ok(m.person('qq:1').aliases.includes('鱼哥'))
  assert.deepEqual(m.idsOf('qq:1').sort(), ['qq:1', 'wechat:wxid_o'])
  assert.equal(m.history('wechat:private:wxid_o')[0].who, 'qq:1')
  assert.equal(m.memory.list({ limit: 5 })[0].gist, '他说周末去爬山')
  assert.match(JSON.stringify(m.episode(m.memory.list({ limit: 5 })[0].id).data), /"about":"qq:1"/)
  // 以后从微信来的消息直接算主人的
  m.perceive({ window: 'wechat:private:wxid_o', who: 'wechat:wxid_o', text: '回来了', msgId: 'w2', at: T0 + 1 })
  assert.equal(m.history('wechat:private:wxid_o').at(-1).who, 'qq:1')
  assert.equal(m.listPeople().filter((p) => p.id === 'wechat:wxid_o').length, 0)
})

test('连人时，原来连到他身上的别的 id 也跟着改连', () => {
  const m = mk()
  m.notePerson('a:1'); m.notePerson('b:1'); m.notePerson('c:1')
  m.linkPerson('a:1', 'b:1')
  m.linkPerson('b:1', 'c:1')
  assert.equal(m.canon('a:1'), 'c:1')
  assert.deepEqual(m.idsOf('c:1').sort(), ['a:1', 'b:1', 'c:1'])
})

test('忘掉一个 id 里有 _ 的人（微信 wxid_x）也找得到他的事；放回来连联想的线一起回来', () => {
  const m = mk()
  const pid = 'wechat:wxid_a_b'
  m.notePerson(pid, { name: '小王' })
  const a = m.memory.insert({ at: T0, window: 'wechat:private:wxid_a_b', gist: '小王说他养了只猫', kind: 'fact', about: pid, speaker: pid, who: [pid] })
  const b = m.memory.insert({ at: T0, window: 'wechat:private:wxid_a_b', gist: '小王的猫叫煤球', kind: 'fact', about: pid, speaker: pid, who: [pid] })
  m._store.prep('INSERT INTO links (a, b, kind, weight) VALUES (?, ?, ?, ?)').run(a, b, 'similar', 0.9)
  const r = m.forgetPerson(pid, { windows: ['wechat:private:wxid_a_b'] })
  assert.equal(r.episodes, 2)
  assert.equal(m._store.prep('SELECT COUNT(*) AS n FROM links').get().n, 0)
  m.restorePerson(pid)
  assert.equal(m._store.prep('SELECT COUNT(*) AS n FROM links').get().n, 1)
})

test('内心独白里用她自己改过的称呼', async () => {
  const m = mk()
  m.self.change({ what: 'ownerCall', content: '哥哥', why: '叫着亲' })
  let system = ''
  m.inner.connect({ local: { chat: async (msgs) => { system = msgs[0].content; return '念头：哥哥怎么还不理我\n感受：失落 0.6\n打算：想找哥哥说话\n深想：否' } } })
  const st = await m.inner.step()
  assert.match(system, /想找哥哥说话/)
  assert.equal(m.motivation.state().wants[0].action, 'reach_owner')
  assert.ok(st)
})

test('「专一」：用她自己的称呼说喜欢主人不算喜欢别人', () => {
  const m = mk()
  m.self.change({ what: 'ownerCall', content: '哥哥', why: '叫着亲' })
  assert.equal(m.self.change({ what: 'values', content: '以后想嫁给哥哥', why: '想清楚了' }).ok, true)
  assert.equal(m.self.change({ what: 'hobbies', content: '暗恋隔壁班长', why: '心动了' }).ok, false)
})
