// 调试模式：不真发 + 不写任何持久记忆，只在日志里留痕；和「试运行」互斥。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.AURABOT_DATA_DIR = mkdtempSync(join(tmpdir(), 'aurabot-debug-'))

const { normalize, publicConfig } = await import('../src/core/config.js')
const { createStickerStore } = await import('../src/features/stickers.js')

const logs = []
const log = { info: (...a) => logs.push(a.join(' ')), warn () {}, debug () {} }

test('配置：开调试就等于不真发（内部 dryRun 置真）', () => {
  const c = normalize({ debug: true, dryRun: false })
  assert.equal(c.debug, true)
  assert.equal(c.dryRun, true, '调试必须连带 dryRun，否则对外动作会漏出去')
})

test('配置：面板上「试运行」和「调试」互斥显示', () => {
  const dbg = publicConfig(normalize({ enabled: true, debug: true, dryRun: true }))
  assert.equal(dbg.debug, true)
  assert.equal(dbg.dryRun, false, '调试开着时，面板里的「试运行」要显示成关')

  const dry = publicConfig(normalize({ enabled: true, debug: false, dryRun: true }))
  assert.equal(dry.debug, false)
  assert.equal(dry.dryRun, true, '只开试运行时它照常显示为开')

  const live = publicConfig(normalize({ enabled: true, debug: false, dryRun: false }))
  assert.equal(live.dryRun, false)
  assert.equal(live.debug, false)
})

// 旧记忆模块的三条（不写记忆、不整理）换成了心智核心：见 test/mind-personality.test.js「调试模式」

test('调试模式：不收表情（不往表情库里添东西）', async () => {
  const cfg = normalize({ enabled: true, debug: true })
  const calls = []
  const store = createStickerStore({
    dsh: null,
    getConfig: () => cfg,
    onebot: { call: async (a) => { calls.push(a); return {} } },
    log,
  })
  const seg = { type: 'image', data: { url: 'https://example.com/x.jpg', sub_type: 1, summary: '[动画表情]' } }
  const r = await store.collect(seg, 'private:1')
  assert.equal(r.ok, false)
  assert.match(r.reason, /调试/)
  assert.equal(store.library().items.length, 0)
  assert.equal(calls.length, 0, '不该去下载/收藏')
  assert.equal(existsSync(join(process.env.AURABOT_DATA_DIR, 'stickers', 'index.json')), false)
})
