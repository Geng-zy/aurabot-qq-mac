// 模块只提供手：刷到想给主人看的东西交给她（api.mind.share），她能找主人就自己开口，不能就先记着、聊天时想起来。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMindAdapter } from '../src/mind-adapter/index.js'

const T0 = Date.UTC(2026, 10, 10, 6, 0) // 上海 14:00

function setup({ cfg = {} } = {}) {
  let t = T0
  const notes = []
  const a = createMindAdapter({
    memoryDb: true, getConfig: () => ({ ownerQQ: '1', ...cfg }), now: () => t, random: () => 0.5,
    ask: async () => '{"episodes":[]}',
    reachOut: async (o) => { notes.push(o) },
  })
  a.mind.updateSettings({ 'identity.age': 18, 'motivation.quietHours': '' })
  return { a, notes, set: (v) => { t = v } }
}
const owner = { chatId: 'private:1', kind: 'private', userId: '1' }

test('能找主人：由她自己开口，带上是什么和链接', async () => {
  const { a, notes } = setup()
  const r = await a.moduleApi('bili').share({ text: 'B 站《猫猫做饭》：这只猫会做饭', url: 'https://b23.tv/x' })
  assert.equal(r.ok, true)
  assert.equal(notes.length, 1)
  assert.equal(notes[0].chatId, 'private:1')
  assert.match(notes[0].note, /心里的打算/)
  assert.match(notes[0].note, /猫猫做饭.*https:\/\/b23\.tv\/x/)
  assert.doesNotMatch(a.contextFor({ chat: owner }), /之前刷到、想给他看的/, '说过了就不再惦记')
})

test('现在不能找（上次找他还没回）：先记着，和主人聊天时想起来，最多两次', async () => {
  const { a, notes } = setup()
  await a.moduleApi('bili').share({ text: '第一个', url: 'https://b23.tv/1' })
  await a.moduleApi('bili').share({ text: 'B 站《猫》里截到一张画面', hint: '想发给他看就用 qq_send_shot' })
  assert.equal(notes.length, 1, '第二个没再去找（上次找他还没回）')
  const ctx = a.contextFor({ chat: owner })
  assert.match(ctx, /之前刷到、想给他看的.*截到一张画面.*qq_send_shot/)
  assert.match(a.contextFor({ chat: owner }), /截到一张画面/)
  assert.doesNotMatch(a.contextFor({ chat: owner }), /截到一张画面/, '想起两次就算了')
  assert.doesNotMatch(a.contextFor({ chat: { chatId: 'group:5', kind: 'group', groupId: '5' } }), /想给他看/, '群里不提')
})

test('两天没机会说就算了；调试模式不记', async () => {
  const s = setup()
  s.a.reachOwner = undefined
  await s.a.moduleApi('bili').share({ text: '旧的' })
  await s.a.moduleApi('bili').share({ text: '没说成的' })
  s.set(T0 + 3 * 86400000)
  assert.doesNotMatch(s.a.contextFor({ chat: owner }), /没说成的/)
  const d = setup({ cfg: { debug: true } })
  assert.equal((await d.a.moduleApi('bili').share({ text: 'x' })).ok, false)
  assert.equal(d.notes.length, 0)
})
