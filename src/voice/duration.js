// 不依赖 ffmpeg 的音频时长探测：WAV / MP3 / OGG / M4A。
// QQ 的 record 段必须带 duration，机器上没 ffmpeg 时以前只能不带，网关会直接拒收。

import { openSync, readSync, closeSync, statSync } from 'node:fs'

/** 只读文件头部这么多字节：语音条都短，12MB 足够覆盖整段 MP3/OGG。 */
const HEAD_BYTES = 12 * 1024 * 1024

const MP3_BITRATES = {
  // version: 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5；layer: 3 = Layer I, 2 = Layer II, 1 = Layer III
  3: { 3: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], 2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] },
  2: { 3: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], 1: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] },
}
MP3_BITRATES[0] = MP3_BITRATES[2]

const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

function mp3Version(bits) {
  if (bits === 3) return 3
  if (bits === 2) return 2
  if (bits === 0) return 0
  return -1
}

/** WAV / RIFF：用 byteRate 和 data 块大小算。认不出返回 0。 */
export function wavDuration(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return 0
  let off = 12
  let byteRate = 0
  let dataSize = 0
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const start = off + 8
    if (id === 'fmt ' && size >= 12 && start + 16 <= buf.length) {
      byteRate = buf.readUInt32LE(start + 8)
      if (!byteRate) {
        const channels = buf.readUInt16LE(start + 2)
        const rate = buf.readUInt32LE(start + 4)
        const bits = buf.readUInt16LE(start + 14)
        byteRate = channels * rate * (bits / 8)
      }
    } else if (id === 'data') {
      // 流式写出时 data 长度可能是 0 / 0xFFFFFFFF，按实际文件长度兜底
      const declared = size === 0 || size === 0xffffffff ? buf.length - start : size
      dataSize = Math.min(declared, buf.length - start)
    }
    if (dataSize && byteRate) break
    if (size <= 0) break
    off = start + size + (size & 1)
  }
  if (!(byteRate > 0) || !(dataSize > 0)) return 0
  return dataSize / byteRate
}

function id3v2Size(buf) {
  if (buf.length < 10 || buf.toString('ascii', 0, 3) !== 'ID3') return 0
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)
  return 10 + size + (buf[5] & 0x10 ? 10 : 0) // 有 footer 再多 10 字节
}

/** MP3：逐帧累加，VBR 也能算准。认不出返回 0。 */
export function mp3Duration(buf) {
  let off = id3v2Size(buf)
  let seconds = 0
  let frames = 0
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff || (buf[off + 1] & 0xe0) !== 0xe0) { off++; continue }
    const version = mp3Version((buf[off + 1] >> 3) & 0x03)
    const layerBits = (buf[off + 1] >> 1) & 0x03
    const layer = layerBits === 3 ? 3 : layerBits === 2 ? 2 : layerBits === 1 ? 1 : 0 // 3=I 2=II 1=III
    if (version < 0 || !layer) { off++; continue }
    const bitrateIndex = (buf[off + 2] >> 4) & 0x0f
    const rateIndex = (buf[off + 2] >> 2) & 0x03
    if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) { off++; continue }
    const kbps = MP3_BITRATES[version][layer][bitrateIndex]
    const rate = MP3_RATES[version][rateIndex]
    if (!kbps || !rate) { off++; continue }
    const padding = (buf[off + 2] >> 1) & 0x01
    const samples = layer === 3 ? 384 : layer === 2 ? 1152 : (version === 3 ? 1152 : 576)
    // Layer I 的帧按 4 字节槽位对齐，Layer II/III 直接按字节算
    const frameBytes = layer === 3
      ? (Math.floor(12 * kbps * 1000 / rate) + padding) * 4
      : Math.floor(samples / 8 * (kbps * 1000) / rate) + padding
    if (frameBytes < 4) { off++; continue }
    seconds += samples / rate
    frames++
    off += frameBytes
  }
  return frames ? seconds : 0
}

/** OGG（Vorbis / Opus）：按页链走到最后，用 granule 除以采样率。认不出返回 0。 */
export function oggDuration(buf) {
  if (buf.length < 28 || buf.toString('ascii', 0, 4) !== 'OggS') return 0
  const head = buf.subarray(0, Math.min(buf.length, 4096))
  const opus = head.indexOf(Buffer.from('OpusHead', 'ascii'))
  let rate = 0
  if (opus >= 0 && opus + 16 <= head.length) {
    // Opus 的 granule 一律按 48kHz 记
    rate = 48000
  } else {
    const vorbis = head.indexOf(Buffer.from('vorbis', 'ascii'))
    if (vorbis < 0 || head[vorbis - 1] !== 0x01 || vorbis + 14 > head.length) return 0
    rate = head.readUInt32LE(vorbis + 11)
  }
  let off = 0
  let granule = 0
  while (off + 27 <= buf.length) {
    if (buf.toString('ascii', off, off + 4) !== 'OggS') break
    const segments = buf[off + 26]
    const tableEnd = off + 27 + segments
    if (tableEnd > buf.length) break
    let body = 0
    for (let i = 0; i < segments; i++) body += buf[off + 27 + i]
    const pageEnd = tableEnd + body
    if (pageEnd > buf.length) break
    const g = Number(buf.readBigUInt64LE(off + 6))
    if (g > 0) granule = g
    off = pageEnd
  }
  if (!(granule > 0) || !(rate > 0)) return 0
  return granule / rate
}

/** M4A / MP4：找 mvhd 的 timescale 与 duration。认不出返回 0。 */
export function mp4Duration(buf) {
  const idx = buf.indexOf(Buffer.from('mvhd', 'ascii'))
  if (idx < 0 || idx + 20 > buf.length) return 0
  const version = buf[idx + 4]
  if (version === 1) {
    if (idx + 36 > buf.length) return 0
    const timescale = buf.readUInt32BE(idx + 24)
    const duration = Number(buf.readBigUInt64BE(idx + 28))
    return timescale > 0 && duration > 0 ? duration / timescale : 0
  }
  if (idx + 24 > buf.length) return 0
  const timescale = buf.readUInt32BE(idx + 16)
  const duration = buf.readUInt32BE(idx + 20)
  return timescale > 0 && duration > 0 ? duration / timescale : 0
}

/** 从内存里认格式并算时长（秒）。全认不出返回 0。 */
export function durationFromBuffer(buf) {
  if (!buf || buf.length < 16) return 0
  for (const probe of [wavDuration, mp3Duration, oggDuration, mp4Duration]) {
    const sec = probe(buf)
    if (sec > 0) return sec
  }
  return 0
}

/** 读文件头部后算时长（秒）。文件不存在 / 太大读不了都返回 0，不抛。 */
export function durationFromFile(file) {
  if (!file) return 0
  let fd = -1
  try {
    if (statSync(file).size < 16) return 0
    const size = Math.min(statSync(file).size, HEAD_BYTES)
    const buf = Buffer.allocUnsafe(size)
    fd = openSync(file, 'r')
    const read = readSync(fd, buf, 0, size, 0)
    return durationFromBuffer(buf.subarray(0, read))
  } catch { return 0 } finally {
    if (fd >= 0) try { closeSync(fd) } catch {}
  }
}

/**
 * 明确「0 采样」的 WAV：RIFF/WAVE 头里 data 块长度为 0。
 * `say` 失败时就是这种文件（afconvert 一转正好 4096 字节），发出去是一条没声音的语音。
 * 认不出格式的一律返回 false：不拿猜测去拦别人的音频。
 */
export function isZeroSampleWav(file) {
  let fd = -1
  try {
    const size = Math.min(statSync(file).size, 4096)
    if (size < 12) return false
    const buf = Buffer.allocUnsafe(size)
    fd = openSync(file, 'r')
    const read = readSync(fd, buf, 0, size, 0)
    const head = buf.subarray(0, read)
    if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') return false
    let off = 12
    while (off + 8 <= head.length) {
      const id = head.toString('ascii', off, off + 4)
      const chunk = head.readUInt32LE(off + 4)
      if (id === 'data') return chunk === 0
      if (chunk <= 0) return false
      off += 8 + chunk + (chunk & 1)
    }
    return false
  } catch { return false } finally {
    if (fd >= 0) try { closeSync(fd) } catch {}
  }
}
