// 平台连接的最小契约：先保证 QQ 之外的适配器不会把缺方法/缺能力的对象塞进壳。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChannels, validateChannel, REQUIRED_CHANNEL_METHODS } from '../src/channels/index.js'
import { createChannelManager } from '../src/channels/manager.js'

function fake(platform = 'demo', caps = { text: true }) {
  return {
    platform, label: platform, caps, selfId: () => 'bot-1', ready: () => true, state: () => 'stopped',
    start() {}, stop() {}, async send() { return { messageId: 'm1' } },
    on() { return () => {} }, async status() { return { state: 'stopped' } },
  }
}

test('平台连接必须满足最小契约，并且只能注册一次', () => {
  const channels = createChannels()
  const ch = channels.add(fake())
  assert.equal(channels.get('demo'), ch)
  assert.equal(channels.of('demo:private:1'), ch)
  assert.equal(channels.can('demo:private:1', 'text'), true)
  assert.equal(channels.can('demo:private:1', 'voice'), false)
  assert.throws(() => channels.add(fake()), /已经有 demo/)
  assert.deepEqual(REQUIRED_CHANNEL_METHODS.includes('send'), true)
})

test('缺少 send/on 或平台 id 不合法时立即报错', () => {
  const channels = createChannels()
  const missing = fake()
  delete missing.send
  assert.throws(() => channels.add(missing), /send/)
  assert.throws(() => validateChannel({ ...fake(), platform: 'Demo!' }), /平台 id/)
  assert.throws(() => validateChannel({ ...fake(), caps: [] }), /caps/)
  assert.throws(() => validateChannel({ ...fake(), group: 'nope' }), /group 必须/)
})

test('平台注册表统一启动、停止和状态快照', () => {
  const channels = createChannels()
  let started = 0
  const ch = fake('demo2')
  ch.start = () => { started++ }
  channels.add(ch)
  channels.startAll()
  assert.equal(started, 1)
  assert.deepEqual(channels.status()[0].platform, 'demo2')
  assert.equal(channels.status()[0].ready, true)
})

test('ChannelManager 统一订阅和生命周期', () => {
  const manager = createChannelManager()
  const ch = fake('managed')
  let listener
  ch.on = (fn) => { listener = fn; return () => {} }
  manager.add(ch)
  const seen = []
  const off = manager.on((e) => seen.push(e))
  listener({ type: 'state', state: 'connected' })
  assert.deepEqual(seen, [{ type: 'state', state: 'connected', platform: 'managed' }])
  off()
  listener({ type: 'state', state: 'stopped' })
  assert.equal(seen.length, 1)
  manager.dispose()
})
