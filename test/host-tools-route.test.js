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
