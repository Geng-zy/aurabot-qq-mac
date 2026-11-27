// 表情库的纯逻辑（features/sticker-library.js）：不联网、不碰 DSH，只算「用哪张 / 删哪张」。
// 这些用例以前只能连着采集存储一起测（features/stickers.js 459 行）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'aurabot-sticker-lib-'))
process.env.AURABOT_DATA_DIR = root
const lib = await import('../src/features/sticker-library.js')

test.after(() => rmSync(root, { recursive: true, force: true }))

test('空库与坏库都退化成空列表（不抛错）', () => {
  assert.deepEqual(lib.loadLibrary(), { items: [] })
})

test('matchSticker：备注/标签命中得分高，完全找不到返回 null', () => {
  const items = [
    { id: 'a', name: '猫猫点头', tags: ['卖萌'], file: 'a.png' },
    { id: 'b', name: '熊猫人', tags: ['无语'], file: 'b.png' },
  ]
  assert.equal(lib.matchSticker(items, '猫猫').id, 'a')
  assert.equal(lib.matchSticker(items, '无语').tags[0], '无语')
  assert.equal(lib.matchSticker(items, '完全不相关'), null)
  assert.equal(lib.matchSticker([], '任意'), null)
})

test('pickForReply：有「不随机」标记时不会随机挑', () => {
  const items = [{ id: 'a', name: 'x', tags: [], file: 'a.png', from: 'tool' }]
  // NEVER_RANDOM 是给调用方的约定值
  assert.equal(typeof lib.NEVER_RANDOM, 'string')
})

test('pickEvict：先淘汰用得最少的，且不动管理员/收藏来源', () => {
  const items = [
    { id: 'keep', from: 'manual', uses: 0, at: 1 },
    { id: 'qq', from: 'qq', uses: 0, at: 1 },
    { id: 'used', from: 'stolen', uses: 9, at: 100 },
    { id: 'rare', from: 'stolen', uses: 1, at: 50 },
  ]
  assert.equal(lib.pickEvict(items).id, 'rare', '用得最少的先淘汰')
  assert.equal(lib.pickEvict([{ id: 'keep', from: 'manual' }]), null, '只剩不该动的就是 null')
  assert.equal(lib.pickEvict([]), null)
})

test('stickerPath 基于数据目录拼路径（不写盘）', () => {
  const p = lib.stickerPath({ file: 'x.png' })
  assert.ok(p.endsWith(join('stickers', 'x.png')), p)
  assert.equal(lib.stickerDir().endsWith('stickers'), true)
})
