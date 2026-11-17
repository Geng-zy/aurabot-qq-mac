// 入站感知和她真正发出去的话。
export function createPerception({ mind, log, now, debug, syncOwner, noteChatActivity, notRemembered, parseChat, personIn, refOfChat, windowOf, isOwnerChat, segmentsText, acceptsFood, getOutreach, resolveOwnerAbsence, checkOutreach, checkApproval, latestFoodOffer, fedSince, feed }) {
  function perceive(msg) {
    if (debug()) return false
    try {
      if (!parseChat(msg.chatId)) return false
      const who = personIn(msg.chatId, msg.userId)
      if (notRemembered(who)) return false
      syncOwner()
      if (msg.kind === 'private' || msg.mentioned) noteChatActivity()
      const receivedAt = now()
      const eventAt = Number(msg.time) * 1000
      const at = Number.isFinite(eventAt) && eventAt > 0 ? Math.min(receivedAt, eventAt) : receivedAt
      const recorded = mind.perceive({
        window: windowOf(msg.chatId),
        who,
        name: msg.nickname || '',
        text: String(msg.text || '').trim() || (msg.images?.length ? '[图片]' : msg.stickers?.length ? '[表情包]' : ''),
        msgId: msg.messageId || undefined,
        at,
        addressed: msg.mentioned || msg.addressed,
      })
      if (isOwnerChat(msg.chatId) && mind.isOwner(who) && recorded) {
        getOutreach().noteContact(at)
        resolveOwnerAbsence(msg.recovered ? getOutreach().lastContact() : receivedAt)
        checkOutreach(getOutreach().lastContact(), !msg.recovered)
        if (!msg.recovered) checkApproval(msg)
      }
      return recorded
    } catch (error) {
      log.warn('心智没记下这条消息：', error.message)
      return false
    }
  }

  function noteAddressed(msg) {
    if (debug() || !msg?.messageId) return
    const window = windowOf(msg.chatId)
    if (window) mind.noteAddressed(window, msg.messageId)
  }

  function said({ chatId, message, note, messageId, kind = 'reply' }) {
    if (debug()) return false
    try {
      const target = parseChat(chatId)
      if (!target || (target.kind === 'private' && notRemembered(refOfChat(chatId)))) return false
      noteChatActivity()
      const text = segmentsText(message, note)
      if (!text) return false
      const window = windowOf(chatId)
      const recorded = mind.said({ window, text, msgId: messageId !== undefined && messageId !== null ? String(messageId) : undefined, kind })
      if (recorded && kind === 'reply' && isOwnerChat(chatId) && acceptsFood(text)) {
        const giver = refOfChat(window)
        const offer = latestFoodOffer(window, giver)
        if (offer && !fedSince(offer)) feed(offer.food, giver, chatId)
      }
      return recorded
    } catch (error) {
      log.warn('心智没记下她说的话：', error.message)
      return false
    }
  }

  return { perceive, noteAddressed, said }
}
