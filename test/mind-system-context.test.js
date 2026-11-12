// 她自己去做事的后台会话（刷 B 站、写空间……）也是同一个她：带上身体、心情、刚才在想的、别的聊天里刚发生的。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMindAdapter } from '../src/mind-adapter/index.js'

test('后台会话：有身体和心情、别的聊天刚发生的；没有「眼前的人」', () => {
  const t = Date.UTC(2026, 10, 10, 6)
  const a = createMindAdapter({ memoryDb: true, getConfig: () => ({ ownerQQ: '1' }), now: () => t, random: () => 0.5, ask: async () => '{"episodes":[]}' })
  a.mind.updateSettings({ 'identity.age': 18 })
  a.mind.emotion.feel([{ name: '生气', intensity: 0.8, target: 'qq:2', why: '被骂了', importance: 0.6 }], { source: 'test' })
  a.mind.memory.insert({ window: 'qq:group:5', gist: '群里聊到唱歌', kind: 'event', at: t - 60000 })
  const sys = a.contextFor({ chat: { chatId: 'system:bili', kind: 'system', title: '刷 B 站' } })
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
