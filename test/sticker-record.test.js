// 回归：发出去的表情在聊天流水里必须带名字，不能只剩 [sticker] 占位。
// 否则她事后查不出自己发的是哪一张——被说「乱贴表情」时连自查都做不到。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deliveredItems, itemsToLine } from '../src/chat/reply.js'

const STICKER = { name: '让我看看内鬼是谁', md5: 'd8c18f33aabbccdd' }

test('表情项带对象名字时写名字，前后文字照旧', () => {
  const said = itemsToLine([
    { kind: 'text', value: '三条我都服。' },
    { kind: 'sticker', value: STICKER },
    { kind: 'text', value: '第 3 条才是真正问到点上的' }
  ])
  assert.equal(said, '三条我都服。 [表情：让我看看内鬼是谁] 第 3 条才是真正问到点上的')
})

test('表情项是 <sticker:标签> 里的标签时，用解析器换回名字', () => {
  const said = itemsToLine([{ kind: 'sticker', value: '内鬼' }], (q) => (q === '内鬼' ? STICKER : null))
  assert.equal(said, '[表情：让我看看内鬼是谁]')
})

test('解析不出名字时退回 md5 前 8 位，别退成 [sticker]', () => {
  assert.equal(itemsToLine([{ kind: 'sticker', value: { md5: 'abcdef123456' } }]), '[表情：abcdef12]')
})

test('彻底取不到任何信息时仍是 [表情]，不写 [sticker]', () => {
  assert.equal(itemsToLine([{ kind: 'sticker', value: '查无此表情' }]), '[表情]')
})

test('文字与语音原样、其它类型保持旧写法', () => {
  const said = itemsToLine([
    { kind: 'text', value: '嗯' },
    { kind: 'voice', value: '我在呢' },
    { kind: 'image', value: 'a.png' },
    { kind: 'poke', value: '' }
  ])
  assert.equal(said, '嗯 我在呢 [image] [poke]')
})

test('流水按确认的消息内容识别商城表情和被钩子替换的普通图片', () => {
  const segment = { type: 'image', data: { emoji_id: 'abc', emoji_package_id: '1' } }
  const sticker = { item: STICKER, segment }
  assert.equal(itemsToLine(deliveredItems([segment], { sticker })), '[表情：让我看看内鬼是谁]')
  assert.equal(itemsToLine(deliveredItems([{ type: 'image', data: { file: '画稿.jpg' } }], { sticker })), '[image]')
})
