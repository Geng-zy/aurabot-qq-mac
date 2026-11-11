// 关系星图（第 10 项）：点是认识的人（带亲近），线是在她的记忆里一起出现过的次数。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMindAdapter } from '../src/mind-adapter/index.js'

test('星图：人和「一起出现过」的线，次数越多越粗；只算还认识的人', async () => {
  const a = createMindAdapter({ memoryDb: true, getConfig: () => ({ ownerQQ: '1' }), now: () => Date.UTC(2026, 10, 10), random: () => 0.5, ask: async () => '{"episodes":[]}' })
  const m = a.mind
  for (const [id, name] of [['qq:1', '主人'], ['qq:2', '小明'], ['qq:3', '小红'], ['qq:4', '路人']]) m.notePerson(id, { name })
  m.relations.edit('qq:2', { closeness: 0.7 })
  let n = 0
  const ep = (who) => m.memory.insert({ at: Date.UTC(2026, 10, 9) + ++n, window: 'qq:group:5', gist: '一起玩了第 ' + n + ' 局', kind: 'event', who })
  ep(['qq:2', 'qq:3'])
  ep(['qq:2', 'qq:3', 'qq:1'])
  ep(['qq:2', 'qq:9']) // 不认识的人不算
  const g = m.peopleGraph()
  assert.equal(g.people.length, 4)
  assert.equal(g.people.find((p) => p.id === 'qq:1').owner, true)
  assert.equal(g.people.find((p) => p.id === 'qq:2').closeness, 0.7)
  const edge = (a, b) => g.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))
  assert.equal(edge('qq:2', 'qq:3').n, 2)
  assert.equal(edge('qq:1', 'qq:2').n, 1)
  assert.equal(edge('qq:2', 'qq:9'), undefined)
})
