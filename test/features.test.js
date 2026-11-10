import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planDiaryTimes } from '../src/features/qzone.js'
import { matchSticker, pickForReply } from '../src/features/stickers.js'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('日记排期：窗口内、间隔够、按时间排序', () => {
  let seed = 1
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 50; i++) {
    const t = planDiaryTimes({ timesPerDay: 2, windowStart: '10:00', windowEnd: '23:30', minGapMinutes: 180 }, rand)
    assert.equal(t.length, 2)
    assert.ok(t[0] >= 600 && t[1] < 1410)
    assert.ok(t[1] - t[0] >= 180)
  }
  assert.deepEqual(planDiaryTimes({ timesPerDay: 0, windowStart: '10:00', windowEnd: '23:30', minGapMinutes: 180 }), [])
})

test('表情匹配：按名字和标签', () => {
  const items = [{ md5: 'a', name: '委屈巴巴的小猫', tags: ['委屈'] }, { md5: 'b', name: '得意叉腰', tags: ['开心'] }]
  assert.equal(matchSticker(items, '委屈').md5, 'a')
  assert.equal(matchSticker(items, '开心').md5, 'b')
  assert.equal(matchSticker(items, '完全无关xyz'), null)
  assert.equal(pickForReply(items, '哼 好委屈').md5, 'a')
})

test('WAV 转 16kHz 单声道（给 DSH 语音识别）', async () => {
  const { buildWav, parseWav, toMono16k } = await import('../src/voice/wav.js')
  // 48kHz 立体声 0.5 秒
  const frames = 24000
  const pcm = Buffer.alloc(frames * 4)
  for (let i = 0; i < frames; i++) { const v = Math.round(Math.sin(i / 10) * 8000); pcm.writeInt16LE(v, i * 4); pcm.writeInt16LE(v, i * 4 + 2) }
  const head = buildWav(new Int16Array(0), 48000)
  head.writeUInt16LE(2, 22); head.writeUInt32LE(48000 * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt32LE(pcm.length, 40); head.writeUInt32LE(36 + pcm.length, 4)
  const out = parseWav(toMono16k(Buffer.concat([head, pcm])))
  assert.equal(out.rate, 16000)
  assert.equal(out.channels, 1)
  assert.equal(out.bits, 16)
  assert.equal(out.data.length / 2, 8000)
})

test('表情库上限：只清偷来的、最少用的、最老的', async () => {
  const { pickEvict } = await import('../src/features/stickers.js')
  const items = [
    { md5: 'a', from: 'group:1', uses: 3, at: 1 },
    { md5: 'b', from: 'group:1', uses: 0, at: 5 },
    { md5: 'c', from: 'group:1', uses: 0, at: 2 },
    { md5: 'd', from: 'manual', uses: 0, at: 0 },
  ]
  assert.equal(pickEvict(items).md5, 'c')
  assert.equal(pickEvict([{ md5: 'd', from: 'manual' }]), null, '你自己加的不清')
})

test('语音：语速 / 音调只认 ±N% 和 ±NHz，写着玩的和超范围的都回落/夹回来', async () => {
  const { normalize } = await import('../src/core/config.js')
  const v = (voice) => normalize({ voice }).voice
  // 音调（edge-tts 的 --pitch）
  assert.equal(v({ pitch: '+20Hz' }).pitch, '+20Hz')
  assert.equal(v({ pitch: '20Hz' }).pitch, '+20Hz', '没写正负号也当正')
  assert.equal(v({ pitch: '-10hz' }).pitch, '-10Hz', '大小写不敏感')
  assert.equal(v({ pitch: '999Hz' }).pitch, '+80Hz', '超范围夹到 ±80Hz（滑条上限）')
  assert.equal(v({ pitch: '-999Hz' }).pitch, '-80Hz')
  assert.equal(v({ pitch: '+0Hz' }).pitch, '+0Hz', '0 也要带正号，否则滑条/下拉框对不上')
  assert.equal(v({ pitch: '0Hz' }).pitch, '+0Hz', '缺正号的补上')
  assert.equal(v({ pitch: '大声点' }).pitch, '+0Hz', '乱写的回落默认')
  assert.equal(v({ pitch: '' }).pitch, '+0Hz')
  // 语速（edge-tts 的 --rate）
  assert.equal(v({ rate: '+10%' }).rate, '+10%')
  assert.equal(v({ rate: '-5%' }).rate, '-5%')
  assert.equal(v({ rate: '999%' }).rate, '+50%')
  assert.equal(v({ rate: '+0%' }).rate, '+0%', '正常语速也要带正号')
  assert.equal(v({ rate: '0%' }).rate, '+0%')
  assert.equal(v({ rate: '快一点' }).rate, '+0%')
})
