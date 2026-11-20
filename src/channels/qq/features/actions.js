import { fetchImage } from '../../../core/net.js'

// QQ 的轻量动作：贴表情、戳一戳、输入状态、语音转 wav / 转文字。
export function createActionsApi({ call, targetOf }) {
  return {
    async react(chatId, messageId, emojiId) {
      await call('set_msg_emoji_like', { message_id: String(messageId), emoji_id: String(emojiId), set: true }, { timeoutMs: 10000 })
    },

    async poke(chatId, userId) {
      const tgt = targetOf(chatId)
      await call('send_poke', { user_id: Number(userId), ...(tgt?.kind === 'group' ? { group_id: Number(tgt.id) } : {}) }, { timeoutMs: 10000 })
    },

    /** 「对方正在输入」：QQ 只有私聊有。 */
    async typing(chatId) {
      const tgt = targetOf(chatId)
      if (!tgt || tgt.kind !== 'private') return
      await call('set_input_status', { user_id: Number(tgt.id), event_type: 1 }, { timeoutMs: 5000 })
    },

    /** 语音条 → wav（原始字节，没转采样率）。QQ 语音是 silk，让网关转。 */
    async voiceWav(rec) {
      const info = await call('get_record', { file: rec.data?.file, out_format: 'wav' }, { timeoutMs: 30000 })
      return info?.base64 ? Buffer.from(info.base64, 'base64') : await fetchImage(info?.file || info?.url, { maxBytes: 30 * 1024 * 1024 })
    },

    /** QQ 自己的语音转文字。 */
    async voiceText(msg) {
      const r = await call('fetch_ptt_text', { message_id: Number(msg.messageId) || msg.messageId }, { timeoutMs: 20000 })
      return String(r?.text || '').trim()
    },
  }
}
