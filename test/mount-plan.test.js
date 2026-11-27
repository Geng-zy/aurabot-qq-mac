// 会话挂载决策的直测（chat/mount-plan.js）。
//
// 这段规则以前埋在 mount() 中间，要验证得造真 agent、真宿主工具服务、真配置。
// 现在它只收事实、只返回结果：收窄条件、指纹构成、豁免边界都能逐条钉住。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planMount } from '../src/chat/mount-plan.js'

const PURGE = ['purge_apply', 'purge_revert', 'purge_status']

test('管理员私聊 + 完整权限 + 配置也是 full：豁免收窄', () => {
  const p = planMount({ chatKind: 'private', level: 'full', groupLevel: 'full', botQQ: '20000002', ownerRevision: 'rev-1', detected: PURGE })
  assert.equal(p.ownerMaintenance, true)
  assert.deepEqual(p.denyMaintenance, [])
  assert.equal(p.maintenanceKey, 'owner:20000002:rev-1')
})

test('三者缺一就不豁免：群聊、级别不够、配置级别不够', () => {
  const cases = [
    { chatKind: 'group', level: 'full', groupLevel: 'full' },
    { chatKind: 'private', level: 'chat', groupLevel: 'full' },
    { chatKind: 'private', level: 'full', groupLevel: 'social' },
    { chatKind: 'system', level: 'full', groupLevel: 'full' },
  ]
  for (const c of cases) {
    const p = planMount({ ...c, detected: PURGE })
    assert.equal(p.ownerMaintenance, false, JSON.stringify(c))
    assert.deepEqual(p.denyMaintenance, PURGE, JSON.stringify(c))
  }
})

test('收窄名单是探测结果的副本：调用方后续改动不串味', () => {
  const detected = [...PURGE]
  const p = planMount({ chatKind: 'group', level: 'chat', groupLevel: 'chat', detected })
  detected.push('late')
  assert.deepEqual(p.denyMaintenance, PURGE)
})

test('指纹：工具名排序无关、被禁工具/收窄结果/代际变化都会换键', () => {
  const base = { chatKind: 'group', level: 'chat', groupLevel: 'chat', detected: PURGE }
  const a = planMount({ ...base, toolNames: ['b', 'a'], generation: 0 })
  const sameNames = planMount({ ...base, toolNames: ['a', 'b'], generation: 0 })
  assert.equal(a.key, sameNames.key, '工具顺序不该影响指纹')
  assert.notEqual(a.key, planMount({ ...base, toolNames: ['a', 'b'], generation: 1 }).key, '代际变了要重挂')
  assert.notEqual(a.key, planMount({ ...base, toolNames: ['a'], generation: 0 }).key, '工具多了少了要重挂')
  assert.notEqual(a.key, planMount({ ...base, toolNames: ['a', 'b'], denied: ['x'], generation: 0 }).key, '被禁工具变了要重挂')
  assert.notEqual(a.key, planMount({ ...base, detected: ['purge_apply'], toolNames: ['a', 'b'], generation: 0 }).key, '收窄结果变了要重挂')
})

test('管理员换了（授权版本变）必须换键：旧会话不能继续拿维护工具', () => {
  const base = { chatKind: 'private', level: 'full', groupLevel: 'full', botQQ: '1', toolNames: [] }
  const before = planMount({ ...base, ownerRevision: 'rev-1' })
  const after = planMount({ ...base, ownerRevision: 'rev-2' })
  assert.notEqual(before.key, after.key)
})

test('什么信息都没给也不炸：按“不豁免”处理', () => {
  const p = planMount({})
  assert.equal(p.ownerMaintenance, false)
  assert.deepEqual(p.denyMaintenance, [])
  assert.equal(p.key, '|||gen:0')
})
