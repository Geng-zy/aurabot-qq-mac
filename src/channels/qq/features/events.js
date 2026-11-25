// QQ 入站事件的二次归类：戳一戳、群文件、通知。
import { noticeText } from '../notices.js'

export function createEventApi({ call, parse, selfId, faceName }) {
  const platform = 'qq'
  return {
    /** 群文件是单独的通知，不是消息：转成一条文件消息。 */
    async groupFileMessage(ev) {
      if (!ev?.file?.name) return null
      let nickname = String(ev.user_id)
      try {
        const m = await call('get_group_member_info', { group_id: ev.group_id, user_id: ev.user_id }, { timeoutMs: 5000 })
        nickname = String(m?.card || m?.nickname || nickname)
      } catch {}
      return parse({
        post_type: 'message', message_type: 'group', sub_type: 'normal', self_id: ev.self_id, group_id: ev.group_id, user_id: ev.user_id, message_id: 0,
        sender: { user_id: ev.user_id, nickname },
        message: [{ type: 'file', data: { name: ev.file.name, size: ev.file.size, id: ev.file.id, busid: ev.file.busid } }],
      })
    },

    /** 戳一戳通知 → { chatId, groupId, userId, selfId, action, suffix }；不是戳她的返回 null。 */
    pokeOf(ev) {
      const self = String(ev?.self_id || selfId())
      if (String(ev?.target_id) !== self) return null
      const groupId = ev.group_id ? String(ev.group_id) : ''
      const userId = String(groupId ? ev.user_id : ev.sender_id ?? ev.user_id)
      if (!userId || userId === self) return null
      return { platform, chatId: groupId ? `group:${groupId}` : `private:${userId}`, kind: groupId ? 'group' : 'private', groupId, userId, selfId: self, action: ev.action || '', suffix: ev.suffix || '', raw: ev }
    },

    /** 把一次戳一戳当成一条对她说的话。 */
    pokeMessage(poke, nickname) {
      const group = poke.groupId
      return parse({
        post_type: 'message', message_type: group ? 'group' : 'private', sub_type: group ? 'normal' : 'friend',
        self_id: Number(poke.selfId), user_id: Number(poke.userId), ...(group ? { group_id: Number(group) } : {}), message_id: 0,
        sender: { user_id: Number(poke.userId), nickname, card: nickname },
        message: [{ type: 'at', data: { qq: poke.selfId } }, { type: 'text', data: { text: ` [戳了戳你${poke.action ? '：' + poke.action + poke.suffix : ''}]` } }],
      })
    },

    /** 通知（撤回、进群、禁言……）→ { chatId, groupId, userId, people }；翻成一句话用 noticeText。 */
    noticeOf(ev) {
      if (ev?.post_type !== 'notice') return null
      const groupId = ev.group_id ? String(ev.group_id) : ''
      return { platform, groupId, userId: String(ev.user_id ?? ''), people: [...new Set([ev.user_id, ev.operator_id, ev.sender_id].filter(Boolean).map(String))], raw: ev }
    },

    noticeText: (notice, { name, ownMessage } = {}) => noticeText(notice.raw, { botQQ: selfId(), name, ownMessage, faceName }),
  }
}
