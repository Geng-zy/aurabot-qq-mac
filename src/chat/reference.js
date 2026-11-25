// 消息引用/最近媒体到图片附件的转换，以及「是否在回复机器人」判断。

export function createReferenceTools({
  isDisposed, disposedError, getConfig, isOwner, quotedInfo, quoteCache, imagesOf,
  recentMedia, segmentBytes, channelOf, maxImageBytes, sentIds, parseChat,
}) {
  const senderLabel = (chatId, uid) => isOwner(getConfig(), uid, chatId) ? '管理员本人' : '其他人'

  async function quoteImages(q, take = 2) {
    if (!q?.ok || take <= 0) return []
    const segs = [...q.images, ...q.stickers].slice(0, take)
    if (!segs.length) return []
    const got = await imagesOf({ chatId: q.chatId, stickers: [], images: segs })
    return got.map((x, i) => ({ type: 'image', data: x.data, mediaType: x.mediaType, name: `quote-${q.uid || 'x'}-${i + 1}` }))
  }

  async function referenceImage(chat, source = 'last', { replyId } = {}) {
    if (isDisposed()) throw disposedError()
    let seg
    if (source === 'quote') {
      const now = Date.now()
      const q = replyId === undefined
        ? [...quoteCache.values()].findLast((item) => item.chatId === chat.chatId && item.ok && item.at <= now && now - item.at < 30 * 60_000)
        : await quotedInfo(replyId, chat)
      seg = q?.images.at(-1) || q?.stickers.at(-1)
    } else {
      seg = recentMedia.get(chat.chatId).at(-1)?.seg
    }
    if (!seg) throw new Error(source === 'quote' ? '当前聊天没有可用的引用图片，请引用带图的消息再试' : '当前聊天最近半小时没有收到图片，请先发一张图')
    return segmentBytes(seg, channelOf(chat.chatId), { maxBytes: maxImageBytes, allowLocal: false })
  }

  async function repliedToBot(replyId, msg) {
    if (!replyId) return false
    if (sentIds.has(`${parseChat(msg.chatId)?.platform}:${replyId}`)) return true
    const q = await quotedInfo(replyId, msg)
    return Boolean(q && q.ok && q.isBot)
  }

  return { senderLabel, quoteImages, referenceImage, repliedToBot }
}
