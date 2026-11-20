// 引用消息的补取：引用段只有 message_id 时，从历史里找回原文。
export function createQuoteApi({ fetchHistory, log }) {
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

  return { quoteSegUsable, quoteNeedsHistory, quoteFromHistory }
}
