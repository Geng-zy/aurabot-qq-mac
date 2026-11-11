// 她对主人的称呼：一开始用主人设的；认识够久、隔够久她可以自己改（通知、能退回）；主人在面板改了以主人为准。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMindAdapter } from '../src/mind-adapter/index.js'
import { rulesText } from '../src/persona/personas.js'

const T0 = Date.UTC(2026, 10, 10, 4)
const DAY = 86400000
function setup(cfg = { ownerQQ: '1', ownerName: '主人' }) {
  let t = T0
  const notes = []
  const a = createMindAdapter({ memoryDb: true, getConfig: () => cfg, now: () => t, random: () => 0.5, ask: async () => '{"episodes":[]}', notifyOwner: async (x) => { notes.push(x) } })
  a.mind.updateSettings({ 'identity.age': 18 })
  a.mind.notePerson('qq:1', { name: '阿耿' })
  const tool = () => a.tools({ chat: { chatId: 'private:1', kind: 'private', userId: '1' }, ownerTurn: true }).find((x) => x.name === 'mind_change_self')
  return { a, cfg, notes, tool, set: (v) => { t = v } }
}

test('一开始用主人设的；认识不够久不能改，工具说明里写着为什么', async () => {
  const { a, tool } = setup()
  assert.equal(a.ownerCall(), '主人')
  assert.match(tool().description, /现在叫他「主人」；现在还不能改：和主人认识还不到 30 天/)
  const r = await tool().execute({ what: 'ownerCall', content: '阿耿', why: '处久了想叫名字' })
  assert.equal(r.ok, false)
  assert.equal(a.ownerCall(), '主人')
})

test('认识够久了：她自己改，通知主人，关系里「你叫他」也跟着改；隔不够久不能再改；主人能退回', async () => {
  const { a, notes, tool, set } = setup()
  set(T0 + 31 * DAY)
  const r = await tool().execute({ what: 'ownerCall', content: '阿耿', why: '处久了，叫名字更亲' })
  assert.equal(r.ok, true, r.message)
  assert.equal(a.ownerCall(), '阿耿')
  assert.match(notes[0], /她改了自己的对主人的称呼：「主人」→ 「阿耿」/)
  assert.equal(a.mind.relations.get('qq:1').rel.call, '阿耿')
  assert.match(a.mind.selfPrompt(), /你现在叫他「阿耿」/)
  set(T0 + 35 * DAY)
  assert.equal((await tool().execute({ what: 'ownerCall', content: '耿耿', why: '又想换' })).ok, false, '隔不到 14 天')
  const v = a.mind.listVersions('self', 5).find((x) => x.data.what === 'ownerCall')
  a.mind.self.restore(v.id)
  assert.equal(a.ownerCall(), '主人')
})

test('规则里用她现在的叫法；主人关掉开关她就不能改', async () => {
  const cfg = { ownerQQ: '1', ownerName: '主人' }
  assert.match(rulesText('private', cfg, { ownerCall: '阿耿' }), /QQ 号是 1 的人是你的阿耿/)
  assert.match(rulesText('private', cfg), /QQ 号是 1 的人是你的主人/)
  const { a, tool, set } = setup()
  a.mind.updateSettings({ 'identity.ownerCallChange': false })
  set(T0 + 60 * DAY)
  assert.equal((await tool().execute({ what: 'ownerCall', content: '阿耿', why: 'x' })).ok, false)
  assert.equal(a.mind.self.change({ what: 'ownerCall', content: '宝', why: '主人改的' }, { by: 'owner' }).ok, true, '主人自己改不受限')
  assert.equal(a.ownerCall(), '宝')
})
