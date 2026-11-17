// 聊天流水：落盘、按天读、隐私过滤、旧文件移入废纸篓。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatLog } from '../src/chat/chat-log.js'
import { dataDir } from '../src/core/store.js'

function setup({ debug = false, keep = 7 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aurabot-chatlog-'))
  const old = process.env.AURABOT_DATA_DIR
  process.env.AURABOT_DATA_DIR = join(root, 'data')
  const cfg = { debug, ownerQQ: '10001', memory: { keepChatlogDays: keep } }
  const log = { debug() {}, warn() {}, info() {} }
  const chatLog = createChatLog({
    getConfig: () => cfg,
    log,
    trashDir: join(root, 'trash'),
    mind: null,
    hooks: {},
    cleaningFor: () => ({ protectedText: () => false }),
  })
  return {
    root,
    chatLog,
    cleanup() {
      if (old === undefined) delete process.env.AURABOT_DATA_DIR
      else process.env.AURABOT_DATA_DIR = old
      rmSync(root, { recursive: true, force: true })
    },
  }
}

test('写入后按天读回；调试模式不落盘', (t) => {
  const s = setup()
  t.after(() => s.cleanup())
  assert.equal(s.chatLog.logChat('private:10001', 'user', '你好', '10001'), true)
  assert.equal(s.chatLog.logChat('group:555', 'user', '在吗', '20002'), true)
  const days = s.chatLog.chatLogDays()
  assert.equal(days.length, 1)
  const rows = s.chatLog.chatLogOf(days[0])
  assert.equal(rows.length, 2)
  assert.equal(rows[0].text, '你好')
  assert.equal(rows[1].chatId, 'group:555')

  const dbg = setup({ debug: true })
  t.after(() => dbg.cleanup())
  dbg.chatLog.logChat('private:10001', 'user', '只进日志')
  assert.deepEqual(dbg.chatLog.chatLogDays(), [])
})

test('隐私：主人私聊流水不对其他会话开放；显式分享按 mind 判断', (t) => {
  const s = setup()
  t.after(() => s.cleanup())
  s.chatLog.logChat('private:10001', 'user', '主人的悄悄话', '10001')
  const row = s.chatLog.chatLogOf(s.chatLog.chatLogDays()[0])[0]
  assert.equal(s.chatLog.canReadChatLog(row, 'group:555'), false, '主人私聊不对群开放')
  assert.equal(s.chatLog.canReadChatLog(row, 'private:10001'), true, '自己的会话可以读')
})

test('旧流水按天移入废纸篓，不直接删', (t) => {
  const s = setup({ keep: 0 })
  t.after(() => s.cleanup())
  mkdirSync(dataDir('chatlog'), { recursive: true })
  writeFileSync(join(dataDir('chatlog'), '2000-01-01.jsonl'), '{"text":"old"}\n')
  s.chatLog.logChat('private:10001', 'user', '今天的')
  assert.ok(!s.chatLog.chatLogDays().includes('2000-01-01'), '旧文件应被移走')
  const trash = join(s.root, 'trash', 'aurabot-chatlog')
  assert.equal(readdirSync(trash).length, 1, '旧文件应在废纸篓里')
})
