// 本地脚本的「改了要重新确认」必须真的执行。
//
// 抓过的现状：`approved()` 写好了却没人调用，`status()` 里 `approved` 硬编码 true，
// 面板的「确认这个脚本」按钮永远不出现 —— 也就是说改过的脚本照样会被静默执行。
// 现在：首次调用记 TOFU；之后改脚本 → call() 抛错、status() 报未确认；面板确认（写 config.local.hashes）后恢复。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { createLocal } = await import('../src/local/local.js')

// 每个用例一个独立数据目录：.trusted.json 和 config 都是按 slot 记的，共用目录会互相污染
let seq = 0
function setup(scriptBody) {
  const DATA = mkdtempSync(join(tmpdir(), `aurabot-local-${++seq}-`))
  process.env.AURABOT_DATA_DIR = DATA
  const dir = join(DATA, 'local')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'tts.mjs'), scriptBody)
  let config = { local: { tts: true } }
  const local = createLocal({
    getConfig: () => config,
    log: { info() {}, warn() {}, debug() {}, child() { return this } },
  })
  return { local, dataDir: DATA, setConfig: (next) => { config = next }, getConfig: () => config }
}

const SCRIPT_A = 'export default async ({ text }) => ({ text })\n'
const SCRIPT_B = 'export default async ({ text }) => ({ text: text + "!" })\n'

test('首次调用：记下当前版本（TOFU）并正常执行', async () => {
  const { local, dataDir } = setup(SCRIPT_A)
  const r = await local.call('tts', { text: '你好' })
  assert.equal(r.text, '你好')
  const sidecar = JSON.parse(readFileSync(join(dataDir, 'local', '.trusted.json'), 'utf8'))
  assert.ok(sidecar.tts, '首次调用后应当记下脚本指纹')
})

test('脚本改过：call 直接拒绝，并说明去哪里确认', async () => {
  const { local, dataDir } = setup(SCRIPT_A)
  await local.call('tts', { text: '第一次' }) // 记下 A
  writeFileSync(join(dataDir, 'local', 'tts.mjs'), SCRIPT_B)
  await assert.rejects(() => local.call('tts', { text: '第二次' }), /确认之后又改过了/)
})

test('面板确认（写 config.local.hashes）之后恢复可用，且用到的是新脚本', async () => {
  const { local, dataDir, setConfig } = setup(SCRIPT_A)
  await local.call('tts', { text: '第一次' })
  writeFileSync(join(dataDir, 'local', 'tts.mjs'), SCRIPT_B)
  assert.equal(local.status().find((x) => x.slot === 'tts').approved, false, '改过之后状态应为未确认')
  const hash = local.trust('tts').hash
  setConfig({ local: { tts: true, hashes: { tts: hash } } })
  const r = await local.call('tts', { text: '第二次' })
  assert.equal(r.text, '第二次!', '确认后应当执行新版脚本')
  assert.equal(local.status().find((x) => x.slot === 'tts').approved, true)
})

test('status 只是查询：看一眼面板不会顺手信任脚本', () => {
  const { local, dataDir } = setup(SCRIPT_A)
  const before = local.status().find((x) => x.slot === 'tts')
  assert.equal(before.firstUse, true, '还没调用过 → 首次使用待确认')
  const sidecar = join(dataDir, 'local', '.trusted.json')
  assert.throws(() => readFileSync(sidecar, 'utf8'), 'status() 不该写 .trusted.json')
})
