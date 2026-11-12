// 一直没停下来的聊天：最早没记的等了 30 分钟就先记一段；刚开始聊、还没停下的照旧等。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMindAdapter } from '../src/mind-adapter/index.js'

test('热闹的群一直没停：等够 30 分钟先记；没等够、又没停下的不记', async () => {
  let t = Date.UTC(2026, 10, 10, 4)
  let asks = 0
  const a = createMindAdapter({ memoryDb: true, getConfig: () => ({ ownerQQ: '1' }), now: () => t, random: () => 0.5,
    ask: async () => { asks++; return JSON.stringify({ episodes: [{ type: 'event', gist: '群里在聊周末去哪玩', who: ['qq:2'], sources: [1] }] }) } })
  a.mind.updateSettings({ 'identity.age': 18 })
  const say = (i) => a.mind.perceive({ window: 'qq:group:5', who: 'qq:2', text: '第 ' + i + ' 句', msgId: 'm' + i, at: t })
  // 每 3 分钟一句，从不停够 5 分钟
  for (let i = 0; i < 6; i++) { say(i); t += 3 * 60000 }
  await a.mind.memory.encodePending()
  assert.equal(asks, 0, '才 18 分钟，又没停下，先不记')
  for (let i = 6; i < 11; i++) { say(i); t += 3 * 60000 }
  await a.mind.memory.encodePending()
  assert.equal(asks, 1, '最早那条等了 30 分钟以上，先记一段')
  assert.ok(a.mind.memory.list({ limit: 5 }).some((m) => m.gist === '群里在聊周末去哪玩'))
})

test('并发编码同一批原话只写一次，等待模型时忘掉的原话不会复活', async (t) => {
  const now = Date.UTC(2026, 10, 10, 4)
  let finish
  let calls = 0
  const a = createMindAdapter({ memoryDb: true, now: () => now, getConfig: () => ({ ownerQQ: '1' }), ask: () => {
    calls++
    return new Promise((resolve) => { finish = resolve })
  } })
  t.after(() => a.close())
  const mem = a.mind.memory
  const window = 'qq:private:2'
  const answer = (gist) => JSON.stringify({ episodes: [{ type: 'event', gist, sources: [1] }] })
  a.mind.perceive({ window, who: 'qq:2', text: '周末去散步', msgId: 'a' })
  const first = mem.encodeWindow(window, { force: true })
  const parallel = mem.encodeWindow(window, { force: true })
  finish(answer('约好去散步'))
  assert.deepEqual((await Promise.all([first, parallel])).map((r) => r.encoded), [1, 0])
  assert.equal(calls, 1)
  assert.equal(mem.list().length, 1)
  a.mind.perceive({ window, who: 'qq:2', text: '下雨就改期', msgId: 'b' })
  const pending = mem.encodeWindow(window, { force: true })
  a.mind.forgetPerson('qq:2', { windows: [window] })
  finish(answer('下雨就改期'))
  assert.equal((await pending).encoded, 0)
  assert.deepEqual(mem.list(), [])
  assert.deepEqual(a.mind.history(window), [])
})
