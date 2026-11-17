// 架构契约：宿主维护插件的接缝只在 src/integration/ 里实现，
// hub 不再自己识别 purge_*，避免又长回一个 4000 行的 all-in-one。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('hub 不再持有 purge 专用识别与工具名探测', () => {
  const hub = read('src/chat/hub.js')
  assert.ok(!hub.includes('isPurgeTool'), 'purge 专用判断应留在 integration')
  assert.ok(!hub.includes('purgeToolNames'), '工具名探测应复用 integration/host-tools')
  assert.ok(!hub.includes('GROUP_GUEST_SAFE'), '访客白名单应留在 chat/tool-scope')
  assert.ok(hub.includes('purgeScope.toolNames(agent)'), 'hub 应通过接缝取维护工具名')
  assert.ok(hub.includes('toolScope.restrictGuest(agent)'), 'hub 应通过会话工具闸收工具')
})

test('host 只负责接线：创建接缝、安装身份锁定、传给 hub', () => {
  const host = read('src/host.js')
  assert.ok(host.includes("createPurgeScope({ log: logger.child('purge') })"))
  assert.ok(host.includes('purge.installPromptGuard(ctx'), '身份锁定要在宿主上挂一次')
  assert.ok(host.includes('purge,'), '同一个接缝实例要传给 hub')
})

test('integration 不反向依赖聊天中枢，保持可单测', () => {
  for (const file of ['src/integration/purge-scope.js', 'src/integration/host-tools.js']) {
    const text = read(file)
    assert.ok(!text.includes("../chat/hub.js"), `${file} 不应 import hub`)
    assert.ok(!text.includes('createHub'), `${file} 不应创建 hub`)
  }
})

test('身份锁定走 persona 变量，四个大肥鱼预设都带上', () => {
  const yml = read('cordis.patch.yml')
  const occurrences = (yml.match(/\{\{aurabot_identity_lock\}\}/g) || []).length
  assert.equal(occurrences, 4, 'private / private-long / social / group-owner 都要带身份锁定')
  assert.equal((yml.match(/AURABOT:PERSONA:START/g) || []).length, 4, '四个预设都要有人设前置标记')
  assert.equal((yml.match(/AURABOT:PERSONA:END/g) || []).length, 4, '四个预设都要有人设前置结束标记')
  const hoist = read('src/integration/persona-hoist.js')
  assert.ok(hoist.includes('PERSONA_START') && hoist.includes('rewriteRequestPersona'), '请求出口要有人设前置')
  const vars = read('src/host/prompt-vars.js')
  assert.ok(vars.includes("variable('aurabot_identity_lock'"), 'host 要注册身份锁定变量')
  assert.ok(vars.includes('IDENTITY_LOCK_TEXT'), '变量内容要来自 integration 的唯一文案')
})

test('旧的宿主维护工具逻辑只剩一份实现', () => {
  const files = ['src/chat/hub.js', 'src/chat/tool-scope.js', 'src/integration/host-tools.js', 'src/integration/purge-scope.js']
  const hits = files.map((file) => [file, (read(file).match(/knownGlobalToolNames|knownGlobalNames/g) || []).length])
  const total = hits.reduce((sum, [, n]) => sum + n, 0)
  assert.ok(total >= 1, '至少要有一次工具名发现')
  assert.ok(!read('src/chat/hub.js').includes('knownGlobalNames(agent)'), 'hub 里不应再有第二份探测')
})
