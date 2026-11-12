import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setImmediate as tick } from 'node:timers/promises'
import { createTasks } from '../src/core/tasks.js'

test('翻唱重启后区分已经发送、尚未执行和发送未确认，并保留当前聊天范围', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-tasks-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'tasks.json')
  const tasks = createTasks({ file })
  const chatId = 'private:123'
  const start = (kind, run) => tasks.start({ kind, chatId, requesters: ['123'], run }).taskId
  const complete = start('生图', async ({ beginDelivery }) => { beginDelivery(); return { ok: true } })
  await tick()
  let released
  const sending = start('翻唱', async ({ beginDelivery }) => {
    beginDelivery()
    await new Promise((resolve) => { released = resolve })
    return { ok: true }
  })
  const waiting = start('翻唱', async () => assert.fail('已经关掉的任务不继续跑'))
  await tick()
  tasks.dispose()
  const reopened = createTasks({ file })
  t.after(() => reopened.dispose())
  const status = reopened.tools({ chat: { kind: 'private', chatId: 'qq:private:123' } }, () => ['123'])[0]
  assert.match((await status.execute({ id: complete })).message, /已发送/)
  assert.match((await status.execute({ id: sending })).message, /发送结果未确认/)
  assert.match((await status.execute({ id: waiting })).message, /重启前未完成/)
  const other = reopened.tools({ chat: { kind: 'private', chatId: 'private:456' } }, () => ['456'])[0]
  assert.doesNotMatch((await other.execute({ id: sending })).message, /翻唱/)
  released()
  await tick()
  assert.match(readFileSync(file, 'utf8'), /"unconfirmed"/)
})
