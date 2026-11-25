// 语音条文件发送：时长探测 + 音频文件 base64 发送。

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { findFfmpeg } from '../core/img.js'
import { durationFromFile } from '../voice/duration.js'

/**
 * OneBot 的 record 段需要时长；不带的话网关会以
 * `Input does not contain a known duration` 直接拒收。
 * 先自己解容器（WAV/MP3/OGG/M4A），没装 ffmpeg 也能算；认不出才回落 ffmpeg。
 */
export function audioDurationSec(file, getConfig) {
  if (!file) return 0
  const own = durationFromFile(file)
  if (own > 0) return Math.max(1, Math.round(own))
  const ffmpeg = findFfmpeg(getConfig().local?.ffmpegPath || '')
  if (!ffmpeg) return 0
  try {
    const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8', timeout: 5000 })
    const m = String(r.stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
    if (!m) return 0
    return Math.max(1, Math.round(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])))
  } catch { return 0 }
}

export function createVoiceFileSender({ isDisposed, channelOf, getConfig, sendSegments, durationOf }) {
  return async function sendVoiceFile(chatId, file, note, opts) {
    if (isDisposed()) return null
    if (channelOf(chatId)?.caps?.voice === false) throw new Error('这个平台不支持语音')
    const b64 = readFileSync(file).toString('base64')
    const duration = durationOf(file)
    const r = await sendSegments(chatId, [{ type: 'record', data: { file: 'base64://' + b64, ...(duration ? { duration } : {}) } }], note || '[语音]', opts)
    if (!r && getConfig().enabled && !getConfig().dryRun) throw new Error('网关没接受这条语音')
    return r
  }
}
