// 发文字：清洗、表情标签、群 @、引用以及锚点被拒后的正文重发。

export function createTextSender({
  cleanOutboundText, cleaningFor, channelOf, getConfig, stripFaceTags,
  chatInfo, hasMention, membersOf, expandMentions, quote, mention,
  sendSegments, definiteFailure, log,
}) {
  return async function sendText(chatId, text, replyId, missed, userId, opts = {}) {
    // 先清洗，避免调用参数或提示词里的 @ / 表情变成真正的消息段。
    text = cleanOutboundText(text, cleaningFor(chatId))
    if (!text.trim()) return null
    const channel = channelOf(chatId)
    let segs = opts.literalCode
      ? [{ type: 'text', data: { text } }]
      : channel?.textSegments
        ? channel.textSegments(text, Boolean(getConfig().stickers.faces && channel.caps?.faces))
        : [{ type: 'text', data: { text: stripFaceTags(text) } }]
    const info = chatInfo(chatId)
    if (!opts.literalCode && info.kind === 'group' && hasMention(text)) {
      segs = expandMentions(segs, await membersOf(info.id, info.platform), missed)
    }
    if (!segs.length || (segs.length === 1 && segs[0].type === 'text' && !segs[0].data.text.trim())) return null
    const message = [...quote(replyId), ...mention(userId, segs), ...segs]
    const note = (replyId ? '[引用] ' : '') + text.slice(0, 60)
    // 引用/at 是“附加段”：网关拒绝过期引用或失效 @ 时整条会丢。明确失败时剥掉锚点重发正文。
    if (!replyId && !userId) return sendSegments(chatId, message, note, opts)
    try {
      return await sendSegments(chatId, message, note, { ...opts, throwOnError: true })
    } catch (error) {
      if (!definiteFailure(chatId, error)) return null
      const fallback = segs.filter((seg) => seg.type !== 'reply' && seg.type !== 'at')
      if (!fallback.length) return null
      log.warn(`引用/@ 被网关拒绝，剥掉锚点重发正文（${chatId}）：`, error.message)
      return sendSegments(chatId, fallback, note, opts)
    }
  }
}
