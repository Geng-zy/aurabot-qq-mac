// 能力位（caps）是给调用方的承诺：说了能做，就必须真有对应方法。
// 反例抓过一次：QQ 的 caps.recall 一直是 true，但连接上根本没有 recall 方法。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateChannel, CAP_METHODS } from '../src/channels/index.js'
import { createQqAdapter } from '../src/channels/qq/adapter.js'
import { createTelegramAdapter } from '../src/channels/telegram/index.js'

const log = { info() {}, warn() {}, debug() {}, error() {}, child() { return this } }
const qqCfg = () => ({ snowluma: {}, platforms: { qq: {} } })
const tgCfg = () => ({ platforms: { telegram: {} } })

test('QQ 适配器通过契约校验：声明支持的能力都有实现', () => {
  const ch = createQqAdapter({ getConfig: qqCfg, log })
  assert.doesNotThrow(() => validateChannel(ch))
})

test('Telegram 适配器通过契约校验：没声明的能力不要求实现', () => {
  const ch = createTelegramAdapter({ getConfig: tgCfg, log })
  assert.doesNotThrow(() => validateChannel(ch))
})

test('声明了 recall 却没实现 recall：注册时就要报错', () => {
  const ch = { platform: 'qq', start() {}, stop() {}, send() {}, on() {}, ready() {}, caps: { recall: true } }
  assert.throws(() => validateChannel(ch), /caps\.recall 说支持，但连接缺 recall/)
})

test('caps 里的每个能力都对应真实存在的方法名（QQ）', () => {
  const ch = createQqAdapter({ getConfig: qqCfg, log })
  const bad = []
  for (const [cap, methods] of Object.entries(CAP_METHODS)) {
    if (ch.caps[cap] !== true) continue
    for (const m of methods) if (typeof ch[m] !== 'function') bad.push(`${cap} → ${m}`)
  }
  assert.deepEqual(bad, [])
})

test('QQ 的 recall 真的会调 delete_msg（actions 是它的实现处）', async () => {
  const { createActionsApi } = await import('../src/channels/qq/features/actions.js')
  const calls = []
  const api = createActionsApi({
    call: async (action, params) => { calls.push([action, params]); return { ok: true } },
    targetOf: () => ({ kind: 'private', id: '1' }),
  })
  await api.recall('12345')
  assert.deepEqual(calls[0], ['delete_msg', { message_id: 12345 }])
  await assert.rejects(() => api.recall('abc'), /消息编号/)
})
