// 「她挑表情」的暂存：这一轮收到的表情按会话记着，她想收时凭编号来取。
// 落盘一份，DSH 重启后仍能收；过期时间与「最近图片」同一尺度。
import { readJson, writeJson } from '../core/store.js'

export const STICKER_STASH_TTL = 30 * 60_000

export function createStickerStash({ file, log, ttl = STICKER_STASH_TTL } = {}) {
  const stash = new Map() // chatId → { at, segs }
  let loaded = false

  function load() {
    if (loaded) return
    loaded = true
    try {
      const raw = readJson(file(), () => ({}))
      const now = Date.now()
      for (const [chatId, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
        if (value && Array.isArray(value.segs) && value.segs.length && now - Number(value.at || 0) < ttl) {
          stash.set(chatId, { at: Number(value.at) || now, segs: value.segs })
        }
      }
    } catch (error) { log?.debug?.('读取表情暂存失败：', error.message) }
  }

  function save() {
    const now = Date.now()
    const out = {}
    for (const [chatId, value] of stash) if (value && now - value.at < ttl) out[chatId] = value
    try { writeJson(file(), out) } catch (error) { log?.debug?.('保存表情暂存失败：', error.message) }
  }

  /** 记下这一轮收到的表情，返回张数。 */
  function remember(chatId, segs) {
    load()
    const list = (segs || []).slice(0, 4)
    if (!list.length) return 0
    stash.set(chatId, { at: Date.now(), segs: list })
    save()
    return list.length
  }

  /** 取第 index 张（从 1 开始）。过期或没有就返回 null。 */
  function get(chatId, index) {
    load()
    const entry = stash.get(chatId)
    if (!entry || Date.now() - entry.at > ttl) return null
    const i = Number(index) - 1
    return Number.isInteger(i) && i >= 0 && i < entry.segs.length ? entry.segs[i] : null
  }

  /**
   * 「她挑」模式那句轻提示。
   * 措辞要像她自己的念头，不能像发图的人在提醒她 —— 否则每来一张表情她就回报一次
   * “我收了 / 我已经有了”，完全不像偷偷攒表情。收不收、说不说都随她。
   */
  function hint(n) {
    const range = n > 1 ? `1~${n}` : '1'
    return `（这轮里夹着 ${n} 张表情，是你自己看到的。有中意的就用 qq_collect_sticker ${range} 收进自己库；收表情是你自己的小爱好，不用每张都跟对方说，偶尔提一句也行。）`
  }

  function clear() {
    stash.clear()
    loaded = false
  }

  return { remember, get, hint, clear }
}
