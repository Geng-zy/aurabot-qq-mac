// /aurabot/api/host/tools：只读取证接口。它不能改任何宿主状态，也要能在没有会话时回答。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHostRoutes } from '../src/features/host-routes.js'
import { lastDetection, recordDetection } from '../src/integration/host-tools.js'

function mount(ctx) {
  const routes = new Map()
  registerHostRoutes({ route: (path, fn) => routes.set(path, fn), ctx })
  return routes
}

test('返回全局探测结果与维护工具清单', async () => {
  const routes = mount({ tools: { view: () => ({ restrictableNames: new Set(['purge_apply', 'purge_revert', 'other']) }) } })
  const r = await routes.get('/host/tools')()
  assert.equal(r.ok, true)
  assert.equal(r.prefix, 'purge_')
  assert.equal(r.probe.view, 'ok')
  assert.deepEqual(r.probeMaintenance, ['purge_apply', 'purge_revert'])
})

test('宿主没有 tools 服务时：ok=false 的降级由 probe 表达，不抛错', async () => {
  const routes = mount({})
  const r = await routes.get('/host/tools')()
  assert.equal(r.ok, true)
  assert.equal(r.probe.view, 'none')
  assert.deepEqual(r.probeMaintenance, [])
})

test('宿主没注入 tools：读属性会抛，路由要如实报 none 而不是把异常抛给面板', async () => {
  const boom = { get tools() { throw new Error('cannot get property "tools" without inject') } }
  const r = await mount(boom).get('/host/tools')()
  assert.equal(r.ok, true)
  assert.equal(r.probe.view, 'none')
  assert.match(r.probe.error, /without inject/)
  assert.deepEqual(r.probeMaintenance, [])
})

test('带出最近一次挂载的记录（没有挂载过就是 null）', async () => {
  recordDetection({ source: 'knownNames', names: ['purge_status'], chatId: 'qq:private:9', sessionId: 's-9' })
  const r = await mount({ tools: { view: () => ({}) } }).get('/host/tools')()
  assert.equal(r.last.source, 'knownNames')
  assert.deepEqual(r.last.names, ['purge_status'])
  assert.equal(r.last.chatId, 'qq:private:9')
  assert.equal(lastDetection().sessionId, 's-9')
})

test('/host/mount-plan：没有挂载记录时用全局探测兜底（不能因为 last 为空就报错/不收窄）', async () => {
  // 这条正是真机上踩到的：probeGlobalTools 返回的是对象，直接当数组用会抛 filter is not a function。
  recordDetection({ source: 'unknown', names: null, chatId: '', sessionId: '' })
  const routes = new Map()
  registerHostRoutes({
    route: (path, fn) => routes.set(path, fn),
    ctx: { tools: { view: () => ({ restrictableNames: new Set(['purge_apply', 'purge_status', 'other']) }) } },
    getConfig: () => ({ ownerQQ: '10000001', allow: { private: ['10000001'], groups: ['555'] } }),
  })
  const r = await routes.get('/host/mount-plan')({ url: '/host/mount-plan?chat=qq:group:555&level=chat' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.detected, ['purge_apply', 'purge_status'], '应当从全局探测里取到维护工具')
  assert.deepEqual(r.plan.denyMaintenance, ['purge_apply', 'purge_status'])
})

test('/host/mount-plan：群聊会被收窄、管理员私聊豁免（只读，不改任何状态）', async () => {
  const routes = new Map()
  registerHostRoutes({
    route: (path, fn) => routes.set(path, fn),
    ctx: {},
    getConfig: () => ({ ownerQQ: '10000001', allow: { private: ['10000001'], groups: ['555'] }, group: { level: 'chat' } }),
  })
  const plan = routes.get('/host/mount-plan')
  const group = await plan({ url: '/host/mount-plan?chat=qq:group:555&level=chat' })
  assert.equal(group.ok, true)
  assert.equal(group.chat.kind, 'group')
  assert.equal(group.plan.ownerMaintenance, false)
  // 群聊必须真的把这批维护工具收窄进去（否则「收窄」只是名义上的）
  assert.deepEqual(group.plan.denyMaintenance, group.detected.filter((n) => n.startsWith('purge_')))

  // 管理员私聊 full：字段要从 chatId 还原出来，否则 levelFor 会把管理员本人也判成没权限
  const owner = await plan({ url: '/host/mount-plan?chat=qq:private:10000001&level=full' })
  assert.equal(owner.chat.kind, 'private')
  assert.equal(owner.plan.ownerMaintenance, true, '私聊 owner + full + 配置 full 应当豁免收窄')
  assert.deepEqual(owner.plan.denyMaintenance, [])

  const bad = await plan({ url: '/host/mount-plan' })
  assert.equal(bad.ok, false)
})
