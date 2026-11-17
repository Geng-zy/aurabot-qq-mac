// 聊天停下来/换会话时，把还没记的经历记进记忆。
export function createEncoding({ mem, log, opts, windowOf, isClosed, debug }) {
  let encodingP = null

  async function encodeTick() {
    if (encodingP || isClosed() || !opts.ask || debug()) return
    encodingP = mem.encodePending().catch((error) => log.warn('记经历出错：', error.message)).finally(() => { encodingP = null })
    await encodingP
  }

  /** 换新会话时：把这个聊天里还没记的马上记成经历（不等聊天停下来）。 */
  async function encodeChat(chatId) {
    if (isClosed() || !opts.ask || debug()) return 0
    const window = windowOf(chatId)
    const through = mem.pendingThrough(window)
    if (!through) return 0
    while (encodingP) await encodingP.catch(() => {})
    if (isClosed() || debug()) return 0
    encodingP = mem.encodeThrough(window, through, () => !isClosed() && !debug())
      .catch((error) => { log.warn('换会话时记经历出错：', error.message); return 0 })
      .finally(() => { encodingP = null })
    return encodingP
  }

  return { encodeTick, encodeChat }
}
