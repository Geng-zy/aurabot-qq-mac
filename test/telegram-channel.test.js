// Telegram 最小适配器：不联网，用 fake fetch 验证 getMe/轮询/发文本/发图片。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTelegramChannel } from '../src/channels/telegram/index.js'

const log = { info() {}, warn() {}, debug() {}, error() {}, child() { return this } }

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

// ---------- B27：通道契约对齐 ----------

test('caps 只含规范能力位：不再声明 text / reply / images 这类假能力', async () => {
  const { TELEGRAM_CAPS } = await import('../src/channels/telegram/index.js')
  const { CAPS } = await import('../src/channels/index.js')
  assert.equal(TELEGRAM_CAPS.text, undefined, 'text 不是能力位')
  assert.equal(TELEGRAM_CAPS.images, undefined, 'images 不是能力位')
  const canonical = new Set(Object.keys(CAPS))
  const outside = Object.keys(TELEGRAM_CAPS).filter((k) => !canonical.has(k))
  assert.deepEqual(outside, [], 'caps 里出现了不存在的规范能力位：' + outside.join(','))
  for (const [k, v] of Object.entries(TELEGRAM_CAPS)) assert.equal(typeof v, 'boolean', `caps.${k} 必须是布尔`)
})

test('超时 / 网络异常：错误带 uncertain（可能已发出，上层不能重发）', async () => {
  const fetchImpl = async () => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e }
  const { createTelegramChannel } = await import('../src/channels/telegram/index.js')
  const ch = createTelegramChannel({ getConfig: () => ({ platforms: { telegram: { token: 'x' } } }), log, fetchImpl })
  await assert.rejects(() => ch.send('telegram:private:1', [{ type: 'text', data: { text: 'hi' } }]), (error) => {
    assert.equal(error.uncertain, true, '网络/超时错误必须标 uncertain')
    return true
  })
})

test('Bot API 明确 4xx 拒绝：不带 uncertain（肯定没发出去，可以重发）', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ ok: false, description: 'chat not found' }) })
  const { createTelegramChannel } = await import('../src/channels/telegram/index.js')
  const ch = createTelegramChannel({ getConfig: () => ({ platforms: { telegram: { token: 'x' } } }), log, fetchImpl })
  await assert.rejects(() => ch.send('telegram:private:1', [{ type: 'text', data: { text: 'hi' } }]), (error) => {
    assert.match(error.message, /chat not found/)
    assert.ok(!error.uncertain, '4xx 是明确拒绝，不该标 uncertain')
    return true
  })
})

test('Bot API 5xx：带 uncertain（服务端可能已经处理）', async () => {
  const fetchImpl = async () => ({ ok: false, status: 502, json: async () => null })
  const { createTelegramChannel } = await import('../src/channels/telegram/index.js')
  const ch = createTelegramChannel({ getConfig: () => ({ platforms: { telegram: { token: 'x' } } }), log, fetchImpl })
  await assert.rejects(() => ch.send('telegram:private:1', [{ type: 'text', data: { text: 'hi' } }]), (error) => {
    assert.equal(error.uncertain, true, '5xx 标 uncertain')
    return true
  })
})

test('resetInbox 之后只处理新消息；dispose 后通道回到 stopped 并摘掉监听', async () => {
  const { createTelegramChannel } = await import('../src/channels/telegram/index.js')
  const nowSec = Math.floor(Date.now() / 1000)
  const updates = [
    { update_id: 1, message: { message_id: 11, date: nowSec - 600, chat: { id: 9, type: 'private' }, from: { id: 9 }, text: '很久以前' } },
    { update_id: 2, message: { message_id: 12, date: nowSec + 1, chat: { id: 9, type: 'private' }, from: { id: 9 }, text: '刚发的' } },
  ]
  let firstPoll = true
  // 第二次起模拟长轮询（真的等一下再返回），否则立即返回会让轮询变成热循环，把定时器饿死。
  const fetchImpl = async (url) => {
    if (String(url).includes('/getMe')) return { ok: true, status: 200, json: async () => ({ ok: true, result: { id: 7, username: 'bot' } }) }
    if (String(url).includes('/getUpdates')) {
      if (firstPoll) { firstPoll = false; return { ok: true, status: 200, json: async () => ({ ok: true, result: updates }) } }
      await new Promise((r) => setTimeout(r, 2000))
      return { ok: true, status: 200, json: async () => ({ ok: true, result: [] }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) }
  }
  const ch = createTelegramChannel({ getConfig: () => ({ enabled: true, platforms: { telegram: { enabled: true, token: 'x' } } }), log, fetchImpl })
  assert.equal(typeof ch.resetInbox, 'function', '通道要提供 resetInbox（host 换号时会调）')
  assert.equal(typeof ch.dispose, 'function', '通道要提供 dispose（manager 关闭时会优先用它）')
  const seen = []
  ch.on((e) => { if (e.type === 'message') seen.push(e.msg.text) })
  ch.resetInbox()
  await ch.start()
  const deadline = Date.now() + 1500
  while (!seen.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25))
  ch.dispose()
  assert.deepEqual(seen, ['刚发的'], 'resetInbox 之后旧消息要丢掉、新消息照常处理')
  assert.equal(ch.state(), 'stopped')
})
