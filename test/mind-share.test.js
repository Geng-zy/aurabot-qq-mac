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
  const r = await a.moduleApi('tophub').share({ text: '热榜《猫猫做饭》：这只猫会做饭', url: 'https://example.com/x' })
  assert.equal(r.ok, true)
  assert.equal(notes.length, 1)
  assert.equal(notes[0].chatId, 'private:1')
  assert.match(notes[0].note, /心里的打算/)
  assert.match(notes[0].note, /猫猫做饭.*https:\/\/example\.com\/x/)
  assert.doesNotMatch(a.contextFor({ chat: owner }), /之前刷到、想给他看的/, '说过了就不再惦记')
})

test('现在不能找（上次找他还没回）：先记着，和主人聊天时想起来，最多两次', async () => {
  const { a, notes } = setup()
  await a.moduleApi('tophub').share({ text: '第一个', url: 'https://example.com/1' })
  await a.moduleApi('tophub').share({ text: '《猫》的文章里有一张画面', hint: '想发给他看就附上配图' })
  assert.equal(notes.length, 1, '第二个没再去找（上次找他还没回）')
  const ctx = a.contextFor({ chat: owner })
  assert.match(ctx, /之前刷到、想给他看的.*有一张画面.*附上配图/)
  assert.match(a.contextFor({ chat: owner }), /有一张画面/)
  assert.doesNotMatch(a.contextFor({ chat: owner }), /有一张画面/, '想起两次就算了')
  assert.doesNotMatch(a.contextFor({ chat: { chatId: 'group:5', kind: 'group', groupId: '5' } }), /想给他看/, '群里不提')
})

test('两天没机会说就算了；调试模式不记', async () => {
  const s = setup()
  s.a.reachOwner = undefined
  await s.a.moduleApi('tophub').share({ text: '旧的' })
  await s.a.moduleApi('tophub').share({ text: '没说成的' })
  s.set(T0 + 3 * 86400000)
  assert.doesNotMatch(s.a.contextFor({ chat: owner }), /没说成的/)
  const d = setup({ cfg: { debug: true } })
  assert.equal((await d.a.moduleApi('tophub').share({ text: 'x' })).ok, false)
  assert.equal(d.notes.length, 0)
})

test('历史 B 站待分享不再出现在对话，其他待分享照常提示', () => {
  const { a } = setup()
  a.mind._store.set('shares', [
    { at: T0, text: '旧版待分享视频', by: 'bili', shown: 0 },
    { at: T0, text: '一条热榜消息', by: 'tophub', shown: 0 },
  ])
  const context = a.contextFor({ chat: owner })
  assert.doesNotMatch(context, /旧版待分享视频/)
  assert.match(context, /一条热榜消息/)
})
