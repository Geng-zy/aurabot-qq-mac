// QQ 的人和群：只做 OneBot action 封装，不负责消息收发或业务策略。
export function createPeopleApi({ call, targetOf, platform = 'qq' }) {
  return {
    /** 群成员：{ user_id, nickname, card, role, title, join_time … }（OneBot 的样子）。 */
    async member(chatId, userId, { timeoutMs = 5000, retries, fresh = false } = {}) {
      const tgt = targetOf(chatId)
      if (!tgt || tgt.kind !== 'group') return null
      return call('get_group_member_info', { group_id: Number(tgt.id), user_id: Number(userId), ...(fresh ? { no_cache: true } : {}) }, { timeoutMs, ...(retries !== undefined ? { retries } : {}) })
    },

    async members(chatId, { timeoutMs = 15000, fresh = false } = {}) {
      const tgt = targetOf(chatId)
      if (!tgt || tgt.kind !== 'group') return []
      const r = await call('get_group_member_list', { group_id: Number(tgt.id), ...(fresh ? { no_cache: true } : {}) }, { timeoutMs })
      return Array.isArray(r) ? r : r?.data || []
    },

    user: (userId, { timeoutMs = 5000 } = {}) => call('get_stranger_info', { user_id: Number(userId) }, { timeoutMs }),

    /** 群资料：{ name }。 */
    async group(chatId) {
      const tgt = targetOf(chatId)
      if (!tgt || tgt.kind !== 'group') return null
      // 查群名是锦上添花：失败就退回群号，别在网关抖动时白等重试
      const info = await call('get_group_info', { group_id: Number(tgt.id) }, { retries: 0 })
      return info ? { ...info, name: info.group_name || '' } : null
    },
  }
}
