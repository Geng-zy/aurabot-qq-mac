// 回归：一轮结束时只发最后一条 assistant 消息的文字；带工具调用的过程性发言不能当回复补发。
// 否则模型在调工具前写的计划/心里话（例如「我先想想怎么回」）会被原样发到 QQ。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assistantReplyText } from '../src/chat/hub.js'
import { extractReply, guardReply } from '../src/chat/output-guard.js'
import { parseReply } from '../src/chat/reply.js'

const msg = (content) => ({ content })

test('只取 text 块：reasoning 块不外发', () => {
  assert.equal(assistantReplyText(msg([{ type: 'reasoning', text: '心里想：先哄一下' }, { type: 'text', text: '嗯 好' }])), '嗯 好')
})

test('带工具调用的过程性发言不算回复', () => {
  assert.equal(assistantReplyText(msg([{ type: 'text', text: '我先想想怎么回' }, { type: 'tool-call', name: 'x', arguments: '{}' }])), '')
  assert.equal(assistantReplyText(msg([{ type: 'tool_use', name: 'x' }])), '')
})

test('空消息 / 空文字返回空（宁可沉默，不拿上一条补）', () => {
  assert.equal(assistantReplyText(null), '')
  assert.equal(assistantReplyText({}), '')
  assert.equal(assistantReplyText(msg([])), '')
  assert.equal(assistantReplyText(msg([{ type: 'text', text: '   ' }])), '')
})

test('多个 text 块按行拼接', () => {
  assert.equal(assistantReplyText(msg([{ type: 'text', text: '第一行' }, { type: 'text', text: '第二行' }])), '第一行\n第二行')
})

test('防漏只滤思考，保留代码、缩进和里面的字面动作', () => {
  const code = '```sh\n    echo "||| <poke> m00012"\n    echo done\n```'
  const raw = 'I could react with a laugh line. One line.这样运行：\n' + code
  const clean = guardReply(raw)
  assert.equal(clean, '这样运行：\n' + code)
  const { items } = parseReply(clean)
  assert.ok(items.some((item) => item.value === code && item.code))
  assert.ok(!items.some((item) => item.kind === 'poke'))
  assert.equal(guardReply('NSFW image + 筹集 joke. Not addressed to me. Silence.[沉默]'), '[沉默]')
  assert.equal(guardReply('草稿：先解释一下她的想法'), '')
  assert.equal(guardReply('这条要分两步执行。'), '这条要分两步执行。')
  assert.equal(guardReply('There is one line missing. The silence was peaceful.'), 'There is one line missing. The silence was peaceful.')
})

test('严格标记只取最后一组完整正文，代码里的示例不是标记', () => {
  assert.equal(extractReply('草稿 ⟦REPLY⟧旧话⟦/REPLY⟧\n备注【REPLY】新话【/REPLY】'), '新话')
  assert.equal(extractReply('⟦REPLY⟧这句没有结尾'), null)
  assert.equal(extractReply('```txt\n⟦REPLY⟧示例⟦/REPLY⟧\n```'), null)
})
