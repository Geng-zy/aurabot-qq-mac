// 不依赖 ffmpeg 的音频时长探测：四种容器 + 文件入口 + 与 audioDurationSec 的接线。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wavDuration, mp3Duration, oggDuration, mp4Duration, durationFromBuffer, durationFromFile } from '../src/voice/duration.js'
import { buildWav } from '../src/voice/wav.js'
import { audioDurationSec } from '../src/chat/voice-file.js'

const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol

function wavBuf(seconds, rate = 24000) {
  const frames = Math.round(seconds * rate)
  const mono = new Int16Array(frames)
  for (let i = 0; i < frames; i++) mono[i] = Math.round(Math.sin(i / 8) * 8000)
  return buildWav(mono, rate)
}

/** MPEG1 Layer III 128kbps 44.1kHz、无 padding 的帧，帧长 417 字节。 */
function mp3Buf(frames, { id3 = 0 } = {}) {
  const frame = Buffer.alloc(417)
  frame[0] = 0xff
  frame[1] = 0xfb // MPEG1 / Layer III / 无 CRC
  frame[2] = 0x90 // bitrate index 9 = 128kbps，rate index 0 = 44100
  frame[3] = 0x00 // 单声道
  const body = Buffer.concat(Array.from({ length: frames }, () => frame))
  if (!id3) return body
  const tag = Buffer.alloc(id3)
  tag.write('ID3', 0, 'ascii')
  tag[3] = 3
  tag[6] = (id3 - 10) >> 7 & 0x7f
  tag[9] = (id3 - 10) & 0x7f
  return Buffer.concat([tag, body])
}

/** 一个 Opus 的 OGG：ident 头 + 一个音频页，granule 就是总采样数（48kHz）。 */
function oggBuf(seconds) {
  const ident = Buffer.concat([Buffer.from('OpusHead', 'ascii'), Buffer.from([1, 1, 0, 0, 0x80, 0xbb, 0, 0, 0, 0, 0, 0])])
  const page = (granule, payload) => {
    const head = Buffer.alloc(27)
    head.write('OggS', 0, 'ascii')
    head[4] = 0
    head[5] = granule ? 0x04 : 0x02
    head.writeBigUInt64LE(BigInt(granule), 6)
    head[26] = 1
    const lacing = Buffer.from([payload.length])
    return Buffer.concat([head, lacing, payload])
  }
  return Buffer.concat([page(0, ident), page(Math.round(seconds * 48000), Buffer.alloc(64, 1))])
}

function mp4Buf(seconds, timescale = 1000) {
  const mvhd = Buffer.alloc(8 + 108)
  mvhd.write('mvhd', 4, 'ascii')
  mvhd.writeUInt32BE(8 + 100, 0) // 长度，不参与解析
  mvhd.writeUInt32BE(timescale, 8 + 12)
  mvhd.writeUInt32BE(Math.round(seconds * timescale), 8 + 16)
  return Buffer.concat([Buffer.from([0, 0, 0, 0]), mvhd])
}

test('WAV：24kHz 1.5 秒算得出来', () => {
  assert.ok(near(wavDuration(wavBuf(1.5)), 1.5), '应约 1.5 秒')
})

test('WAV：data 长度写成 0xFFFFFFFF 时按实际文件长度兜底', () => {
  const buf = wavBuf(1)
  buf.writeUInt32LE(0xffffffff, 40)
  assert.ok(wavDuration(buf) > 0.9 && wavDuration(buf) < 1.1)
})

test('MP3：100 帧 = 2.61 秒，带 ID3v2 也跳过', () => {
  const plain = mp3Duration(mp3Buf(100))
  const tagged = mp3Duration(mp3Buf(100, { id3: 128 }))
  assert.ok(near(plain, 2.61, 0.02), `实际 ${plain}`)
  assert.ok(near(tagged, 2.61, 0.02), `带 ID3 实际 ${tagged}`)
})

test('OGG/Opus：granule 按 48kHz 换算', () => {
  assert.ok(near(oggDuration(oggBuf(2)), 2, 0.02))
})

test('M4A：mvhd 的 timescale 与 duration', () => {
  assert.ok(near(mp4Duration(mp4Buf(2.5)), 2.5, 0.02))
})

test('认不出的字节返回 0，不抛', () => {
  assert.equal(durationFromBuffer(Buffer.alloc(64)), 0)
  assert.equal(durationFromBuffer(null), 0)
  assert.equal(durationFromFile('/definitely/not/here.mp3'), 0)
})

test('durationFromFile 能从磁盘读出来', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-dur-'))
  const file = join(dir, 'a.wav')
  writeFileSync(file, wavBuf(2))
  assert.ok(near(durationFromFile(file), 2, 0.02))
})

test('audioDurationSec：没装 ffmpeg 也能给出秒数（语音条不再被网关拒收）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-dur-'))
  const file = join(dir, 'b.mp3')
  writeFileSync(file, mp3Buf(100))
  // 配置里没有 ffmpegPath，机器上也没有 ffmpeg：以前这里一定是 0
  assert.equal(audioDurationSec(file, () => ({ local: {} })), 3)
})

test('say 失败时会给 0 采样的 WAV：ensureAudible 必须判失败，不能当成功', async () => {
  const { ensureAudible } = await import('../src/voice/tts.js')
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-dur-'))
  const empty = join(dir, 'empty.wav')
  writeFileSync(empty, buildWav(new Int16Array(0), 24000)) // 44 字节，0 采样
  assert.throws(() => ensureAudible(empty), /合成的语音是空的/)
  const good = join(dir, 'good.wav')
  writeFileSync(good, wavBuf(1))
  assert.equal(ensureAudible(good), good)
})

test('认不出的容器不拦：别的引擎/假数据不能因为解析失败就被判空', async () => {
  const { ensureAudible } = await import('../src/voice/tts.js')
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-dur-'))
  const fake = join(dir, 'fake.wav')
  writeFileSync(fake, Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(1000, 1)]))
  assert.equal(ensureAudible(fake), fake, 'RIFF 但没有 fmt/data 的也放过，交给网关')
})
