// 发表情：平台原生表情优先，否则按普通图片降级；只有收到回执才记使用。

export function createStickerSender({
  channelOf, getConfig, stickers, sendSegments, quote, mention, bump,
}) {
  return async function sendSticker(chatId, query, replyId, userId, opts = {}) {
    const result = (status) => opts.detailed ? status : status === 'delivered' || status === 'simulated'
    const channel = channelOf(chatId)
    const native = channel?.caps?.stickers !== false
    if (!native && channel?.caps?.images === false) return result('disabled')
    if (!getConfig().stickers.enabled) return result('disabled')
    const item = query && typeof query === 'object' ? query : stickers.match(query)
    if (!item) return result('missing')
    if (!native && item.market) return result('disabled')
    const seg = stickers.segmentFor(item)
    if (!seg) return result('missing')
    let delivered = false
    const r = await sendSegments(chatId, [...quote(replyId), ...mention(userId), seg], `[表情] ${item.name || item.md5.slice(0, 8)}`, {
      ...opts,
      ...(native ? { sticker: { item, segment: seg } } : {}),
      onReceipt(confirmed) {
        delivered = confirmed.some(({ kind }) => kind === 'sticker' || (!native && kind === 'image'))
        if (delivered) {
          stickers.markUsed?.(item.md5)
          bump(native ? 'stickers' : 'sent')
        }
      },
    })
    if (r?.simulated) return result('simulated')
    if (r?.queued) return result('queued')
    return result(delivered ? 'delivered' : 'unconfirmed')
  }
}
