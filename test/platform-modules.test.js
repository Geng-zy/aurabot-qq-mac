// QQ 专属模块声明平台：没有 QQ 连接时不应被启动；测试环境没有 channels 时保持兼容。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QQ_FEATURES } from '../src/channels/qq/features/index.js'

test('QQ 专属 feature 声明 platforms: qq', () => {
  assert.ok(QQ_FEATURES.length >= 1)
  for (const def of QQ_FEATURES) assert.deepEqual(def.platforms, ['qq'])
})
