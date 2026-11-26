// hub 里搬出来的纯函数：这类东西以前只能通过整条消息链路间接验证。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IMAGE_SOURCE_PREFIX, flatHistory, keyOf, withoutImageBlocks } from '../src/chat/hub-pure.js'

test('withoutImageBlocks：只留指定那张图，来源标记跟着图一起留或删', () => {
  const keep = { type: 'image', url: 'keep.png' }
  const other = { type: 'image', url: 'other.png' }
  const content = [
    { type: 'text', text: '看看这个' },
    { type: 'text', text: IMAGE_SOURCE_PREFIX + '老张' }, keep,
    { type: 'text', text: IMAGE_SOURCE_PREFIX + '小明' }, other,
    { type: 'text', text: '还有呢' },
  ]
  const out = withoutImageBlocks(content, keep)
  assert.equal(out.filter((p) => p.type === 'image').length, 1)
  assert.equal(out.find((p) => p.type === 'image'), keep)
  assert.deepEqual(out.filter((p) => p.type === 'text').map((p) => p.text),
    ['看看这个', IMAGE_SOURCE_PREFIX + '老张', '还有呢'], '小明那条标记要跟着他的图一起消失')
})

test('withoutImageBlocks：没有图时原样返回', () => {
  const content = [{ type: 'text', text: IMAGE_SOURCE_PREFIX + '某人' }]
  assert.deepEqual(withoutImageBlocks(content, null), content, '标记后面没有图，标记本身也算无害')
})

test('keyOf：没有模型时是空串，档位变化会换键', () => {
  assert.equal(keyOf(null), '')
  assert.equal(keyOf({ provider: 'p', model: 'm' }), 'p::m::')
  assert.notEqual(keyOf({ provider: 'p', model: 'm', reasoningEffort: 'high' }), keyOf({ provider: 'p', model: 'm' }))
})

test('flatHistory：谁说了什么，单条截断并合并空白', () => {
  const list = [
    { sender: { user_id: 1, card: '老张' }, message: '  上周说好\n去吃火锅 ' },
    { sender: { user_id: 2, nickname: '小明' }, message: [{ type: 'text', data: { text: '好呀' } }, { type: 'image' }] },
    { user_id: 3, message: [{ type: 'face' }, { type: 'text', data: { text: '表情' } }] },
    { sender: { user_id: 4 }, message: 'x'.repeat(200) },
  ]
  const out = flatHistory(list, () => true)
  assert.deepEqual(out.slice(0, 3), ['老张：上周说好 去吃火锅', '小明：好呀[图片]', '3：[表情]表情'])
  assert.ok(out[3].endsWith('：' + 'x'.repeat(120)), '第 4 条要截到 120 字')
})

test('flatHistory：允许发送者过滤，非数组输入不炸', () => {
  const list = [{ sender: { user_id: 1 }, message: 'a' }, { sender: { user_id: 9 }, message: 'b' }]
  assert.deepEqual(flatHistory(list, (id) => id === '1'), ['1：a'])
  assert.deepEqual(flatHistory(null, () => true), [])
})
