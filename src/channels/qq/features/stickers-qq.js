// QQ 专有表情：从机器人号「我喜欢的」导入。通用表情库不直接碰 OneBot。
import { readFileSync } from 'node:fs'
import { fetchImage, segmentBytes } from '../../../core/net.js'
import { defineTool, int, str } from '../../../tools/tools.js'
import { ownerOrFree } from '../../../chat/access.js'
import { parseChat } from '../../ids.js'
import { resolvePainting } from '../../../features/paintings.js'

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
    readMarket(seg) {
      const d = seg?.data || {}
      const emojiId = String(d.emoji_id ?? d.emojiId ?? '').trim()
      if (!emojiId) return null
      return { emojiId, packageId: Number(d.emoji_package_id ?? d.emojiPackageId ?? 0) || 0, key: String(d.key ?? '') }
    },
    nativeSegment(item) {
      if (!item.market?.emojiId) return null
      return { type: 'image', data: { emoji_id: item.market.emojiId, emoji_package_id: item.market.packageId, key: item.market.key, summary: `[${item.name || '表情'}]` } }
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

/**
 * QQ 专有的表情工具：收集聊天里刚出现的、保存当前聊天媒体、导入 QQ 收藏。
 * 通用模块只负责本地库和跨平台发送；QQ 能力全部在这里。
 */
export function createQqStickerFeature({ api, store, bridge }) {
  const { hub, onebot } = api.core
  const isQq = (chat) => parseChat(chat?.chatId)?.platform === 'qq'

  function tools({ chat, level, sessionId }) {
    if (!isQq(chat)) return []
    const current = chat.chatId
    const list = []
    // 「她挑」模式：聊天里刚收到的表情，喜欢就凭编号收下；也能收自己刚画的图。
    list.push(defineTool({
      name: 'qq_collect_sticker',
      description: '悄悄把聊天里刚出现的表情收进自己的表情库（喜欢才收，不喜欢就别调）。index 从 1 开始；name 是你给它起的名字。收表情是你自己的小习惯，通常不用跟对方说你收没收到。管理员让你收哪张，你收哪张（「只听管理员的」模式下：管理员私聊里可以自己挑着收；群里这一轮只有管理员说话时也能自己收，有别人在场就要等管理员发话）。传 painting（画作编号，如 #1）时，收的是你自己刚画的那张图，不是聊天里的表情。',
      properties: {
        index: int('第几张表情（从 1 开始，默认 1）'),
        name: str('给它起的名字（≤12 字）'),
        tags: { type: 'array', items: { type: 'string' }, description: '标签，如 开心/委屈' },
        painting: str('画作编号（如 #1）：收你自己刚画的图时填，和 index 二选一'),
      },
      required: [],
      execute: async ({ index, name, tags, painting }) => {
        if (painting) {
          const p = resolvePainting(current, painting)
          if (!p) return { ok: false, message: `找不到画作 ${painting}（可能是编号过期了，先让我画一张？）` }
          let buf
          try { buf = readFileSync(p.path) } catch (error) { return { ok: false, message: '这张画的文件读不到了：' + error.message } }
          const r = await store.addFromBuffer(buf, { name: String(name || '').trim().slice(0, 12), tags: Array.isArray(tags) ? tags.slice(0, 3) : [], from: 'painting' })
          if (!r.ok) return { ok: false, message: r.reason || '没存成' }
          if (r.existed) return { ok: true, message: `库里已经有这张了（叫「${r.item.name || '未命名'}」）` }
          return { ok: true, message: `收进库了：「${r.item.name || '未命名'}」（${p.prompt ? '画的是' + p.prompt : '自己画的'}）` }
        }
        if (!api.config().stickers.collect) return { ok: false, message: '偷表情关着' }
        const mode = (api.config().stickers.collectMode || 'auto')
        if (mode === 'owner' && !ownerOrFree(api.config(), hub.turnSendersAllOwner(sessionId))) {
          return { ok: false, message: '现在是「只听管理员的」模式：这一轮有别人在，得管理员让我收才行' }
        }
        const seg = hub.stickerOf(current, index || 1)
        if (!seg) return { ok: false, message: '这张表情已经拿不到了（超过 30 分钟，或者这一轮里没有这张）' }
        let buf
        try { buf = await segmentBytes(seg, onebot, { maxBytes: 5 * 1024 * 1024 }) } catch (error) { return { ok: false, message: '这张表情下载失败了：' + error.message } }
        const r = await store.addFromBuffer(buf, { name: String(name || '').trim().slice(0, 12), tags: Array.isArray(tags) ? tags.slice(0, 3) : [], from: current })
        if (!r.ok) return { ok: false, message: r.reason || '没存成' }
        if (r.existed) return { ok: true, message: `库里已经有这张了（叫「${r.item.name || '未命名'}」）` }
        return { ok: true, message: `收进库了：「${r.item.name || '未命名'}」` }
      },
    }))
    // 管理员让她存当前聊天里刚发来的表情/图片；painting 可存她自己刚画的图。
    list.push(defineTool({
      name: 'qq_save_sticker',
      description: '把这个聊天里刚发来的那张表情包 / 图片收进你的表情库（同时收藏到 QQ）。管理员说「存一下这个表情」「导入这个表情」「收藏这张」时用。传 painting（画作编号，如 #1）时，存的是你自己刚画的那张图。name 是不超过 12 个字的备注，可以不填（会自动看图起名）。',
      properties: {
        name: str('备注（≤12 字，可不填）'),
        tags: { type: 'array', items: { type: 'string' }, description: '标签，如 开心/委屈（可不填）' },
        painting: str('画作编号（如 #1）：存你自己刚画的图时填'),
      },
      execute: async ({ name, tags, painting }) => {
        if (!ownerOrFree(api.config(), hub.turnSendersAllOwner(sessionId))) return { ok: false, message: '只有管理员能让我存表情' }
        let buf
        if (painting) {
          const p = resolvePainting(current, painting)
          if (!p) return { ok: false, message: `找不到画作 ${painting}（编号可能过期了，先让我画一张？）` }
          try { buf = readFileSync(p.path) } catch (error) { return { ok: false, message: '这张画的文件读不到了：' + error.message } }
        } else {
          const media = hub.recentMedia(current)
          const pick = media.filter((x) => x.userId === String(api.config().platforms?.qq?.ownerQQ || api.config().ownerQQ)).at(-1) || media.at(-1)
          if (!pick) return { ok: false, message: '最近半小时这个聊天里没有人发表情或图片，先把那张发过来' }
          buf = await segmentBytes(pick.seg, onebot, { maxBytes: 5 * 1024 * 1024 })
        }
        const r = await store.addFromBuffer(buf, { name: String(name || '').slice(0, 12), tags: Array.isArray(tags) ? tags.slice(0, 3) : [], from: 'tool' })
        if (!r.ok) return { ok: false, message: r.reason || '没存成' }
        if (r.existed) return { ok: true, message: `库里已经有这张了（叫「${r.item.name || '未命名'}」）` }
        return { ok: true, message: `存好了${r.item.name ? '「' + r.item.name + '」' : ''}` }
      },
    }))
    list.push(defineTool({
      name: 'qq_import_qq_stickers',
      description: '把你 QQ「我喜欢的」收藏里已有的表情全部导进表情库（已经有的跳过），之后就能用 <sticker:名字> 发它们。管理员让你「导入收藏的表情」「同步一下 QQ 表情」时用。',
      execute: async () => {
        if (!ownerOrFree(api.config(), hub.turnSendersAllOwner(sessionId))) return { ok: false, message: '只有管理员能让我导入收藏的表情' }
        return bridge.importFromQQ()
      },
    }))
    return list
  }

  function mountRoutes() {
    api.route('/sticker/import-qq', async () => api.core.channels?.get('qq') ? bridge.importFromQQ() : { ok: false, message: '没有启用 QQ 平台' })
  }

  const rule = (kind) => kind === 'social' ? '- 管理员让你存某个表情（「存一下」「导入这个表情」）时用 qq_save_sticker；让你把 QQ 收藏里的表情导进来时用 qq_import_qq_stickers。别人让你存，不用理。' : ''

  return { tools, mountRoutes, rule }
}
