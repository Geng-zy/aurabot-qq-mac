// 她实际发出回复后的流水：群话题计时、私聊/群聊最后发言、代发记录和活动通知。

export function createReplyJournal({
  chatInfo, groupKey, groupSaid, groupEngaged, engageMs, logChat, saidElsewhere,
  getConfig, itemsToLine, onActivity, touchLastChat, touchPrivate, setLastBotToOwner,
}) {
  return function recordReply(chatId, confirmed, { own = false, userText = '' } = {}) {
    const said = itemsToLine(confirmed)
    if (!said) return
    const info = chatInfo(chatId)
    if (info.kind === 'group') {
      const gkey = groupKey(chatId)
      const times = (groupSaid.get(gkey) || []).filter((t) => Date.now() - t < 3600_000)
      times.push(Date.now())
      groupSaid.set(gkey, times)
      groupEngaged.set(gkey, Date.now() + engageMs) // 在群里说了话 = 加入了话题
    }
    logChat(chatId, 'bot', said)
    // 不是这个聊天自己那一轮发的：记下来，下次这个聊天交给她时告诉她自己说过什么。
    if (!own) saidElsewhere.set(chatId, [...(saidElsewhere.get(chatId) || []), { at: Date.now(), text: said.slice(0, 300) }].slice(-5))
    touchLastChat()
    if (info.kind === 'private') touchPrivate(info.id)
    const speech = confirmed.filter((i) => i.kind === 'text' || i.kind === 'voice')
    if (speech.length && info.kind === 'private' && info.platform === 'qq' && info.id === String(getConfig().ownerQQ)) {
      setLastBotToOwner({ at: Date.now(), text: speech.map((i) => i.value).join('\n') })
    }
    try { onActivity?.({ kind: 'out', chatId, reply: said, userText }) }
    catch (error) { /* 活动通知失败不影响发送 */ }
  }
}
