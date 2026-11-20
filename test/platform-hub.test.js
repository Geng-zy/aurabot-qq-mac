// 非 QQ 平台的核心回归：同样的 hub.sendText 应该能走 fake channel，而不是偷偷回退成 QQ。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChannels } from '../src/channels/index.js'
import { createHub } from '../src/chat/hub.js'
import { normalize } from '../src/core/config.js'
import { createFakeDsh } from './helpers/fake-dsh.js'

test('hub.sendText 能通过非 QQ 平台发送', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-platform-hub-'))
  const sent = []
  const channel = {
    platform: 'demo', label: 'Demo', caps: { text: true },
    selfId: () => 'bot-demo', ready: () => true, state: () => 'connected',
    start() {}, stop() {},
    on() { return () => {} },
    async send(chatId, message) { sent.push({ chatId, message }); return { messageId: 'demo-1' } },
    async group(chatId) { return { name: chatId.endsWith('2') ? 'Demo 群' : '别的群' } },
    async status() { return { state: 'connected' } },
  }
  const channels = createChannels()
  channels.add(channel)
  const cfg = normalize({ enabled: true, dryRun: false, ownerQQ: '1', botQQ: '10', workspaceDir: dir })
  const fake = createFakeDsh({ brain: async () => '' })
  const hub = createHub({
    dsh: fake.ctx, getConfig: () => cfg, log: { info() {}, debug() {}, error() {}, warn() {} }, channels,
  })
  t.after(() => {
    hub.dispose(); fake.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  const r = await hub.sendText('demo:private:2', '来自别的平台')
  assert.equal(r.messageId, 'demo-1')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].chatId, 'demo:private:2')
  assert.equal(sent[0].message[0].data.text, '来自别的平台')
})

test('平台适配器可以动态注册', async () => {
  const { registerPlatformAdapter, listPlatformAdapters } = await import('../src/channels/registry.js')
  registerPlatformAdapter({ id: 'demo-registry', label: 'Demo', create: () => ({ platform: 'demo-registry' }) })
  assert.ok(listPlatformAdapters().some((x) => x.id === 'demo-registry'))
  assert.throws(() => registerPlatformAdapter({ id: 'demo-registry', create: () => ({}) }), /已经注册/)
})

test('QQ adapter 的 sendBySession 接受 session 对象', async () => {
  const { createQqAdapter } = await import('../src/channels/qq/adapter.js')
  const sent = []
  const adapter = createQqAdapter({ createTransport: () => ({
    platform: 'qq', caps: {}, start() {}, stop() {}, restart() {}, ready: () => true, state: () => 'connected',
    status: async () => ({}), on: () => () => {}, convert: (x) => x,
    async send(chatId, segments) { sent.push({ chatId, segments }); return { messageId: '1' } },
  }) })
  await adapter.sendBySession({ kind: 'group', groupId: '9' }, [{ type: 'text', data: { text: 'hi' } }])
  await adapter.sendBySession({ kind: 'private', userId: '2' }, [{ type: 'text', data: { text: 'hi' } }])
  assert.equal(sent[0].chatId, 'qq:group:9')
  assert.equal(sent[1].chatId, 'qq:private:2')
  assert.equal(adapter.meta().id, 'qq')
})
