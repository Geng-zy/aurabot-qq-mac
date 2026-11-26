// 恢复暂存/取消的直测：这些路径以前只有「备份 → 恢复 → 重启」一条端到端覆盖，
// 失败分支（不是备份文件、重复暂存、取消）没人验证过。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir
let backup

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'aurabot-stage-'))
  process.env.AURABOT_DATA_DIR = dir
  mkdirSync(join(dir, 'ws'), { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ enabled: false, dryRun: true, ownerQQ: '1' }))
  writeFileSync(join(dir, 'keep.txt'), 'hello')
  backup = await import('../src/core/backup.js')
})

after(async () => {
  // 交还暂存位，别把锁留给别的测试文件
  try { await backup.cancelRestore() } catch { /* 还在暂存就等下一轮 */ }
})

test('拿一个不是 zip 的文件去恢复：报错，且不留下待恢复项', async () => {
  const txt = join(dir, 'not-a-backup.zip')
  writeFileSync(txt, '这只是一段文本，不是 zip')
  await assert.rejects(() => backup.stageRestore(txt), /不是有效的备份文件|不是 Aurabot 的备份文件/)
  assert.equal(backup.pendingRestore(), null)
})

test('真备份：暂存成功、能看到待恢复信息，取消后清干净', async () => {
  const good = await backup.createBackup({ version: '1.0.0' })
  assert.ok(good.files > 0)
  const name = good.name || String(good.file || '').split('/').pop()
  const file = good.file || join(dir, 'backups', name)
  const r = await backup.stageRestore(file)
  assert.equal(r.ok, true)
  assert.equal(typeof r.files, 'number')
  const pending = backup.pendingRestore()
  assert.ok(pending, '暂存后应当能看到待恢复信息')
  assert.equal(pending.files, r.files)
  backup.cancelRestore()
  assert.equal(backup.pendingRestore(), null, '取消后不该再有待恢复项')
})

test('重复暂存会被拒绝：同一时间只允许一个恢复在跑', async () => {
  const good = await backup.createBackup({ version: '1.0.1' })
  const file = good.file || join(dir, 'backups', good.name || '')
  const first = backup.stageRestore(file)
  await assert.rejects(() => backup.stageRestore(file), /另一个备份正在暂存/)
  await first
  backup.cancelRestore()
})

test('取消一个没有待恢复项的恢复：不炸', () => {
  assert.doesNotThrow(() => backup.cancelRestore())
  assert.equal(backup.pendingRestore(), null)
})

test('stageReceivedBackup：空/非 Buffer 在入口被挡掉', async () => {
  await assert.rejects(() => backup.stageReceivedBackup(Buffer.alloc(0)), /备份文件大小无效/)
  await assert.rejects(() => backup.stageReceivedBackup('not a buffer'), /备份文件大小无效/)
})

test('恢复完成后不留暂存残留（.restore / .restore-* 都不该在数据目录）', () => {
  const leftovers = readdirSync(dir).filter((n) => n.startsWith('.restore'))
  assert.deepEqual(leftovers, [])
})
