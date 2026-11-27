// B17：把「维护工具发现在真机上走了哪条路」变成可观测的。
//
// 之前四条路径只有单测：真机上命中哪条、认出了谁，运行时没人能回答（探测悄悄失效 = 静默放宽权限）。
// 这里测三件事：来源标注、挂载时记录上下文、只读探测接口不依赖会话。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeDiscovery, hostMaintenanceToolNames, lastDetection, probeGlobalTools, recordDetection,
} from '../src/integration/host-tools.js'

const agent = (tools) => ({ ctx: { tools } })

test('describeDiscovery 给每条路径都标上来源', () => {
  assert.equal(describeDiscovery(agent({ view: () => ({ restrictableNames: new Set(['a']) }) })).source, 'restrictableNames')
  assert.equal(describeDiscovery(agent({ view: () => ({ knownNames: new Set(['a']) }) })).source, 'knownNames')
  const probe = describeDiscovery(agent({
    view: () => ({}),
    restrict: () => { throw new Error('tools.restrict() names unknown global tool "x"; known global tools: purge_apply, purge_revert') },
  }))
  assert.equal(probe.source, 'probe')
  assert.deepEqual(probe.names, ['purge_apply', 'purge_revert'])
  assert.equal(describeDiscovery(agent({ view: () => ({}), restrict: () => () => {} })).source, 'unknown')
})

test('挂载时记录：来源 + 认出的工具 + 会话上下文', () => {
  const names = hostMaintenanceToolNames(
    agent({ view: () => ({ restrictableNames: new Set(['purge_apply', 'purge_status', 'other_tool']) }) }),
    { chatId: 'qq:private:1', sessionId: 's-1' },
  )
  assert.deepEqual(names, ['purge_apply', 'purge_status'])
  const last = lastDetection()
  assert.equal(last.source, 'restrictableNames')
  assert.deepEqual(last.names, ['purge_apply', 'purge_status'])
  assert.equal(last.chatId, 'qq:private:1')
  assert.equal(last.sessionId, 's-1')
  assert.equal(typeof last.at, 'number')
})

test('探测失败也留痕：来源 unknown 且 names 为 null（不是空数组）', () => {
  hostMaintenanceToolNames(agent({ view: () => ({}), restrict: () => () => {} }), { chatId: 'qq:group:2' })
  const last = lastDetection()
  assert.equal(last.source, 'unknown')
  assert.equal(last.names, null, 'null 表示「不知道」，空数组表示「确实没有」——不能混')
})

test('probeGlobalTools：全局视图可直接问，不需要会话', () => {
  const ok = probeGlobalTools({ view: () => ({ restrictableNames: new Set(['purge_apply']), knownNames: new Set(['purge_apply', 'x']) }) })
  assert.equal(ok.view, 'ok')
  assert.deepEqual(ok.restrictableNames, ['purge_apply'])
  assert.deepEqual(ok.knownNames, ['purge_apply', 'x'])
  const broken = probeGlobalTools({ view: () => { throw new Error('boom') } })
  assert.equal(broken.view, 'none')
  assert.match(broken.error, /boom/)
  assert.deepEqual(probeGlobalTools(undefined), { view: 'none', restrictableNames: null, knownNames: null, error: '' })
})

test('recordDetection 可被显式写入（面板自检用），lastDetection 读得到', () => {
  recordDetection({ source: 'definitions', names: ['purge_apply'], chatId: '', sessionId: '' })
  assert.equal(lastDetection().source, 'definitions')
})
