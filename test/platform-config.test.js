// 平台配置的迁移：旧 snowluma 字段继续可用，新代码从 platforms.qq 读；两边同步。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalize, publicConfig } from '../src/core/config.js'

test('旧 snowluma 配置迁移到 platforms.qq，并保持双向同步', () => {
  const c = normalize({ snowluma: { wsUrl: 'ws://127.0.0.1:3001', wsToken: 'SECRET' } })
  assert.equal(c.platforms.qq.wsUrl, 'ws://127.0.0.1:3001')
  assert.equal(c.platforms.qq.wsToken, 'SECRET')
  assert.equal(c.snowluma.wsUrl, c.platforms.qq.wsUrl)
  const pub = publicConfig(c)
  assert.equal(pub.platforms.qq.wsToken, '')
  assert.equal(pub.platforms.qq.wsTokenSet, true)
})

test('新 platforms.qq 配置会回填旧 snowluma 字段', () => {
  const c = normalize({ platforms: { qq: { wsUrl: 'ws://new:3001', wsToken: 'NEW' } } })
  assert.equal(c.snowluma.wsUrl, 'ws://new:3001')
  assert.equal(c.snowluma.wsToken, 'NEW')
})
