// 备份恢复后再重启：配置、人格和模块清单必须从恢复后的数据目录读，而不是内存里的旧值。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFakeDsh } from './helpers/fake-dsh.js'

const OWNER = '10000001'
const BOT = '20000002'
let dataDir
let api
let fake
let backupApi

async function boot() {
  fake = createFakeDsh({ brain: async () => '嗯' })
  fake.ctx.webServer.port = 5098
  api = (await import('../src/host.js')).apply(fake.ctx)
  await api.ready.catch(() => {})
  return api
}

function state() {
  return fake.call('/state').then((r) => r.json())
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'aurabot-restore-restart-'))
  process.env.AURABOT_DATA_DIR = dataDir
  process.env.AURABOT_WORKSPACE = join(dataDir, 'ws')
  mkdirSync(join(dataDir, 'ws'), { recursive: true })
  mkdirSync(join(dataDir, 'personas'), { recursive: true })
  writeFileSync(join(dataDir, 'personas', 'dafeiyu.md'), '---\nname: 大肥鱼\n---\n恢复后的人格\n')
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
    enabled: false, dryRun: true, setupDone: true, botQQ: BOT, ownerQQ: OWNER, ownerName: '恢复前的管理员',
    persona: { current: 'dafeiyu' },
    allow: { private: [OWNER], groups: [] },
    snowluma: { autoStart: false, autoAttach: false, dir: join(dataDir, 'none') },
    voice: { engine: 'system', autoChance: 0 },
    stickers: { autoChance: 0 },
  }))
  backupApi = await import('../src/core/backup.js')
})

after(() => {
  try { fake?.dispose() } catch (e) {}
})

test('备份 → 恢复 → 重启：配置和人格都读恢复后的版本', async () => {
  const b = await backupApi.createBackup({ version: '1.5.10' })
  assert.ok(b.files > 0)
  // 模拟恢复前的现场被改坏
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ ownerQQ: OWNER, ownerName: '被改坏的管理员', setupDone: true }))
  writeFileSync(join(dataDir, 'personas', 'dafeiyu.md'), '临时人格')
  const staged = await backupApi.stageRestore(b.file)
  assert.equal(staged.ok, true)

  await boot()
  const first = await state()
  assert.equal(first.config.ownerName, '恢复前的管理员')
  assert.equal(readFileSync(join(dataDir, 'personas', 'dafeiyu.md'), 'utf8').includes('恢复后的人格'), true)

  // 第一次启动已经把待恢复文件换上；再启动一次模拟重启，不能又读回旧内存
  fake.dispose()
  await boot()
  const second = await state()
  assert.equal(second.config.ownerName, '恢复前的管理员')
  assert.equal(backupApi.pendingRestore(), null)
  assert.equal(existsSync(join(dataDir, '.restore')), false)
})
