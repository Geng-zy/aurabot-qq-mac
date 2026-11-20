// 引用消息的补取：引用段只有 message_id 时，从历史里找回原文。
export function createQuoteApi({ call, targetOf, parse, fetchHistory, log, isLegacyDirectRecord }) {
  const quoteSegUsable = (seg) => {
    const d = (seg && seg.data) || {}
    return [d.url, d.file].some((x) => typeof x === 'string'
      && (/^https?:\/\//i.test(x) || x.startsWith('base64://') || x.startsWith('file://') || /^[a-zA-Z]:[\\/]/.test(x)))
  }
  const quoteNeedsHistory = (parsed) => [...(parsed.images || []), ...(parsed.stickers || [])].some((seg) => !quoteSegUsable(seg))

  async function quoteFromHistory(chatId, id) {
    // 先用引用 id 当锚点（能取到更早的消息），拿不到再退回「最近 30 条」
    const anchor = /^-?\d+$/.test(id) ? Number(id) : 0
    const attempts = anchor ? [{ anchor, count: 5 }, { count: 30 }] : [{ count: 30 }]
    for (const a of attempts) {
      try {
        const list = await fetchHistory(chatId, a.count, { anchor: a.anchor, retries: 0 })
        const hit = list.find((m) => String(m?.message_id ?? '') === id || String(m?.real_id ?? '') === id)
        if (hit) return hit
      } catch (error) {
        log.debug(`引用消息历史也拉不到（${id}）：`, error.message)
      }
    }
    return null
  }

  async function quote(chatId, id) {
    const tgt = targetOf(chatId)
    if (!tgt) throw new Error('引用没有对应的聊天')
    const number = Number(id)
    let m = await call('get_msg', { message_id: Number.isSafeInteger(number) ? number : id }, { timeoutMs: 5000, retries: 0 })
    if (isLegacyDirectRecord(m?.message ?? m?.raw_message)) throw new Error('这条历史记录不对聊天模型开放')
    const group = m?.group_id && String(m.group_id) !== '0' ? String(m.group_id) : ''
    const author = String(m?.sender?.user_id ?? m?.user_id ?? '')
    const peer = String(m?.target_id ?? m?.peer_id ?? '')
    if ((m?.message_type && m.message_type !== tgt.kind) || (group && (tgt.kind !== 'group' || group !== tgt.id))) {
      throw new Error('引用来自其他聊天')
    }
    const inChat = tgt.kind === 'group' ? group === tgt.id
      : m?.message_type === 'private' && (author === tgt.id || peer === tgt.id)
    if (!inChat) {
      m = await quoteFromHistory(chatId, String(id))
      if (!m) throw new Error('无法确认引用属于这个聊天')
    }
    let time = Number(m?.time) || 0
    const sender = m?.sender || {}
    const userId = String(sender.user_id ?? m?.user_id ?? '')
    const nickname = String(sender.card || sender.nickname || userId || '某人')
    const kind = tgt?.kind === 'group' ? 'group' : 'private'
    const groupId = kind === 'group' ? tgt.id : undefined
    let parsed = parse({ message_type: kind, group_id: groupId, user_id: userId, sender, message: m?.message ?? m?.raw_message ?? '' })
    if (tgt && quoteNeedsHistory(parsed)) {
      const hit = await quoteFromHistory(chatId, String(id))
      if (hit) {
        time ||= Number(hit?.time) || 0
        const again = parse({ message_type: kind, group_id: groupId, user_id: userId, sender: hit.sender || sender, message: hit.message ?? '' })
        if (!quoteNeedsHistory(again)) parsed = again
        else { parsed.images = [...(parsed.images || []), ...(again.images || [])]; parsed.stickers = [...(parsed.stickers || []), ...(again.stickers || [])] }
      }
    }
    return { time, userId, nickname, msg: parsed }
  }

  return { quoteSegUsable, quoteNeedsHistory, quoteFromHistory, quote }
}
