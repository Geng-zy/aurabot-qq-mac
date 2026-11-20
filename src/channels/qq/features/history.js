// QQ 历史消息：只封装 OneBot 的 get_group_msg_history / get_friend_msg_history。
export function createHistoryApi({ call, targetOf, isLegacyDirectRecord }) {
  return async function fetchHistory(chatId, count, { timeoutMs = 8000, retries, anchor } = {}) {
    const tgt = targetOf(chatId)
    if (!tgt) return []
    const base = tgt.kind === 'group' ? { group_id: Number(tgt.id) } : { user_id: Number(tgt.id) }
    const params = anchor ? { ...base, message_id: anchor, count, reverse_order: false } : { ...base, count }
    const rows = await call(tgt.kind === 'group' ? 'get_group_msg_history' : 'get_friend_msg_history', params, { timeoutMs, ...(retries !== undefined ? { retries } : {}) })
    return (Array.isArray(rows) ? rows : rows?.messages || [])
      .filter((row) => !isLegacyDirectRecord(row?.message ?? row?.raw_message))
  }
}
