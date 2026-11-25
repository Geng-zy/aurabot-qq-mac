// 引用消息解析：QQ 引用只有 message_id，正文要再取一次；带短期缓存。

const CACHE_MAX = 200

export function createQuoteResolver({ channelOf, getConfig, selfId, log }) {
  const cache = new Map() // chatId|replyId → { ok, who, uid, text, images, stickers, records, isBot }

  async function quotedInfo(replyId, ctx = null) {
    const id = String(replyId || '')
    if (!id) return null
    const chatId = ctx?.chatId || (ctx?.groupId ? `group:${ctx.groupId}` : ctx?.userId ? `private:${ctx.userId}` : '')
    const key = `${chatId}|${id}`
    if (cache.has(key)) {
      const cached = cache.get(key)
      cached.at = Date.now()
      cache.delete(key)
      cache.set(key, cached)
      return cached
    }
    const out = { ok: false, who: '', uid: '', text: '', images: [], stickers: [], records: 0, isBot: false, at: 0, chatId, time: 0 }
    try {
      const channel = channelOf(chatId)
      if (!channel?.quote) throw new Error('这个平台读不了引用')
      const q = await channel.quote(chatId, id)
      // 被引用那条消息的发生时间，供「今晚/昨天」按历史时刻理解。
      out.time = q.time
      out.uid = q.userId
      out.who = q.nickname
      const parsed = q.msg
      out.text = String(parsed.text || '').trim().slice(0, 300)
      out.images = parsed.images || []
      out.stickers = parsed.stickers || []
      out.records = (parsed.records || []).length
      out.isBot = out.uid === String(selfId || getConfig().botQQ)
      out.ok = true
      out.at = Date.now()
    } catch (error) {
      log.debug(`引用消息没拉到（${id}）：`, error.message)
    }
    if (out.ok) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
      cache.set(key, out)
    }
    return out
  }

  quotedInfo.cache = cache
  return quotedInfo
}
