// QQ 出站：发消息、发文件，以及网关没连上时的补发队列决定。
import { OneBotError } from '../transport.js'

export function createOutboundApi({ call, targetOf, box, isDefiniteFailure, isReady = () => true }) {
  return {
    /**
     * 发一条消息。route.groupId：私聊是从群里临时会话来的，回的时候带上群号。
     * queue：确定没发出去（网关还没就绪）时放进补发队列，返回 { queued:true }；入不了队把原因写在 error.queueProblem 上再抛。
     */
    async send(chatId, message, { timeoutMs, route, queue = false, note = '', system = false, privacyRevision = '', replyJournal, replyFeed } = {}) {
      const tgt = targetOf(chatId)
      if (!tgt) throw new Error(`不是 QQ 的聊天：${chatId}`)
      const action = tgt.kind === 'group' ? 'send_group_msg' : 'send_private_msg'
      const sourceGroupId = tgt.kind === 'private' ? String(route?.groupId || '') : ''
      const params = tgt.kind === 'group' ? { group_id: Number(tgt.id), message } : { user_id: Number(tgt.id), ...(sourceGroupId ? { group_id: Number(sourceGroupId) } : {}), message }
      if (!isReady()) {
        const error = new OneBotError(action, { message: 'QQ 连接还没核对完' }, { transport: true })
        if (queue && box) {
          const q = box.add({ action, params, chatId, note, kind: system ? 'system' : 'reply', privacyRevision, replyJournal, replyFeed })
          if (q.ok) return { queued: true, queuedId: q.id, error }
          error.queueProblem = q.message
        }
        throw error
      }
      try {
        const r = await call(action, params, timeoutMs ? { timeoutMs } : undefined)
        return { ...(r && typeof r === 'object' ? r : {}), ...(r && r.message_id !== undefined ? { messageId: String(r.message_id) } : {}) }
      } catch (error) {
        // 只补发没连上网关的消息。网关明确拒绝了内容，或超时结果不明，都不重发。
        if (queue && box && error?.transport && isDefiniteFailure(error)) {
          const q = box.add({ action, params, chatId, note, kind: system ? 'system' : 'reply', privacyRevision, replyJournal, replyFeed })
          if (q.ok) return { queued: true, queuedId: q.id, error }
          error.queueProblem = q.message
        }
        throw error
      }
    },

    /** 发文件（upload_group_file / upload_private_file）。file 可以是本机路径、网址或 base64://。 */
    async sendFile(chatId, { file, name }, { timeoutMs } = {}) {
      if (!isReady()) throw new OneBotError('upload_file', { message: 'QQ 连接还没核对完' }, { transport: true })
      const tgt = targetOf(chatId)
      if (!tgt) throw new Error(`不是 QQ 的聊天：${chatId}`)
      const action = tgt.kind === 'group' ? 'upload_group_file' : 'upload_private_file'
      const params = tgt.kind === 'group' ? { group_id: Number(tgt.id), file, name } : { user_id: Number(tgt.id), file, name }
      return (await call(action, params, timeoutMs ? { timeoutMs } : undefined)) ?? {}
    },
  }
}
