// Telegram 最小适配器：不联网，用 fake fetch 验证 getMe/轮询/发文本/发图片。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTelegramChannel } from '../src/channels/telegram/index.js'

test('Telegram 适配器能启动、发送文本和图片', async () => {
  const calls = []
  let first = true
  const fetchImpl = async (url, init) => {
    const method = String(url).split('/').pop()
    const body = JSON.parse(init.body || '{}')
    calls.push({ method, body })
    if (method === 'getMe') return { ok: true, json: async () => ({ ok: true, result: { id: 999, username: 'demo_bot' } }) }
    if (method === 'getUpdates') {
      if (first) { first = false; return { ok: true, json: async () => ({ ok: true, result: [] }) } }
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    }
    if (method === 'sendMessage') return { ok: true, json: async () => ({ ok: true, result: { message_id: 11 } }) }
    if (method === 'sendPhoto') return { ok: true, json: async () => ({ ok: true, result: { message_id: 12 } }) }
    if (method === 'getChat') return { ok: true, json: async () => ({ ok: true, result: { id: -1001, title: '测试群' } }) }
    return { ok: true, json: async () => ({ ok: true, result: {} }) }
  }
  const channel = createTelegramChannel({ getConfig: () => ({ enabled: true, platforms: { telegram: { enabled: true, token: 'TOKEN' } } }), fetchImpl, log: { info() {}, warn() {}, debug() {} } })
  await channel.start()
  assert.equal(channel.ready(), true)
  assert.equal(channel.selfId(), '999')
  const r = await channel.send('telegram:private:42', [{ type: 'text', data: { text: '你好' } }])
  assert.equal(r.messageId, '11')
  assert.equal(calls.find((c) => c.method === 'sendMessage').body.chat_id, '42')
  await channel.send('telegram:group:-1001', [{ type: 'image', data: { file: 'https://example.com/a.png' } }])
  assert.equal(calls.find((c) => c.method === 'sendPhoto').body.chat_id, '-1001')
  assert.equal((await channel.group('telegram:group:-1001')).name, '测试群')
  channel.stop()
})

test('Telegram base64 图片用 multipart 上传', async () => {
  let form = null
  const fetchImpl = async (url, init) => {
    const method = String(url).split('/').pop()
    if (method === 'sendPhoto') {
      form = init.body
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 21 } }) }
    }
    return { ok: true, json: async () => ({ ok: true, result: {} }) }
  }
  const channel = createTelegramChannel({ getConfig: () => ({ enabled: true, platforms: { telegram: { enabled: true, token: 'TOKEN' } } }), fetchImpl, log: { info() {}, warn() {}, debug() {} } })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==', 'base64')
  const r = await channel.send('telegram:private:42', [{ type: 'image', data: { file: 'base64://' + png.toString('base64') } }])
  assert.equal(r.messageId, '21')
  assert.ok(form && typeof form.get === 'function')
  assert.equal(form.get('chat_id'), '42')
  assert.equal(form.get('photo')?.size, png.length)
  channel.stop()
})
