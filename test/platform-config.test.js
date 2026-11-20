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

test('平台页编辑优先，旧面板顶层编辑也不会被旧镜像覆盖', async () => {
  const { reconcilePlatformAliases, mergeFromPanel, normalize } = await import('../src/core/config.js')
  const prev = { ownerQQ: '1', botQQ: '2', allow: { private: ['3'], groups: [] }, drawAllow: { private: ['3'], groups: [] }, platforms: { qq: { ownerQQ: '1', botQQ: '2', allow: { private: ['3'], groups: [] }, drawAllow: { private: ['3'], groups: [] } } } }
  const viaPlatform = reconcilePlatformAliases({ ...prev, platforms: { qq: { ...prev.platforms.qq, ownerQQ: '4', allow: { private: ['5'], groups: [] } } } }, prev)
  assert.equal(viaPlatform.ownerQQ, '4')
  assert.deepEqual(viaPlatform.allow, { private: ['5'], groups: [] })
  const viaTop = reconcilePlatformAliases({ ...prev, ownerQQ: '6', allow: { private: ['7'], groups: [] } }, prev)
  assert.equal(viaTop.ownerQQ, '6')
  assert.deepEqual(viaTop.allow, { private: ['7'], groups: [] })
  const viaDraw = reconcilePlatformAliases({ ...prev, platforms: { qq: { ...prev.platforms.qq, drawAllow: { private: ['8'], groups: [] } } } }, prev)
  assert.deepEqual(viaDraw.drawAllow, { private: ['8'], groups: [] })
  const merged = mergeFromPanel(normalize({ ...prev, allow: { private: [], groups: [] } }), { platforms: { qq: { botQQ: '9' } } })
  assert.equal(merged.botQQ, '9')
})

test('非 QQ 平台不继承 QQ 管理员号和白名单', async () => {
  const { checkAllowed, isOwner } = await import('../src/chat/access.js')
  const c = normalize({ ownerQQ: '10001', allow: { private: ['10002'], groups: ['12345'] }, platforms: { telegram: { enabled: true, token: 'T' } } })
  assert.equal(checkAllowed(c, { kind: 'private', chatId: 'telegram:private:10001', userId: '10001' }).allowed, false)
  assert.equal(isOwner(c, '10001', 'telegram:private:10001'), false)
  assert.equal(checkAllowed(c, { kind: 'private', chatId: 'telegram:private:10002', userId: '10002' }).allowed, false)
  assert.equal(checkAllowed(c, { kind: 'group', chatId: 'telegram:group:-12345', groupId: '-12345' }).allowed, false)
  assert.equal(checkAllowed(c, { kind: 'private', chatId: 'qq:private:10001', userId: '10001' }).allowed, true)
})

test('未运行模块的 password 设置也不回传明文', () => {
  const c = normalize({ ext: { weather: { apiKey: 'SUPERSECRET', city: '北京' } } })
  const pub = publicConfig(c)
  assert.equal(pub.ext.weather.apiKey, '')
  assert.equal(pub.ext.weather.apiKeySet, true)
  assert.equal(pub.ext.weather.city, '北京')
})
