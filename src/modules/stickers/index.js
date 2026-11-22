// 内置模块：表情包。偷表情、回复时按情绪配一张、她自己整理表情库。
// 导出的就是表情库（createStickerStore 的返回值），聊天中枢发表情、偷表情都找它。

import { readFileSync, existsSync } from 'node:fs'
import { createStickerStore, stickerPath } from '../../features/stickers.js'
import { defineTool, str } from '../../tools/tools.js'
import { fetchImage, segmentBytes } from '../../core/net.js'
import { ownerOrFree } from '../../chat/access.js'
import { parseChat } from '../../channels/ids.js'
import { createQqStickerBridge, createQqStickerHooks, createQqStickerFeature } from '../../channels/qq/features/stickers-qq.js'

export default {
  id: 'stickers',
  name: '表情包',
  version: '1.0.0',
  description: '偷表情、回复时按情绪配表情、她自己改名删图；关掉后不发也不收表情',
  tab: 'stickers',
  files: ['features/stickers.js', 'channels/qq/features/stickers-qq.js'],
  setup(api) {
    const { hub, onebot, http } = api.core
    const qqStickerHooks = createQqStickerHooks({ onebot, log: api.log })
    const store = createStickerStore({ dsh: api.dsh, getConfig: api.config, log: api.log, qq: qqStickerHooks, downloadSegment: (seg) => segmentBytes(seg, onebot, { maxBytes: 5 * 1024 * 1024, allowLocal: false }), shouldSyncQQ: (chatId) => parseChat(chatId)?.platform === 'qq', readMarket: qqStickerHooks.readMarket, nativeSegment: qqStickerHooks.nativeSegment })
    const qqStickers = createQqStickerBridge({ onebot, store, getConfig: api.config, log: api.log })
    const qqFeature = createQqStickerFeature({ api, store, bridge: qqStickers })
    const isQqChat = (chat) => parseChat(chat.chatId)?.platform === 'qq'

    api.tool(({ chat, level, sessionId }) => {
      if (chat.kind === 'system') return []
      const current = chat.chatId
      const tools = [
        // 表情包关着就不挂「发表情」（整理表情库的工具照样留着）
        ...(api.config().stickers.enabled ? [defineTool({
          name: 'qq_send_sticker',
          description: '在当前 QQ 聊天里发一张表情包。name 写表情的名字或情绪（如「委屈」「开心」「早晚安」），会在表情库里模糊匹配。一般直接在回复里写 <sticker:名字> 就行，这个工具用于回复之外单独补发。',
          properties: { name: str('表情名字或情绪关键词') },
          required: ['name'],
          execute: async ({ name }) => {
            const status = await hub.sendSticker(current, String(name || ''), undefined, undefined, { detailed: true })
            const messages = {
              delivered: '发了',
              simulated: '模拟发送完成',
              queued: '已排队，正在等待发送',
              disabled: '表情包已关闭',
              missing: '表情库里没找到合适的',
              unconfirmed: '表情没有确认送达',
            }
            return { ok: ['delivered', 'simulated', 'queued'].includes(status), message: messages[status] }
          },
        })] : []),
        defineTool({
          name: 'qq_list_stickers',
          description: '看看表情库里有哪些表情（名字和标签），挑表情前可以先看。非管理员只能看到数量，名字和标签只给管理员看。',
          properties: { query: str('可选，按名字/标签筛选') },
          execute: async ({ query }) => {
            const items = store.library().items
            if (!ownerOrFree(api.config(), hub.turnSendersAllOwner(sessionId))) return { ok: true, count: items.length, message: `表情库里有 ${items.length} 张表情；名字和标签只给管理员看` }
            const q = String(query || '').trim()
            const hit = (q ? items.filter((i) => (i.name || '').includes(q) || (i.tags || []).some((t) => t.includes(q))) : items).slice(-60)
            return { ok: true, count: items.length, message: hit.length ? hit.map((i) => `${i.name || '未命名'}${i.tags?.length ? '（' + i.tags.join('/') + '）' : ''}`).join('、') : '没有符合的表情', items: hit.map((i) => ({ name: i.name, tags: i.tags })) }
          },
        }),
        defineTool({
          name: 'qq_edit_sticker',
          description: '整理表情库：给一张表情改名字、改标签，或者删掉。名字不贴切、别人建议改名、标签不对的时候用；不喜欢、重复、发不出去的表情可以删。sticker 写现在的名字或标签（模糊匹配）。',
          properties: {
            sticker: str('要改的那张表情现在的名字或标签'),
            new_name: str('新名字（12 字以内，不改就不填）'),
            tags: { type: 'array', items: { type: 'string' }, description: '新标签（情绪 / 用途，比如 开心、委屈、嘲讽；不改就不填）' },
            delete: { type: 'boolean', description: 'true = 删掉这张表情' },
          },
          required: ['sticker'],
          execute: async ({ sticker, new_name, tags, delete: del }) => {
            const item = store.match(String(sticker || ''))
            if (!item) return { ok: false, message: '表情库里没找到这张' }
            const label = item.name || item.md5.slice(0, 8)
            if (del) {
              // 删表情一律要管理员单独发话：同轮混进别人就不能借管理员的在场删库
              if (!ownerOrFree(api.config(), hub.turnSendersAllOwner(sessionId))) return { ok: false, message: '删表情要管理员发话' }
              const r = await store.remove(item.md5)
              return r.ok ? { ok: true, message: `删掉了「${label}」` } : { ok: false, message: r.reason || '没删成' }
            }
            if (!new_name && !(Array.isArray(tags) && tags.length)) return { ok: false, message: '要说改成什么' }
            const r = store.rename(item.md5, new_name ? String(new_name).trim().slice(0, 12) : undefined, Array.isArray(tags) && tags.length ? tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 5) : undefined)
            return r.ok ? { ok: true, message: `改好了：「${label}」→「${r.item.name}」${r.item.tags?.length ? '（' + r.item.tags.join('/') + '）' : ''}` } : { ok: false, message: '没改成' }
          },
        }),
      ]
      if (isQqChat(chat)) tools.push(...qqFeature.tools({ chat, level, sessionId }))
      // 管理员私聊（完整权限）才能往库里加图
      if (level === 'full') tools.push(defineTool({
        name: 'qq_add_sticker',
        description: '把一张图片收进表情库并收藏到 QQ。source 是本地图片路径或图片网址；name 是不超过 12 个字的备注。',
        properties: { source: str('本地路径或 http(s) 地址'), name: str('备注（≤12 字）'), tags: { type: 'array', items: { type: 'string' }, description: '标签，如 开心/委屈' } },
        required: ['source'],
        execute: async ({ source, name, tags }) => {
          const buf = await fetchImage(String(source), { maxBytes: 5 * 1024 * 1024 })
          const r = await store.addFromBuffer(buf, { name: name || '', tags: Array.isArray(tags) ? tags.slice(0, 3) : [], from: 'tool', toQQ: isQqChat(chat) })
          return r.ok ? { ok: true, message: r.existed ? '库里已经有这张了' : `收好了「${r.item.name || '未命名'}」` } : { ok: false, message: r.reason }
        },
      }))
      return tools
    })

    api.route('/stickers', async () => ({ ok: true, items: store.library().items.slice().reverse() }))
    api.route('/sticker/image', async (req, res) => {
      const it = store.library().items.find((i) => i.md5 === http.query(req).md5)
      if (!it || !existsSync(stickerPath(it))) return http.send(res, 404, '')
      const ext = it.file.split('.').pop()
      http.send(res, 200, readFileSync(stickerPath(it)), ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg')
    })
    api.route('/sticker/rename', async (req) => {
      const b = await http.body(req)
      return store.rename(b.md5, b.name, Array.isArray(b.tags) ? b.tags : undefined)
    }, { access: 'panel' })
    api.route('/sticker/delete', async (req) => {
      const b = await http.body(req)
      return store.remove(b.md5, { fromQQ: b.fromQQ !== false })
    }, { access: 'panel' })
    // 多选批量删除：面板上一次删几十张，不用一张张点、一张张确认
    api.route('/sticker/delete-batch', async (req) => {
      const b = await http.body(req)
      const list = Array.isArray(b.md5s) ? b.md5s : b.md5 ? [b.md5] : []
      return store.removeMany(list, { fromQQ: b.fromQQ !== false })
    }, { access: 'panel' })
    // 批量补名字 / 标签：POST 立刻返回，后台一张张看图起名，进度用下面的 status 查
    api.route('/sticker/caption-all', async (req) => {
      const b = await http.body(req)
      return store.captionLibrary({ all: b.all === true, limit: Number(b.limit) || 0 })
    }, { access: 'panel' })
    api.route('/sticker/caption-status', async () => ({ ok: true, ...store.captionStatus() }))
    api.route('/sticker/caption-stop', async () => ({ ok: true, ...store.captionCancel() }), { access: 'panel' })
    qqFeature.mountRoutes()
    api.rule(qqFeature.rule)
    api.route('/sticker/primary', async (req) => {
      const b = await http.body(req)
      return store.setPrimary(String(b.md5 || ''))
    }, { access: 'panel' })
    api.route('/sticker/upload', async (req) => {
      const b = await http.body(req)
      const buf = Buffer.from(String(b.data || '').replace(/^data:[^,]+,/, ''), 'base64')
      if (!buf.length || buf.length > 5 * 1024 * 1024) return { ok: false, message: '图片太大或是空的' }
      return store.addFromBuffer(buf, { name: b.name || '', tags: b.tags || [], from: 'panel', toQQ: Boolean(api.core.channels?.get('qq')) })
    }, { access: 'panel' })

    // 导出的就是 store：模块停下 / 重载时宿主会调 store.dispose()，
    // 后台批量起名跟着停（不然旧实例会接着调模型、写库，和新实例互相覆盖）。
    return store
  },
}
