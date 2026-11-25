// 消息段最终出口：清洗、扩展钩子、隐私检查、截断、调试/试运行、网关发送和回执。

export function createSendSegments({
  isDisposed, targetOf, cleaningFor, cleanOutboundSegments, hooks, log, outputScope,
  audienceRevision, getMind, capOutboundText, captureStore, getConfig, channelOf,
  privateSources, normChat, deliveredItems, onDelivered, bump, failStore,
}) {
  return async function sendSegments(chatId, message, note, { force = false, isCurrent = null, throwOnError = false, timeoutMs, quiet = false, system = false, sensitive = false, allowQueue = true, transcript, sticker, onReceipt } = {}) {
    if (isDisposed()) return null
    const tgt = targetOf(chatId)
    if (!tgt) return null
    const cleaning = cleaningFor(chatId)
    message = cleanOutboundSegments(message, cleaning)
    if (!message.length) return null
    if (hooks?.send) {
      try {
        const next = await hooks.send(message, { chatId, note, force })
        if (next === null) { log.info(`扩展模块拦下了 → ${chatId}：${note}`); return null }
        if (Array.isArray(next)) message = next
      } catch (error) {
        log.warn('扩展模块改写发送内容出错：', sensitive ? '敏感命令回执' : error.message)
      }
    }
    message = cleanOutboundSegments(message, cleaning)
    if (!message.length || isDisposed() || (isCurrent && !isCurrent())) return null
    const activeScope = outputScope.getStore()
    const scope = activeScope?.chatId === chatId ? activeScope : null
    const displayed = message.filter((seg) => seg.type === 'text').map((seg) => seg.data?.text || '').join('')
    if (displayed && !(scope?.chatId === chatId && scope.checkedText?.has(displayed))) {
      const revision = audienceRevision(chatId)
      if (await getMind()?.checkOutgoingPrivacy?.(chatId, displayed)) return null
      if (isDisposed() || audienceRevision(chatId) !== revision || (isCurrent && !isCurrent())) return null
    }
    message = capOutboundText(message, (seg) => seg.type === 'text' ? seg.data?.text : undefined,
      (seg, text) => ({ ...seg, data: { ...seg.data, text } }))
    const cap = captureStore.getStore()
    if (cap) {
      cap.push({ chatId, note, message })
      if (scope) scope.simulated++
      return { message_id: 'sim-' + cap.length, simulated: true }
    }
    const cfg = getConfig()
    if (cfg.debug) {
      log.info(`调试（没真发）→ ${chatId}：${note}`)
      return null
    }
    if (!force) {
      if (!cfg.enabled) { log.info(`总开关关着，没发 → ${chatId}：${note}`); return null }
      if (cfg.dryRun) { log.info(`试运行（没真发）→ ${chatId}：${note}`); return null }
    }
    const channel = channelOf(chatId)
    if (!channel) { log.warn(`发不出去：${chatId} 所在的平台没有连接`); return null }
    const sourceGroupId = tgt.kind === 'private' ? privateSources.get(normChat(chatId)) : ''
    const confirmed = scope || onReceipt ? deliveredItems(message, { transcript, sticker }) : []
    const replyFeed = !system && !sensitive && confirmed.some(({ kind }) => kind === 'text' || kind === 'voice') ? scope?.feed : undefined
    try {
      const r = await channel.send(chatId, message, { timeoutMs, route: sourceGroupId ? { groupId: sourceGroupId } : undefined, queue: allowQueue && !sensitive, note, system, privacyRevision: audienceRevision(chatId), replyJournal: scope?.journal, replyFeed })
      if (r?.queued) {
        if (scope) scope.queued++
        log.warn(`发到 ${chatId} 时网关还没就绪，已排队补发：${note || r.error?.message || ''}`)
        return { queued: true, queuedId: r.queuedId }
      }
      if (!r || r.simulated) return r
      if (scope) scope.delivered.push(...confirmed)
      if (replyFeed) scope.feed = undefined
      try { onReceipt?.(confirmed) } catch (error) { log.warn('记录发送回执出错：', error.message) }
      onDelivered({ chatId, message, note, messageId: r?.message_id ?? r?.messageId, system: system || sensitive, replyFeed })
      return r
    } catch (error) {
      if (error?.queueProblem) log.warn(`发到 ${chatId} 失败，且无法入队（${error.queueProblem}）：`, error.message)
      bump('errors')
      const detail = sensitive ? '敏感命令回执发送失败' : error.message
      log.warn(`发到 ${chatId} 失败：`, detail)
      if (throwOnError) throw error
      if (!quiet) failStore.getStore()?.push(detail)
      return null
    }
  }
}
