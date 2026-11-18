// 默认人格卡要和当前插件一致：真人语感、没有已删除的外部模块、没有旧角色称呼。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const text = readFileSync(new URL('../personas/dafeiyu.md', import.meta.url), 'utf8')

test('默认人格卡保留真人语感和例子', () => {
  assert.match(text, /你是大肥鱼/)
  assert.match(text, /【像真人打字的例子】/)
  assert.match(text, /这句话稳/)
  assert.match(text, /不要客服腔/)
  assert.match(text, /不要每轮都提问/)
})

test('默认人格卡不包含已删除的外部模块和旧称呼', () => {
  assert.doesNotMatch(text, /桌宠|抖音|小黑盒|douyin|heybox/)
  assert.equal(text.includes('\u4e3b\u4eba'), false)
  assert.doesNotMatch(text, /作为一个?AI|语言模型/)
})
