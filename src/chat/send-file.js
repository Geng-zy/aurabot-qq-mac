// 把一个文件发到聊天平台：本机路径优先、明确失败才回落 base64/本机下载口。
// 依赖由 hub 注入，文件策略在 file-policy.js。

import { readFileSync } from 'node:fs'
import { checkSendableFile, fileLabel, FILE_TIMEOUT_MS, FILE_BASE64_MAX } from './file-policy.js'

export function createFileSender({
  isDisposed, getConfig, targetOf, channelOf, definiteFailure,
  cleanOutboundText, cleaningFor, captureStore, fileRelay, bump, log, workspaceDirOf,
}) {
  return async function sendFile(chatId, file, name) {
    if (isDisposed()) return null
    const cfg = getConfig()
    const tgt = targetOf(chatId)
    if (!tgt) return null
    if (!cfg.files?.enabled) throw new Error('发文件没打开（面板「聊天」页 → 发文件），打开后才能发')
    const { src, external, size, maxBytes } = checkSendableFile(cfg, file, workspaceDirOf)
    // 文件显示名也会出现在 QQ 文件卡片上：和正文一样过一遍出站清洗。
    const label = cleanOutboundText(fileLabel(name, src), cleaningFor(chatId)).trim() || '文件'
    const cap = captureStore.getStore()
    if (cap) {
      cap.push({ chatId, note: `[文件] ${label}`, message: [{ type: 'file', data: { file: src, name: label } }] })
      return { message_id: 'sim-' + cap.length, simulated: true }
    }
    if (cfg.debug) { log.info(`调试（没真发）→ ${chatId}：[文件] ${label}`); return null }
    if (!cfg.enabled) { log.info(`总开关关着，没发 → ${chatId}：[文件] ${label}`); return null }
    if (cfg.dryRun) { log.info(`试运行（没真发）→ ${chatId}：[文件] ${label}`); return null }
    const channel = channelOf(chatId)
    if (!channel?.sendFile || !channel.caps?.files) throw new Error('这个平台发不了文件')
    const srcLabel = external ? (src.startsWith('base64://') ? 'base64' : '外部地址') : size < 1024 ? size + ' B' : Math.round(size / 1024) + ' KB'
    // 「按路径直发」关着（默认）：网关在 Docker 里读不到本机路径，不先按路径试一次。
    const byPath = external || cfg.files?.imageByPath !== false
    let first = null
    if (byPath) {
      try {
        const r = await channel.sendFile(chatId, { file: src, name: label }, { timeoutMs: FILE_TIMEOUT_MS })
        if (isDisposed()) return null
        bump('sent')
        log.info(`${chatId}：发文件「${label}」（${srcLabel}）`)
        return r
      } catch (error) {
        if (isDisposed()) return null
        // 只有明确失败时才回落：超时或断线可能已经发出，再发会重复。
        if (external || !definiteFailure(chatId, error)) {
          bump('errors')
          log.warn(`${chatId}：发文件「${label}」失败${definiteFailure(chatId, error) ? '' : '，发送结果不确定，不再重发'}：`, error.message)
          throw new Error(`发文件失败：${error.message}`)
        }
        first = error
      }
    }
    const firstWhy = first?.message || '网关读不到本机路径（「按路径直发」关着）'
    const viaRelay = size > Math.min(FILE_BASE64_MAX, maxBytes)
    if (viaRelay && cfg.files?.relay === false) {
      bump('errors')
      log.warn(`${chatId}：发文件「${label}」失败：${firstWhy}；文件超过 ${FILE_BASE64_MAX / 1024 / 1024} MB，且「大文件下载口」关着`)
      throw new Error(`发文件失败：${firstWhy}`)
    }
    let url = ''
    try {
      const file = viaRelay ? (url = await fileRelay.offer(src, label)) : 'base64://' + readFileSync(src).toString('base64')
      const r = await channel.sendFile(chatId, { file, name: label }, { timeoutMs: FILE_TIMEOUT_MS })
      if (isDisposed()) return null
      bump('sent')
      log.info(`${chatId}：发文件「${label}」（${srcLabel}，${first ? '网关看不到本机路径，改走' : '走'}${viaRelay ? '本机下载口' : ' base64'}）`)
      return r
    } catch (error2) {
      if (isDisposed()) return null
      bump('errors')
      log.warn(`${chatId}：发文件「${label}」失败：`, error2.message || firstWhy)
      throw new Error(`发文件失败：${error2.message || firstWhy}`)
    } finally {
      if (url) fileRelay.revoke(url)
    }
  }
}
