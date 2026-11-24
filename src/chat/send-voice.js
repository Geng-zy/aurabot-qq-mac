// 发语音：TTS 合成、时长补齐、失败回退文字、表情单独补发。

import { readFileSync } from 'node:fs'
import { splitSpeakable } from './tags.js'
import { audioDurationSec } from './voice-file.js'
import { FILE_TIMEOUT_MS } from './file-policy.js'

export function createVoiceSender({
  cleanOutboundText, cleaningFor, channelOf, getConfig, audienceRevision, outputScope,
  mind, tts, sendText, sendSegments, log, failStore, definiteFailure,
}) {
  return async function sendVoice(chatId, text, replyId, userId, opts = {}) {
    text = cleanOutboundText(text, cleaningFor(chatId))
    if (!text.trim()) return false
    if (channelOf(chatId)?.caps?.voice === false) return Boolean(await sendText(chatId, text, replyId, undefined, userId, opts))
    const revision = audienceRevision(chatId)
    const scope = outputScope.getStore()
    if (!(scope?.chatId === chatId && scope.checkedText?.has(text)) && await mind?.checkOutgoingPrivacy?.(chatId, text)) return false
    const originalIsCurrent = opts.isCurrent
    const isCurrent = () => audienceRevision(chatId) === revision && (originalIsCurrent?.() ?? true)
    if (!isCurrent()) return false
    opts = { ...opts, isCurrent }
    let b64, engine, extras, transcript, voiceDuration = 0
    try {
      const split = splitSpeakable(text)
      extras = split.extras
      transcript = split.spoken
      if (!split.spoken) throw new Error('这条语音里只有表情/符号，没有能念的字')
      const voice = await tts.speak(split.spoken)
      engine = voice.engine
      b64 = readFileSync(voice.file).toString('base64')
      voiceDuration = audioDurationSec(voice.file, getConfig)
    } catch (error) {
      log.warn('语音没合成出来，改发文字：', error.message)
      await sendText(chatId, text, replyId, undefined, userId, opts)
      return false
    }
    // QQ 客户端不支持「引用 / @ + 语音」同一条消息：语音条一律单独成条。
    if (replyId || userId) log.debug(`语音条不能带引用/@（QQ 限制），单独发：${chatId}`)
    try {
      const r = await sendSegments(chatId, [{ type: 'record', data: { file: 'base64://' + b64, ...(voiceDuration ? { duration: voiceDuration } : {}) } }], `[语音·${engine}] ${transcript.slice(0, 120)}`, { ...opts, transcript, throwOnError: true, timeoutMs: FILE_TIMEOUT_MS })
      if (r || getConfig().dryRun || !getConfig().enabled) {
        if (extras && getConfig().voice.emojiSeparate !== false) {
          try {
            const sent = await sendText(chatId, extras, undefined, undefined, undefined, { ...opts, quiet: true })
            log.debug(sent ? `语音后面补发了一条表情：${chatId}` : '表情没补发出去（不影响语音条）')
          } catch (error) {
            log.debug('表情没补发出去：', error.message)
          }
        }
        return true
      }
      const message = '语音没有发送'
      log.warn(message)
      failStore.getStore()?.push(message)
      return false
    } catch (error) {
      if (definiteFailure(chatId, error)) {
        log.warn('语音没发出去，改发文字：', error.message)
        await sendText(chatId, text, replyId, undefined, userId, opts)
      } else {
        log.warn('语音发送结果不确定，不再改发文字：', error.message)
        failStore.getStore()?.push(error.message)
      }
      return false
    }
  }
}
