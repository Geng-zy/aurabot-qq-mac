// 宿主全局工具的发现：RC.3 上四条路径都要能走通，且失败时要留痕（不能静默放宽权限）。
//
// 最脆的一条是「匹配宿主英文报错」——宿主改一个字就失效。所以把解析单独抽成
// parseKnownToolNames 并直接测；探测整体也测四种宿主形态。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { knownGlobalToolNames, hostMaintenanceToolNames, parseKnownToolNames, isHostMaintenanceTool } from '../src/integration/host-tools.js'

const rc3Message = 'tools.restrict() names unknown global tool "aurabot__probe__"; known global tools: purge_apply, purge_revert, purge_status, (none)'

const agent = (tools) => ({ ctx: { tools } })

test('优先用 view(agent).restrictableNames', () => {
  const names = knownGlobalToolNames(agent({ view: () => ({ restrictableNames: new Set(['purge_apply', 'other']) }) }))
  assert.deepEqual(names, ['purge_apply', 'other'])
})

test('restrictableNames 没了，退到 view(agent).knownNames', () => {
  const names = knownGlobalToolNames(agent({ view: () => ({ knownNames: new Set(['purge_status']) }) }))
  assert.deepEqual(names, ['purge_status'])
})

test('两个字段都没有：用探针触发报错，从文案里读名单', () => {
  const names = knownGlobalToolNames(agent({
    view: () => ({}),
    restrict: () => { throw new Error(rc3Message) },
  }))
  assert.deepEqual(names, ['purge_apply', 'purge_revert', 'purge_status'], '(none) 要过滤掉')
})

test('宿主接受了探针、又没给名单：返回 null（未知），不假装是空', () => {
  const names = knownGlobalToolNames(agent({ view: () => ({}), restrict: () => () => {} }))
  assert.equal(names, null)
})

test('报错文案认不出：返回 null，并留一条 debug（不刷 warn）', () => {
  const debugs = []
  const names = knownGlobalToolNames(agent({
    view: () => ({}),
    restrict: () => { throw new Error('some totally different failure') },
  }), { log: { warn() {}, debug: (...a) => debugs.push(a.join(' ')) } })
  assert.equal(names, null)
  assert.equal(debugs.length, 1)
  assert.match(debugs[0], /认不出宿主报错/)
})

test('parseKnownToolNames 容忍引号、中文冒号与多种分隔符', () => {
  assert.deepEqual(parseKnownToolNames('known global tools: "purge_a", "purge_b"'), ['purge_a', 'purge_b'])
  assert.deepEqual(parseKnownToolNames('已知工具 known global tool：purge_x，purge_y'), ['purge_x', 'purge_y'])
  assert.deepEqual(parseKnownToolNames('known global tools: (none)'), [], '(none) 解析成空名单，不是 null')
})

test('hostMaintenanceToolNames：只挑 purge_ 前缀并排序', () => {
  const names = hostMaintenanceToolNames(agent({ view: () => ({ restrictableNames: new Set(['purge_status', 'other', 'purge_apply']) }) }))
  assert.deepEqual(names, ['purge_apply', 'purge_status'])
})

test('hostMaintenanceToolNames：探测失败返回空表，并留 debug（这个路径每挂载一次都会走，不能刷 warn）', () => {
  const debugs = []
  const warns = []
  const names = hostMaintenanceToolNames(agent({ view: () => ({}), restrict: () => () => {} }), {
    log: { warn: (...a) => warns.push(a.join(' ')), debug: (...a) => debugs.push(a.join(' ')) },
  })
  assert.deepEqual(names, [])
  assert.ok(debugs.some((d) => /不对维护工具做收窄/.test(d)), '要留一条 debug 说明这次放宽')
  assert.equal(warns.length, 0, '不要在每轮挂载时刷 warn')
})

test('isHostMaintenanceTool 只认 purge_ 前缀', () => {
  assert.equal(isHostMaintenanceTool('purge_apply'), true)
  assert.equal(isHostMaintenanceTool('other_tool'), false)
  assert.equal(isHostMaintenanceTool(undefined), false)
})
