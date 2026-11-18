// 外置后的回归：旧模块路径、桌宠专用页面、STABLE_ROUTES 都不能再回到核心。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const shims = [
  'src/modules/qq-api/index.js',
  'src/modules/qq-api/actions.js',
  'src/modules/qq-tools/index.js',
  'src/modules/qzone-social/index.js',
  'src/features/qzone-social.js',
]

test('旧模块路径 shim 已删除，迁移必须改新路径', () => {
  for (const file of shims) assert.equal(existsSync(file), false, `${file} 不能再保留 re-export`)
})

test('核心客户端不再包含桌宠 / 抖音 / 小黑盒专用页面', () => {
  const src = readFileSync('client/client.js', 'utf8')
  for (const name of ['PetPanel', 'PetRemote', 'PetPage', 'function Douyin', 'function Heybox']) {
    assert.equal(src.includes(name), false, `client.js 不应再有 ${name}`)
  }
  assert.equal(src.includes('/panel/pet'), false, 'client.js 不应再调用桌宠专用面板路由')
})

test('STABLE_ROUTES 不再存在，社区模块统一走 /ext', () => {
  const src = readFileSync('src/core/modules.js', 'utf8')
  assert.equal(src.includes('STABLE_ROUTES'), false)
  assert.match(src, /routesAtRoot\s*=\s*\(id\)\s*=>\s*builtinDefs\.has\(id\)/)
})
