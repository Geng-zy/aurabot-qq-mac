// 轮次兜底（移植自原项目 9c8c0f5 / 077b56c）：一轮卡住超过「一轮最多等多久」就强制放开；填 0 不兜底。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalize } from '../src/core/config.js'
import { createHub } from '../src/chat/hub.js'
import { createFakeDsh } from './helpers/fake-dsh.js'

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate) }

function setup(t, minutes) {
  const root = mkdtempSync(join(tmpdir(), 'aurabot-turn-timeout-'))
  const oldDir = process.env.AURABOT_DATA_DIR
  process.env.AURABOT_DATA_DIR = join(root, 'data')
  let unstick
  const stuck = new Promise((resolve) => { unstick = resolve })
  const fake = createFakeDsh({ brain: async () => { await stuck; return '终于回了' } })
  const cfg = normalize({ enabled: true, dryRun: true, setupDone: true, ownerQQ: '8', botQQ: '9', workspaceDir: join(root, 'ws'),
    merge: { enabled: false }, voice: { enabled: false }, stickers: { autoChance: 0 }, chat: { turnTimeoutMinutes: minutes } })
  const warnings = []
  const log = { info() {}, debug() {}, error() {}, warn: (...a) => warnings.push(a.join(' ')) }
  const hub = createHub({ dsh: fake.ctx, getConfig: () => cfg, log, onebot: { async call() { return { message_id: 1 } } } })
  fake.ctx.effect(() => fake.ctx.on('session/event', hub.onSessionEvent))
  t.after(() => {
    unstick()
    hub.dispose()
    fake.dispose()
    if (oldDir === undefined) delete process.env.AURABOT_DATA_DIR
    else process.env.AURABOT_DATA_DIR = oldDir
    rmSync(root, { recursive: true, force: true })
  })
  return { hub, warnings, chat: { kind: 'private', chatId: 'private:8', userId: '8', nickname: '主人' } }
}

test('一轮卡住超过上限就强制放开', async (t) => {
  const s = setup(t, 0.05) // 3 秒
  void s.hub.pushToSession(s.chat, [{ type: 'text', text: '卡住试试' }], '8').catch(() => {})
  await settle()
  await new Promise((r) => setTimeout(r, 3600))
  assert.ok(s.warnings.some((m) => m.includes('强制放开')), JSON.stringify(s.warnings))
})

test('填 0 = 不兜底，不会超时放开', async (t) => {
  const s = setup(t, 0)
  void s.hub.pushToSession(s.chat, [{ type: 'text', text: '卡住试试' }], '8').catch(() => {})
  await settle()
  await new Promise((r) => setTimeout(r, 3600))
  assert.ok(!s.warnings.some((m) => m.includes('强制放开')), JSON.stringify(s.warnings))
})

test('配置：默认 30 分钟，0 保留，超出范围夹到 180', () => {
  assert.equal(normalize({}).chat.turnTimeoutMinutes, 30)
  assert.equal(normalize({ chat: { turnTimeoutMinutes: 0 } }).chat.turnTimeoutMinutes, 0)
  assert.equal(normalize({ chat: { turnTimeoutMinutes: 999 } }).chat.turnTimeoutMinutes, 180)
})
