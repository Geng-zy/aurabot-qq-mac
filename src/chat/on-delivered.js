// 收到有效回执后的记账：消息 ID、心智发言、投喂回执和回复流水。

export function createOnDelivered({
  isDisposed, parseChat, sentIds, mind, log, recordReply, deliveredItems, bump,
}) {
  return function onDelivered({ chatId, message, note, messageId, system, replyJournal, replyFeed }) {
    const target = parseChat(chatId)
    if (isDisposed() || !target) return
    if (messageId !== undefined && messageId !== null) {
      sentIds.add(`${target.platform}:${messageId}`)
      if (sentIds.size > 500) sentIds.delete(sentIds.values().next().value)
    }
    if (!system) {
      try { mind?.said?.({ chatId, message, note, messageId }) } catch (error) { log.debug('心智记录发言失败：', error.message) }
      if (replyFeed) {
        try { mind?.confirmReplyFeed?.(chatId, replyFeed) } catch (error) { log.warn('记录聊天投喂失败：', error.message) }
      }
      if (replyJournal) recordReply(chatId, deliveredItems(message), { own: replyJournal === 'own' })
    }
    bump('sent')
    if (Array.isArray(message) && message.some(({ type }) => type === 'record')) bump('voice')
  }
}
