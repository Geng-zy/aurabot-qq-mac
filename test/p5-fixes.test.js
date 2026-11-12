// 三处小修：系统会话标题不重复拼「QQ · 」；被归档的会话先解归档接着用；人格规则改成「一条两三句」。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFakeDsh } from './helpers/fake-dsh.js'

const renamed = []
let fake
let api
let dataDir

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'aurabot-p5-'))
  process.env.AURABOT_DATA_DIR = dataDir
  process.env.AURABOT_WORKSPACE = join(dataDir, 'ws')
  mkdirSync(join(dataDir, 'ws'), { recursive: true })
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
    enabled: true,
    dryRun: false,
    setupDone: true,
    botQQ: '20000002',
    ownerQQ: '10000001',
    allow: { private: ['10000001'], groups: [] },
    snowluma: { autoStart: false, autoAttach: false, dir: join(dataDir, 'no-snowluma') },
    voice: { autoChance: 0 },
    stickers: { autoChance: 0 },
  }))
  fake = createFakeDsh({ brain: async () => '嗯' })
  const ctl = fake.ctx.services.sessionController
  const origRename = ctl.rename.bind(ctl)
  ctl.rename = async (arg) => { renamed.push(arg.title); return origRename(arg) }
  const host = await import('../src/host.js')
  api = host.apply(fake.ctx)
})

after(() => { fake?.dispose() })

test('系统会话标题：模块自带「QQ · 」前缀时不再拼第二次', async () => {
  await api.hub.runSystemTurn('p5-title', 'QQ · 主动搭话（测试）', '嗯', { timeoutMs: 8000 })
  assert.ok(renamed.includes('QQ · 主动搭话（测试）'), '标题里只有一个「QQ · 」')
  assert.ok(!renamed.some((t) => typeof t === 'string' && t.startsWith('QQ · QQ · ')), '不能出现双前缀')
  // 没带前缀的照旧拼上
  await api.hub.runSystemTurn('p5-title2', '每日自审', '嗯', { timeoutMs: 8000 })
  assert.ok(renamed.includes('QQ · 每日自审'))
})

test('被归档的会话：宿主有 unarchiveSession 就解归档接着用，不开新房', async () => {
  await api.hub.runSystemTurn('p5-arc', '归档测试', '一', { timeoutMs: 8000 })
  const first = fake.turns.at(-1).sessionId
  const reg = fake.ctx.workspaceRegistry
  reg.archivedSessionIds.push(first)
  const restored = []
  reg.unarchiveSession = async (id) => {
    restored.push(id)
    const i = reg.archivedSessionIds.indexOf(id)
    if (i >= 0) reg.archivedSessionIds.splice(i, 1)
  }
  await api.hub.runSystemTurn('p5-arc', '归档测试', '二', { timeoutMs: 8000 })
  const second = fake.turns.at(-1).sessionId
  assert.equal(second, first, '还是同一间房')
  assert.deepEqual(restored, [first], '真的调了解归档')
})

test('宿主没有 unarchiveSession：还是换一个新的（不硬撑）', async () => {
  delete fake.ctx.workspaceRegistry.unarchiveSession
  await api.hub.runSystemTurn('p5-arc2', '归档测试二', '一', { timeoutMs: 8000 })
  const first = fake.turns.at(-1).sessionId
  fake.ctx.workspaceRegistry.archivedSessionIds.push(first)
  await api.hub.runSystemTurn('p5-arc2', '归档测试二', '二', { timeoutMs: 8000 })
  const second = fake.turns.at(-1).sessionId
  assert.notEqual(second, first)
})

test('人格规则：改说「一条消息里可以有两三句」，不再要求一句一行', () => {
  const rules = fake.variables.get('aurabot_rules_private')()
  assert.match(rules, /一条消息里可以有两三句/)
  assert.doesNotMatch(rules, /一句一行，每一行会单独发成一条消息/)
})


test('重新开始只归档自有聊天，保留自己创建工作树的旧会话和共享工作区里的普通会话', async () => {
  const owner = { chatId: 'private:10000001', kind: 'private', userId: '10000001' }
  const guest = { chatId: 'private:10000002', kind: 'private', userId: '10000002' }
  await api.hub.pushToSession(owner, [{ type: 'text', text: '一' }], owner.userId)
  const protectedId = fake.turns.at(-1).sessionId
  await api.hub.pushToSession(guest, [{ type: 'text', text: '二' }], guest.userId)
  const ordinaryId = fake.turns.at(-1).sessionId
  const worktree = { type: 'plugin:worktree/created', seq: 1, ignorable: true }
  let closed = 0
  fake.ctx.sessionQuery = { async observeSession(id) {
    return { inheritedEventCount: id === protectedId ? 0 : 2, events: [worktree], [Symbol.dispose]() { closed++ } }
  } }
  fake.workspaces[0].sessionIds.push('external-session')
  const result = await api.hub.resetSessions()
  assert.equal(result.retained, 1)
  assert.equal(result.failed, 0)
  assert.ok(result.archived >= 1)
  const archived = fake.ctx.workspaceRegistry.archivedSessionIds
  assert.ok(archived.includes(ordinaryId))
  assert.ok(!archived.includes(protectedId) && !archived.includes('external-session'))
  assert.equal(closed, result.archived + result.retained)
  await api.hub.pushToSession(owner, [{ type: 'text', text: '重新开始' }], owner.userId)
  assert.notEqual(fake.turns.at(-1).sessionId, protectedId)
  delete fake.ctx.sessionQuery
})

test('图片准入处理单图和结构化批量超限，保留可看的附件', async (t) => {
  const owner = { chatId: 'private:10000001', kind: 'private', userId: '10000001' }
  const original = fake.ctx.attachments.admitPromptContent
  t.after(() => { fake.ctx.attachments.admitPromptContent = original })
  api.setConfig({ ...api.getConfig(), model: { ...api.getConfig().model, vision: 'on' } })
  const admitted = []
  fake.ctx.attachments.admitPromptContent = async (blocks) => {
    const images = blocks.filter((block) => block.type === 'image')
    admitted.push(images.length)
    if (images.length > 1) throw Object.assign(new Error('batch limit'), { code: 'TOO_MANY_IMAGES' })
    if (images[0]?.data === 'bad') throw Object.assign(new Error('image invalid'), { code: 'INVALID_IMAGE' })
    return original(blocks)
  }
  const image = (data) => ({ type: 'image', data, mediaType: 'image/png' })
  await api.hub.pushToSession(owner, [image('one')], owner.userId)
  assert.equal(fake.turns.at(-1).images, 1)
  await api.hub.pushToSession(owner, [image('one'), image('two')], owner.userId)
  assert.equal(fake.turns.at(-1).images, 1)
  assert.match(fake.turns.at(-1).userText, /只交给你第一张/)
  await api.hub.pushToSession(owner, [image('bad')], owner.userId)
  assert.equal(fake.turns.at(-1).images, 0)
  assert.match(fake.turns.at(-1).userText, /未能交给你查看/)
  assert.deepEqual(admitted, [1, 2, 1, 1])
})

test('新版 DSH 通过 agent.model 恢复聊天选模，沿用宿主的全局默认', async () => {
  const chat = { chatId: 'private:10000001', kind: 'private', userId: '10000001' }
  const prompt = [{ type: 'text', text: '聊聊' }]
  await api.hub.pushToSession(chat, prompt, chat.userId)
  const agent = fake.agents.get(fake.turns.at(-1).sessionId)
  let active = { provider: 'fake', model: 'changed-in-dsh' }
  const selected = []
  agent.model = {
    current: () => active,
    select(selection) {
      active = selection
      selected.push(selection)
    },
  }
  await api.hub.pushToSession(chat, prompt, chat.userId)
  await api.hub.pushToSession(chat, prompt, chat.userId)
  assert.deepEqual(selected, [{ provider: 'fake', model: 'fake-1', reasoningEffort: 'low' }])
  assert.deepEqual(fake.ctx.services.agentDefaultModel.currentSelection(), { provider: 'fake', model: 'fake-1' })
})
