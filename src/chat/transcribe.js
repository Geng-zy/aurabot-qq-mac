// 语音转文字：本地接口、云端 ASR、QQ 网关和 DSH SenseVoice。

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function createTranscriber({
  getConfig, channelOf, localApi, log, dsh, toMono16k, asrConfigured, transcribeAudio,
}) {
  /** QQ 语音是 silk：让网关转成 wav，再统一成 16kHz 单声道 PCM16。 */
  async function recordWav(rec, suppliedWav, chatId) {
    if (suppliedWav) return toMono16k(suppliedWav)
    const channel = channelOf(chatId)
    if (!channel?.voiceWav) throw new Error('这个平台取不了语音')
    return toMono16k(await channel.voiceWav(rec))
  }

  async function localTranscribe(rec, suppliedWav, chatId) {
    const stt = dsh.get('speechToText')
    if (!stt || typeof stt.resolve !== 'function' || typeof stt.transcribe !== 'function') throw new Error('DSH 没开启语音输入')
    // 模型还没下载好：顺手开始准备（下载一次，之后常驻），这一条先算没听清
    const snap = typeof stt.snapshot === 'function' ? stt.snapshot() : null
    const pid = snap?.selection?.providerId
    const prov = snap?.providers?.find((p) => p.id === pid)
    if (prov && prov.preparation && !['ready', 'standby'].includes(prov.preparation.phase)) {
      try { stt.prepare(pid) } catch {}
      throw new Error(`识别模型还在准备（${prov.preparation.phase}）`)
    }
    const spec = stt.resolve({ audio: new Uint8Array(await recordWav(rec, suppliedWav, chatId)) })
    const r = await stt.transcribe(spec, AbortSignal.timeout(60000))
    const text = typeof r === 'string' ? r : r?.text || r?.transcript
    return text ? String(text).trim() : ''
  }

  async function transcribe(msg, suppliedWav) {
    for (const rec of msg.records) {
      if (localApi?.active('asr')) {
        try {
          const wav = await recordWav(rec, suppliedWav, msg.chatId)
          const dir = mkdtempSync(join(tmpdir(), 'aurabot-asr-'))
          try {
            const file = join(dir, 'input.wav')
            writeFileSync(file, wav)
            const r = await localApi.call('asr', { file })
            const text = String(typeof r === 'string' ? r : r?.text || '').trim()
            if (text) return `[语音] ${text}`
          } finally { rmSync(dir, { recursive: true, force: true }) }
        } catch (error) {
          log.debug('本地接口语音识别失败：', error.message)
        }
      }
      const voiceCfg = getConfig().voice
      const viaCloud = async () => {
        if (!asrConfigured(voiceCfg)) return ''
        try { return await transcribeAudio(await recordWav(rec, suppliedWav, msg.chatId), voiceCfg, log) } catch (error) {
          log.debug('云端语音识别失败：', error.message)
          return ''
        }
      }
      const viaQq = async () => {
        if (suppliedWav) return ''
        try {
          const channel = channelOf(msg.chatId)
          return channel?.voiceText ? await channel.voiceText(msg) : ''
        } catch (error) {
          log.debug('QQ 语音转文字失败：', error.message)
          return ''
        }
      }
      const order = voiceCfg.asrApi?.prefer === 'cloud' ? [viaCloud, viaQq] : [viaQq, viaCloud]
      for (const via of order) {
        const text = await via()
        if (text) return `[语音] ${text}`
      }
      try {
        const text = await localTranscribe(rec, suppliedWav, msg.chatId)
        if (text) return `[语音] ${text}`
      } catch (error) {
        log.debug('本地语音识别失败：', error.message)
      }
      return '[发来一条语音，没听清]'
    }
    return ''
  }

  return { transcribe, localTranscribe, recordWav }
}
