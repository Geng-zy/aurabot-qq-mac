// 发图：本地路径优先直发，明确失败才回 base64；结果不确定不重发。

import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

export function createImageSender({
  isDisposed, getConfig, quote, mention, sendSegments, log, definiteFailure, fetchImage, maxBytes,
}) {
  return async function sendImage(chatId, src, replyId, userId, opts = {}) {
    if (isDisposed()) return null
    const s = String(src ?? '').trim()
    const head = [...quote(replyId), ...mention(userId)]
    const local = isAbsolute(s) ? s : /^file:\/\//i.test(s) ? s : ''
    if (local && getConfig().files?.imageByPath !== false) {
      const file = local.startsWith('file://') ? local : pathToFileURL(local).href
      try {
        const r = await sendSegments(chatId, [...head, { type: 'image', data: { file } }], `[图片·路径] ${local.slice(-40)}`, { ...opts, throwOnError: true })
        if (r) {
          log.debug(`${chatId}：按路径发图「${local.slice(-40)}」`)
          return r
        }
        return null
      } catch (error) {
        if (!definiteFailure(chatId, error)) {
          log.warn(`${chatId}：按路径发图失败，发送结果不确定，不再重发：`, error.message)
          if (opts.strict) throw new Error(`图片可能已经发出去了，但网关没确认：${error.message}`)
          return null
        }
        log.debug(`${chatId}：按路径发不出去，改用 base64：`, error.message)
      }
    }
    let buf
    try { buf = await fetchImage(s, { maxBytes }) }
    catch (error) {
      log.warn('图片发不出去：', error.message)
      return opts.strict ? false : null
    }
    try {
      return await sendSegments(chatId, [...head, { type: 'image', data: { file: 'base64://' + buf.toString('base64') } }], `[图片] ${s.slice(-40)}`, { ...opts, throwOnError: opts.strict || opts.throwOnError })
    } catch (error) {
      if (opts.strict && definiteFailure(chatId, error)) return false
      if (opts.strict) throw new Error(`图片可能已经发出去了，但网关没确认：${error.message}`)
      throw error
    }
  }
}
