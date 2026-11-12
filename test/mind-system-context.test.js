// 她自己去做事的后台会话（读热榜、写空间……）也是同一个她：带上身体、心情、刚才在想的、别的聊天里刚发生的。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMindAdapter } from '../src/mind-adapter/index.js'

test('后台会话：有身体和心情、别的聊天刚发生的；没有「眼前的人」', () => {
  const t = Date.UTC(2026, 10, 10, 6)
  const a = createMindAdapter({ memoryDb: true, getConfig: () => ({ ownerQQ: '1' }), now: () => t, random: () => 0.5, ask: async () => '{"episodes":[]}' })
  a.mind.updateSettings({ 'identity.age': 18 })
  a.mind.emotion.feel([{ name: '生气', intensity: 0.8, target: 'qq:2', why: '被骂了', importance: 0.6 }], { source: 'test' })
  a.mind.memory.insert({ window: 'qq:group:5', gist: '群里聊到唱歌', kind: 'event', at: t - 60000 })
  const sys = a.contextFor({ chat: { chatId: 'system:tophub', kind: 'system', title: '读热榜' } })
  assert.match(sys, /【此刻】/)
  assert.match(sys, /精力|困|饿|累|精神/, '身体状态')
  assert.match(sys, /生气/, '心情')
  assert.match(sys, /别的聊天里刚发生的[\s\S]*群里聊到唱歌/)
  const publishing = a.contextFor({ chat: { chatId: 'system:diary:public', kind: 'system' }, publicOnly: true })
  assert.match(publishing, /【心情】/)
  assert.doesNotMatch(publishing, /被骂了|群里聊到唱歌/)
  const chat = a.contextFor({ chat: { chatId: 'private:1', kind: 'private', userId: '1' } })
  assert.match(chat, /生气/, '聊天里也一样')
})

test('离线向量单独标记索引，检索与精排均不走远程', async (t) => {
  const calls = []
  const config = { ownerQQ: '1', mind: { embedBackend: 'local' } }
  const adapter = createMindAdapter({
    memoryDb: true, getConfig: () => config, embedKey: () => 'remote-key',
    localEmbedding: { probe: () => '', embed: async (text, options) => { calls.push({ text, ...options }); return [1, 0, 0] } },
    fetch: () => { throw new Error('离线模式不应联网') },
  })
  t.after(() => adapter.close())
  const mem = adapter.mind.memory
  adapter.mind.updateSettings({ 'memory.rerank': true })
  const first = mem.insert({ at: Date.now(), gist: '樱花公园花开了', kind: 'event' })
  const second = mem.insert({ at: Date.now(), gist: '朋友计划一起赏花', kind: 'event' })
  assert.equal(await mem.embedEpisodes([first, second]), 2)
  await mem.recall({ cue: '樱花' })
  assert.equal(calls.filter((call) => call.query).length, 1)
  assert.equal(adapter.embeddingStatus().backend, 'local')
  assert.equal(mem.vectorProgress().model, 'local:bge-small-zh-v1.5-int8')
  config.mind.embedBackend = 'remote'
  assert.equal(mem.vectorProgress().done, 0)
})
