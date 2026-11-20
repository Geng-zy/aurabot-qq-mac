// QQ 专有表情：从机器人号「我喜欢的」导入。通用表情库不直接碰 OneBot。
import { fetchImage } from '../../../core/net.js'

export function createQqStickerHooks({ onebot, log }) {
  return {
    async addCustomFace(buf) {
      return onebot.call('add_custom_face', { file: 'base64://' + buf.toString('base64') })
    },
    async modifyCustomFace(emojiId, desc) {
      return onebot.call('modify_custom_face', { emoji_id: emojiId, desc })
    },
    async deleteCustomFace(emojiId) {
      return onebot.call('delete_custom_face', { emoji_id: emojiId })
    },
  }
}

export function createQqStickerBridge({ onebot, store, getConfig, log }) {
  let importing = null

  async function importFromQQ({ limit = getConfig().stickers.maxLibrary } = {}) {
    if (importing) return importing
    importing = (async () => {
      let urls
      try {
        const r = await onebot.call('fetch_custom_face', { count: Math.max(1, Math.min(500, Number(limit) || 300)) }, { timeoutMs: 30000 })
        urls = (Array.isArray(r) ? r : r?.data || []).map((x) => (typeof x === 'string' ? x : x?.url || '')).filter(Boolean)
      } catch (error) {
        return { ok: false, message: '读不到机器人号的 QQ 收藏表情：' + error.message }
      }
      let added = 0
      let existed = 0
      let failed = 0
      for (const url of urls) {
        let buf
        try { buf = await fetchImage(url, { maxBytes: 1024 * 1024 * 1024 }) } catch (error) { failed++; continue }
        const r = await store.addFromBuffer(buf, { from: 'qq', toQQ: false })
        if (r.ok && !r.existed) added++
        else if (r.ok && r.existed) existed++
        else failed++
      }
      log.info(`从 QQ 收藏导入表情：新加 ${added} 张，已有 ${existed} 张${failed ? `，${failed} 张下不来` : ''}`)
      // 通用库负责起名；这里只触发一次，不把 QQ 的 store 内部逻辑搬过来。
      if (added && getConfig().stickers.caption) {
        try { store.captionLibrary({ limit: added }) } catch (error) { log.warn('给导入的表情起名出错：', error.message) }
      }
      return { ok: true, added, existed, failed, total: urls.length, message: urls.length ? `QQ 收藏里有 ${urls.length} 张：新导入 ${added} 张，已经有 ${existed} 张${failed ? `，${failed} 张下载失败` : ''}${added && getConfig().stickers.caption ? '。名字在后台慢慢起' : ''}` : 'QQ 收藏里没有表情' }
    })().finally(() => { importing = null })
    return importing
  }

  return { importFromQQ }
}
