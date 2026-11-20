// UI 结构契约：人格卡与自我合并，设置按用途分组，旧 character 书签仍能落到新页。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
const params = readFileSync(new URL('../src/mind/params.js', import.meta.url), 'utf8')

test('人格卡与自我合并成一个入口，旧 character 页自动落到 selfmind', () => {
  assert.match(source, /id: 'selfmind', label: '人格与自我'/)
  assert.doesNotMatch(source, /id: 'character', label: '人格卡'/)
  assert.match(source, /function Identity\(/)
  assert.match(source, /id === 'character'\) id = 'selfmind'/)
})

test('平台入口统一，QQ 页面收进平台分组', () => {
  assert.match(source, /id: 'platforms', label: '平台'/)
  assert.match(source, /function Platforms/)
  assert.match(source, /id: 'qq', label: 'QQ'/)
  assert.match(source, /function QqPlatform/)
  assert.doesNotMatch(source, /id: 'qq', label: 'QQ 会话'/)
})

test('设置按模型、预算、本地模型和会话分开', () => {
  assert.match(params, /id: 'models', label: '模型与思考'/)
  assert.match(params, /id: 'budget', label: '后台与预算'/)
  assert.match(params, /id: 'local', label: '本地模型'/)
  assert.match(params, /id: 'session', label: '会话与上下文'/)
})
