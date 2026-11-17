// 人设块前置：宿主维护插件把注入放最前时，aurabot 的人设仍回到 system 最前。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PERSONA_START, PERSONA_END, hoistPersonaBlock, splitPersonaBlock, rewriteRequestPersona, installPersonaHoist,
} from '../src/integration/persona-hoist.js'

const PERSONA = '你是大肥鱼，一只有点懒但心软的鲸鱼。'
const BLOCK = `${PERSONA}\n\n【身份锁定】身份只以人格卡为准。`
const INJECT = 'PRIME DIRECTIVE: 宿主维护插件的执行约束。'

test('split：只认成对标记，块内文字原样', () => {
  const text = `<!-- AURABOT:PERSONA:START -->\n${BLOCK}\n<!-- AURABOT:PERSONA:END -->`
  const parts = splitPersonaBlock(text)
  assert.equal(parts.block, BLOCK)
  assert.equal(parts.before, '')
  assert.equal(parts.after, '')
  assert.equal(splitPersonaBlock(`${PERSONA_START}\n没有结束`), null)
})

test('hoist：注入在前时，人设块搬到最前，标记消失', () => {
  const text = `${INJECT}\n\n<!-- AURABOT:PERSONA:START -->\n${BLOCK}\n<!-- AURABOT:PERSONA:END -->`
  const out = hoistPersonaBlock(text)
  assert.ok(out.startsWith(BLOCK), '人设必须在最前')
  assert.ok(out.indexOf(INJECT) > out.indexOf(BLOCK), '注入在人设之后')
  assert.ok(!out.includes(PERSONA_START) && !out.includes(PERSONA_END), '标记要移除')
})

test('hoist：没有标记时原样返回', () => {
  const text = `${INJECT}\n\n${PERSONA}`
  assert.equal(hoistPersonaBlock(text), text)
})

test('request：把 system 里的人设搬到第一条 system 最前，其他消息不动', () => {
  const system = { role: 'system', content: [{ type: 'text', text: `${INJECT}\n\n${PERSONA_START}\n${BLOCK}\n${PERSONA_END}` }] }
  const user = { role: 'user', content: [{ type: 'text', text: '你好' }] }
  const options = Object.freeze({ provider: 'fake', model: 'm', messages: Object.freeze([system, user]) })
  const out = rewriteRequestPersona(options)
  assert.notEqual(out, options, '重建请求')
  assert.equal(out.messages[1], user, '用户消息不动')
  const text = out.messages[0].content[0].text
  assert.ok(text.startsWith(BLOCK))
  assert.ok(!text.includes(PERSONA_START))
})


test('adapter：包 prepareCall/stream，不依赖 llm/stream 监听顺序', async () => {
  const seen = []
  const adapter = {
    async prepareCall() {
      return {
        stream(options) { seen.push(options); return 'prepared-stream' },
      }
    },
    stream(options) { seen.push(options); return 'direct-stream' },
  }
  const llm = { adapters: new Map([['fake', { adapter }]]) }
  const ctx = { on() { return () => {} } }
  const off = installPersonaHoist(ctx, { llm, isAurabotRequest: (o) => o.sessionId === 's1' })
  const text = `${INJECT}\n\n${PERSONA_START}\n${BLOCK}\n${PERSONA_END}`
  const call = await adapter.prepareCall('fake', 'm', undefined)
  assert.equal(call.stream({ sessionId: 's1', messages: [{ role: 'system', content: text }] }), 'prepared-stream')
  assert.ok(String(seen[0].messages[0].content).startsWith(BLOCK), 'prepareCall 路径要前置')
  assert.equal(adapter.stream({ sessionId: 's1', messages: [{ role: 'system', content: text }] }), 'direct-stream')
  assert.ok(String(seen[1].messages[0].content).startsWith(BLOCK), '直接 stream 路径要前置')
  adapter.stream({ sessionId: 'other', messages: [{ role: 'system', content: text }] })
  assert.ok(String(seen[2].messages[0].content).startsWith(INJECT), '非 aurabot 请求保持原样')
  off()
  assert.equal(adapter.stream({ sessionId: 's1', messages: [{ role: 'system', content: text }] }), 'direct-stream')
  assert.ok(String(seen[3].messages[0].content).startsWith(INJECT), '卸载后恢复原方法')
})


test('没有 llm.adapters 时明确告警，不静默失效', () => {
  const warns = []
  const off = installPersonaHoist({ on() { return () => {} } }, { log: { warn: (...args) => warns.push(args.join(' ')) } })
  assert.match(warns.join('\n'), /没有找到 llm\.adapters/)
  off()
})
