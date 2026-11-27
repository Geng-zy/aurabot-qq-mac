// backup.js 的公开 API 快照。
//
// 这个文件被拆过三次（ZIP 编解码 → backup-zip.js、路径安全层 → backup-fs.js、发布事务 → backup-publish.js），
// 每次都要保证对外导出一个不少 —— 面板路由、host 装配、还有一堆测试都按这些名字拿东西。
// 这条测试把 17 个导出钉住：以后谁再拆，少一个就红。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.AURABOT_DATA_DIR = mkdtempSync(join(tmpdir(), 'aurabot-api-'))
const backup = await import('../src/core/backup.js')

test('backup.js 的导出清单不变', () => {
  const expected = [
    'MIND_DIR',
    'applyPendingRestore', 'cancelPendingSessions', 'cancelRestore', 'createBackup',
    'inspectBackup', 'listBackups', 'pendingModules', 'pendingRestore', 'pendingSessions',
    'pruneLocalBackups', 'prunePreRestore', 'retryPendingSessions', 'sessionDirName',
    'setPendingModules', 'stageReceivedBackup', 'stageRestore',
  ]
  assert.deepEqual(Object.keys(backup).sort(), expected)
})

test('导出的都是可用的东西（函数或常量，不是 undefined）', () => {
  for (const [name, value] of Object.entries(backup)) {
    assert.notEqual(value, undefined, `${name} 是 undefined`)
    if (name !== 'MIND_DIR') assert.equal(typeof value, 'function', `${name} 应当是函数`)
  }
  assert.equal(typeof backup.MIND_DIR, 'string')
})

test('拆出去的三个模块各自只暴露自己那层', async () => {
  const zip = Object.keys(await import('../src/core/backup-zip.js')).sort()
  const fsLayer = Object.keys(await import('../src/core/backup-fs.js')).sort()
  const publish = Object.keys(await import('../src/core/backup-publish.js')).sort()
  assert.ok(zip.includes('readEntries') && zip.includes('MAX_ZIP'), 'zip 层要有读目录与上限')
  assert.ok(fsLayer.includes('checkPath') && fsLayer.includes('safeName'), '路径层要有校验函数')
  assert.deepEqual(publish, ['publishStage', 'recoverPublish', 'restoreBusy', 'withRestoreStage'])
})
