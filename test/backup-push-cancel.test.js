// 云备份推送的取消：job 状态要如实变成 cancelled，且不能把「取消」记成「失败」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBackupScheduler } from '../src/host/backup-schedule.js'

const log = { info() {}, warn() {}, error() {}, debug() {}, child() { return this } }

function makeScheduler(pushImpl) {
  const cfg = () => ({ backup: { remote: { enabled: false } } })
  return createBackupScheduler({
    getConfig: cfg,
    log,
    alive: () => true,
    getBackupJob: () => null,
    createBackup: async () => ({ name: 'aurabot-backup-20261127-1930.zip', files: 1 }),
    pushBackup: pushImpl,
    captureMind: () => null,
    workspaceDirOf: () => '/tmp',
    version: 'test',
  })
}

test('空闲时取消：如实说没有在跑的推送', () => {
  const s = makeScheduler(async () => ({ ok: true }))
  assert.deepEqual(s.cancelPush(), { ok: false, message: '当前没有在跑的推送' })
})

test('推送进行中取消：在途请求被 abort，job 落成 cancelled 而不是 error', async () => {
  let started = null
  const startedP = new Promise((r) => { started = r })
  const s = makeScheduler(async (_remote, { signal }) => {
    started()
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('已取消'), { cancelled: true })), { once: true })
    })
    return { ok: true }
  })
  const running = s.doPush(false)
  await startedP
  assert.equal(s.getPushJob().running, true)
  const r = s.cancelPush()
  assert.equal(r.ok, true, '运行中取消要接受')
  const result = await running
  const job = s.getPushJob()
  assert.equal(job.running, false)
  assert.equal(job.ok, false)
  assert.equal(job.cancelled, true, '取消要单独标出来，面板才不会显示成「推送失败」')
  assert.equal(job.error, '已取消')
  assert.equal(result.ok, false)
})

test('路由注册要把 cancelPush 透传到调度器（不能落到路由自己的兜底文案）', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/host/routes.js', import.meta.url), 'utf8')
  assert.ok(/registerBackupRoutes\(\{[\s\S]*?cancelPush: d\.cancelPush/.test(src),
    'routes.js 必须在 registerBackupRoutes 的 remote 依赖里带上 cancelPush，否则接口只会返回兜底文案')
})
