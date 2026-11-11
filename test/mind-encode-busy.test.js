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
