// 换向量模型以后：睡觉时分批把旧记忆用新模型重新算一遍；没算到的照常按字面找；算完又能按意思想起来。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMindAdapter } from '../src/mind-adapter/index.js'

const T0 = Date.UTC(2026, 10, 10, 4)
// 假的向量接口：按模型名给不同的向量（同一句话在两个模型里不一样），记下每次算了几条
function setup() {
  const calls = []
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ model: body.model, n: body.input.length })
    const vec = (t) => [...String(t)].slice(0, 8).map((c, i) => ((c.charCodeAt(0) * (body.model === 'B' ? 7 : 3) + i) % 97) / 97).concat(Array(8).fill(0.1)).slice(0, 8)
    return { ok: true, json: async () => ({ data: body.input.map((t, index) => ({ index, embedding: vec(t) })) }) }
  }
  const a = createMindAdapter({ memoryDb: true, getConfig: () => ({ ownerQQ: '1' }), now: () => T0, random: () => 0.5, ask: async () => '{}', fetch, embedKey: () => 'k' })
  a.mind.updateSettings({ 'identity.age': 18, 'memory.embedModel': 'A', 'memory.reembedPerNight': 3 })
  return { a, m: a.mind, calls }
}

test('换了向量模型：每晚重算一批（新的先算），几晚算完；算完的又能按意思找到', async () => {
  const { m, calls } = setup()
  const ids = []
  for (let i = 0; i < 5; i++) ids.push(m.memory.insert({ at: T0 - (5 - i) * 3600000, window: 'qq:private:1', gist: `第${i}件事`, kind: 'event' }))
  await m.memory.embedEpisodes(ids)
  assert.deepEqual(m.memory.vectorProgress(), { done: 5, total: 5, model: 'A' })
  m.updateSettings({ 'memory.embedModel': 'B' })
  assert.equal(m.memory.vectorProgress().done, 0, '换了模型，旧的都比不了')
  calls.length = 0
  await m.sleep()
  assert.equal(m.memory.vectorProgress().done, 3, '第一晚算 3 条')
  assert.ok(calls.every((c) => c.model === 'B'))
  assert.deepEqual(m.memory.staleVectorIds(10), [ids[1], ids[0]], '剩下最旧的两条')
  await m.sleep()
  assert.deepEqual(m.memory.vectorProgress(), { done: 5, total: 5, model: 'B' })
  calls.length = 0
  await m.sleep()
  assert.ok(!calls.some((c) => c.n > 1), '都算完了，不再重算')
})

test('设成 0 就不重算', async () => {
  const { m } = setup()
  const id = m.memory.insert({ at: T0, window: 'qq:private:1', gist: '一件事', kind: 'event' })
  await m.memory.embedEpisodes([id])
  m.updateSettings({ 'memory.embedModel': 'B', 'memory.reembedPerNight': 0 })
  await m.sleep()
  assert.equal(m.memory.vectorProgress().done, 0)
})

test('补向量临时失败会留待下次，即使关闭了换模型重算', async (t) => {
  const { a, m } = setup()
  t.after(() => a.close())
  m.updateSettings({ 'memory.reembedPerNight': 0 })
  const id = m.memory.insert({ at: T0, gist: '需要补向量的一件事', kind: 'event' })
  m.memory.connect({ embed: async () => { throw new Error('向量服务暂时离线') } })
  await m.sleep({ quality: 0 })
  assert.equal(m.vectorOf(id), null)
  assert.ok(m.memory.takeJobs('embed').some((j) => j.ref === id))
  m.memory.connect({ embed: async () => [[1, 2]] })
  await m.sleep({ quality: 0 })
  assert.ok(m.vectorOf(id))
  assert.ok(!m.memory.takeJobs('embed').some((j) => j.ref === id))
})
