// 精排（第 15 项）：开着时让精排模型按「线索和这件事多相关」重排；关着 / 出错 / 超时都按原来的顺序。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMindAdapter } from '../src/mind-adapter/index.js'
import { createRerankClient } from '../src/mind/memory/vectors.js'

const T0 = Date.UTC(2026, 10, 10, 4)
// 关键词命中的候选都一样「像」，原顺序按记得多牢；精排让「猫」那条排第一
function setup({ on = true, fail = false } = {}) {
  const calls = []
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    if (url.endsWith('/rerank')) {
      calls.push(body)
      if (fail) return { ok: false, status: 500 }
      return { ok: true, json: async () => ({ results: body.documents.map((d, index) => ({ index, relevance_score: d.includes('猫') ? 0.95 : 0.1 })) }) }
    }
    throw new Error('不用向量')
  }
  const a = createMindAdapter({ memoryDb: true, getConfig: () => ({ ownerQQ: '1' }), now: () => T0, random: () => 0.5, ask: async () => '{"episodes":[]}', fetch, embedKey: () => 'k' })
  a.mind.updateSettings({ 'identity.age': 18, 'memory.rerank': on })
  const m = a.mind
  m.memory.insert({ at: T0 - 3600000, window: 'qq:private:1', gist: '周末的时候一起去公园散步', kind: 'event', importance: 0.9 })
  m.memory.insert({ at: T0 - 7200000, window: 'qq:private:1', gist: '周末的时候他家的猫生病了', kind: 'event', importance: 0.5 })
  return { m, calls }
}
const first = async (m) => (await m.memory.recall({ cue: '周末的时候', window: 'qq:private:1', limit: 1, deliberate: true }))[0]?.text

test('开着：按精排的相关度排，带上线索和候选原文', async () => {
  const { m, calls } = setup()
  assert.match(await first(m), /猫/)
  assert.equal(calls[0].model, 'BAAI/bge-reranker-v2-m3')
  assert.equal(calls[0].query, '周末的时候')
  assert.equal(calls[0].documents.length, 2)
})

test('关着不调用；出错按原来的顺序', async () => {
  const off = setup({ on: false })
  assert.match(await first(off.m), /公园/)
  assert.equal(off.calls.length, 0)
  const bad = setup({ fail: true })
  assert.match(await first(bad.m), /公园/)
})

test('精排客户端：超时就放弃；在线服务没密钥直接不发', async () => {
  const slow = createRerankClient({ url: () => 'https://api.example.com/v1', model: () => 'm', key: () => 'k', fetch: (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))) })
  await assert.rejects(slow('q', ['a', 'b'], { timeoutMs: 50 }), /aborted/)
  const nokey = createRerankClient({ url: () => 'https://api.example.com/v1', model: () => 'm', fetch: async () => { throw new Error('不该发') } })
  await assert.rejects(nokey('q', ['a']), /没填精排接口的密钥/)
})
