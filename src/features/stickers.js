// 表情库的采集与收藏：偷表情（严格判定 + 尺寸兜底 + MD5 去重 + 每小时限额）→ 收藏到 QQ → 视觉模型起备注。
// 纯逻辑（标签、匹配、挑一张、淘汰谁、库文件读写）在 features/sticker-library.js。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { imageSize, mimeOf, stickerSizeOk } from '../core/image-info.js'
import { askModel, canSeeImages } from '../core/llm.js'
import { dHash, dHashDistance, toWebP } from './sticker-hash.js'
import { DEFAULT_TAGS, loadLibrary, matchSticker, pickEvict, pickForReply, saveLibrary, stickerDir, stickerPath } from './sticker-library.js'
import { createStickerCaption } from './sticker-caption.js'

const dir = () => stickerDir()
const ext = (mime) => ({ 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' })[mime] || 'jpg'

export function createStickerStore({ dsh, getConfig, log, qq = null, downloadSegment = null, shouldSyncQQ = () => true, readMarket = null, nativeSegment = null }) {
  const recent = [] // 每小时限额
  // QQ 专有动作由 channels/qq/features/stickers-qq.js 注入；没有注入时保留旧 onebot 兼容。
  // 异步收藏/导入会跨 await 读改写同一个 index.json，串行化避免丢更新。
  let libraryQueue = Promise.resolve()
  const withLibraryLock = (fn) => {
    const run = libraryQueue.then(fn, fn)
    libraryQueue = run.catch(() => {})
    return run
  }
  const addCustomFace = (buf) => qq?.addCustomFace ? qq.addCustomFace(buf) : Promise.reject(new Error('没有注入 QQ 表情写入'))
  const modifyCustomFace = (emojiId, desc) => qq?.modifyCustomFace ? qq.modifyCustomFace(emojiId, desc) : Promise.reject(new Error('没有注入 QQ 表情修改'))
  const deleteCustomFace = (emojiId) => qq?.deleteCustomFace ? qq.deleteCustomFace(emojiId) : Promise.reject(new Error('没有注入 QQ 表情删除'))

  /** 面板里给起名单独挑的模型；没挑（或者只填了一半）就返回 null = 跟随聊天用的模型。 */
  /** 收一张表情。seg 必须已经过 isStickerSegment 严格判定。 */
  /** 近似重复：已有条目没有 dhash 时顺手补算，命中就复用旧条目。 */
  async function nearDuplicate(lib, hash) {
    if (!hash) return null
    for (const item of lib.items) {
      if (item.dhash === undefined) {
        try { item.dhash = await dHash(readFileSync(join(dir(), item.file))) } catch { item.dhash = '' }
      }
      if (item.dhash && dHashDistance(item.dhash, hash) <= 5) return item
    }
    saveLibrary(lib)
    return null
  }

  function collect(seg, from) { return withLibraryLock(() => collectInner(seg, from)) }
  async function collectInner(seg, from) {
    const cfg = getConfig().stickers
    if (getConfig().debug) return { ok: false, reason: '调试模式，不收表情' } // 调试不往表情库里添东西
    if (!cfg.enabled || !cfg.collect) return { ok: false, reason: '偷表情关着' }
    const now = Date.now()
    while (recent.length && now - recent[0] > 3600_000) recent.shift()
    if (recent.length >= cfg.maxPerHour) return { ok: false, reason: '这小时收够了' }
    const d = seg.data || {}
    let buf
    try {
      if (typeof downloadSegment !== 'function') return { ok: false, reason: '没有注入媒体下载' }
      buf = await downloadSegment(seg)
    } catch (error) {
      return { ok: false, reason: '下载失败：' + error.message }
    }
    const { width, height } = imageSize(buf)
    if (!stickerSizeOk({ width, height, bytes: buf.length })) return { ok: false, reason: `尺寸不像表情（${width}x${height}，${Math.round(buf.length / 1024)}KB）` }
    const md5 = createHash('md5').update(buf).digest('hex')
    const lib = loadLibrary()
    if (lib.items.some((i) => i.md5 === md5)) return { ok: false, reason: '已经有了' }
    const similar = await nearDuplicate(lib, await dHash(buf))
    if (similar) return { ok: false, reason: '和库里这张很像', item: similar }
    let mime = mimeOf(buf)
    const webp = cfg.webp && mime !== 'image/gif' ? await toWebP(buf) : null
    if (webp) { buf = webp; mime = 'image/webp' }
    mkdirSync(dir(), { recursive: true })
    const file = `collected-${md5}.${ext(mime)}`
    writeFileSync(join(dir(), file), buf)
    const item = { md5, dhash: await dHash(buf), file, name: '', tags: [], from, at: now, width, height, bytes: buf.length, emojiId: '', summary: String(d.summary || '').replace(/[[\]]/g, '') }
    // 平台原生表情元数据由平台 hook 解析（例如 QQ 的 mface）；通用库不认具体平台字段。
    const market = typeof readMarket === 'function' ? readMarket(seg) : null
    if (market) item.market = market
    recent.push(now)
    // 收藏到 QQ
    if (shouldSyncQQ(from) && !getConfig().dryRun) {
      try {
        const r = await addCustomFace(buf)
        item.emojiId = String(r?.emoji_id || '')
      } catch (error) {
        log.warn('收藏到 QQ 失败（本地已留档）：', error.message)
      }
    }
    lib.items.push(item)
    saveLibrary(lib)
    log.info(`收了一张表情 ${md5.slice(0, 8)}（${width}x${height}）`)
    await trim()
    // 后台起备注，写回 QQ 和本地
    if (getConfig().stickers.caption) {
      caption(buf, mime, item.summary).then(async ({ name, tags }) => {
        const l = loadLibrary()
        const it = l.items.find((i) => i.md5 === md5)
        if (!it) return
        it.name = name || item.summary || '表情'
        it.tags = tags.length ? tags : it.tags
        saveLibrary(l)
        if (it.emojiId && it.name) {
          try { await modifyCustomFace(it.emojiId, it.name.slice(0, 20)) } catch (error) { log.warn('写回 QQ 备注失败：', error.message) }
        }
        log.info(`表情 ${md5.slice(0, 8)} 起名「${it.name}」${it.tags.length ? ' #' + it.tags.join(' #') : ''}`)
      }).catch((error) => log.warn('表情起名收尾出错：', error.message))
    }
    return { ok: true, item }
  }

  /** 手动添加（工具 / 面板上传）。 */
  function addFromBuffer(buf, opts = {}) { return withLibraryLock(() => addFromBufferInner(buf, opts)) }
  async function addFromBufferInner(buf, { name = '', tags = [], from = 'manual', toQQ = true } = {}) {
    const md5 = createHash('md5').update(buf).digest('hex')
    const lib = loadLibrary()
    const exist = lib.items.find((i) => i.md5 === md5)
    if (exist) return { ok: true, item: exist, existed: true }
    const similar = await nearDuplicate(lib, await dHash(buf))
    const requestedName = String(name || '').trim().slice(0, 12)
    // 同名表情允许作为变体共存；没有名字的近似图仍然按重复处理。
    const variantOf = similar && requestedName && requestedName === similar.name ? similar.md5 : ''
    if (similar && !variantOf) return { ok: true, item: similar, existed: true, similar: true }
    let mime = mimeOf(buf)
    if (!mime.startsWith('image/')) return { ok: false, reason: '不是图片' }
    const webp = getConfig().stickers.webp && mime !== 'image/gif' ? await toWebP(buf) : null
    if (webp) { buf = webp; mime = 'image/webp' }
    mkdirSync(dir(), { recursive: true })
    const file = `manual-${md5}.${ext(mime)}`
    writeFileSync(join(dir(), file), buf)
    const { width, height } = imageSize(buf)
    const item = { md5, dhash: await dHash(buf), file, name: requestedName, tags, from, at: Date.now(), width, height, bytes: buf.length, emojiId: '' }
    if (variantOf) item.variantOf = variantOf
    if (toQQ && !getConfig().dryRun) {
      try {
        const r = await addCustomFace(buf)
        item.emojiId = String(r?.emoji_id || '')
        if (item.emojiId && item.name) await modifyCustomFace(item.emojiId, item.name)
      } catch (error) {
        log.warn('收藏到 QQ 失败（本地已留档）：', error.message)
      }
    }
    lib.items.push(item)
    saveLibrary(lib)
    return { ok: true, item }
  }

  /** 表情库超过上限就清掉最少用的（QQ 收藏表情有数量上限，满了就收不进去了）。 */
  async function trim() {
    const max = getConfig().stickers.maxLibrary
    for (let guard = 0; guard < 20; guard++) {
      const items = loadLibrary().items
      if (items.length <= max) return
      const out = pickEvict(items)
      if (!out) return
      log.info(`表情库满了（上限 ${max}），清掉一张不常用的：${out.name || out.md5.slice(0, 8)}`)
      await remove(out.md5)
    }
  }

  /** 发出去一次：记下来，常用的不会被清掉。 */
  function markUsed(md5) {
    const lib = loadLibrary()
    const it = lib.items.find((i) => i.md5 === md5)
    if (!it) return
    it.uses = (it.uses || 0) + 1
    it.lastUsed = Date.now()
    saveLibrary(lib)
  }

  async function remove(md5, { fromQQ = true } = {}) {
    const lib = loadLibrary()
    const it = lib.items.find((i) => i.md5 === md5)
    if (!it) return { ok: false, reason: '没有这张' }
    if (fromQQ && it.emojiId && !getConfig().dryRun) {
      try { await deleteCustomFace(it.emojiId) } catch (error) { log.warn('从 QQ 收藏里删除失败：', error.message) }
    }
    try { unlinkSync(join(dir(), it.file)) } catch {}
    lib.items = lib.items.filter((i) => i.md5 !== md5)
    saveLibrary(lib)
    return { ok: true }
  }

  /** 一次删一批：面板多选后一键删掉。fromQQ = 连 QQ 收藏里的那张一起删。 */
  async function removeMany(md5s, { fromQQ = true } = {}) {
    const list = [...new Set((Array.isArray(md5s) ? md5s : []).map((x) => String(x || '').trim()).filter(Boolean))]
    if (!list.length) return { ok: false, removed: 0, message: '没选表情' }
    const found = loadLibrary().items.filter((i) => list.includes(i.md5))
    if (!found.length) return { ok: false, removed: 0, message: '这些表情已经不在库里了' }
    let qqFailed = 0
    if (fromQQ && !getConfig().dryRun) {
      for (const it of found) {
        if (!it.emojiId) continue
        try { await deleteCustomFace(it.emojiId) } catch (error) { qqFailed++; log.warn('从 QQ 收藏里删除失败：', error.message) }
      }
    }
    for (const it of found) { try { unlinkSync(join(dir(), it.file)) } catch {} }
    const gone = new Set(found.map((i) => i.md5))
    // 重新读一遍再写：后台可能刚给别的表情起完名，别把那些改动冲掉
    const fresh = loadLibrary()
    fresh.items = fresh.items.filter((i) => !gone.has(i.md5))
    saveLibrary(fresh)
    log.info(`批量删掉 ${found.length} 张表情${fromQQ ? '' : '（QQ 收藏保留）'}`)
    return { ok: true, removed: found.length, qqFailed, message: `删掉了 ${found.length} 张${qqFailed ? `（${qqFailed} 张没从 QQ 收藏删掉）` : ''}` }
  }

  function rename(md5, name, tags) {
    const lib = loadLibrary()
    const it = lib.items.find((i) => i.md5 === md5)
    if (!it) return { ok: false }
    if (name !== undefined) it.name = String(name).trim().slice(0, 12)
    if (tags !== undefined) it.tags = [...new Set((Array.isArray(tags) ? tags : []).map((t) => String(t).replace(/^#/, '').trim().slice(0, 8)).filter(Boolean))].slice(0, 5)
    saveLibrary(lib)
    if (it.emojiId && !getConfig().dryRun) modifyCustomFace(it.emojiId, it.name).catch(() => {})
    return { ok: true, item: it }
  }

  /** 发表情用的消息段：商城表情按商城表情原样发（带 emoji_id，网关会认回成 mface）；其余本地图片按表情（sub_type=1）发。 */
  function setPrimary(md5) {
    const lib = loadLibrary()
    const it = lib.items.find((x) => x.md5 === String(md5 || ''))
    if (!it) return { ok: false, message: '找不到这张表情' }
    lib.items = lib.items.map((x) => x.name && x.name === it.name ? { ...x, primary: x.md5 === it.md5 } : x)
    saveLibrary(lib)
    return { ok: true, md5: it.md5, name: it.name }
  }

  function segmentFor(item) {
    if (item.market?.emojiId && typeof nativeSegment === 'function') return nativeSegment(item)
    const p = stickerPath(item)
    if (!existsSync(p)) return null
    return { type: 'image', data: { file: 'base64://' + readFileSync(p).toString('base64'), sub_type: 1, summary: `[${item.name || '表情'}]` } }
  }

  // ---------- 批量补名字 / 标签 ----------
  // 整理整个表情库：一张张交给模型看图起名（复用 caption，和偷表情同一套提示词），后台跑、面板轮询进度。
  // 任务状态留在闭包里，关掉面板也照跑；模块卸载 / 重载时 dispose 负责叫停 —— 不然旧实例会接着调模型、写库，
  // 和新实例互相覆盖。
  let captionJob = null
  let disposed = false

  const captionCtl = createStickerCaption({
    dsh, getConfig, log, canSeeImages, askModel, loadLibrary, saveLibrary, stickerDir, modifyCustomFace, DEFAULT_TAGS,
  })
  const captionLibrary = captionCtl.run
  const captionStatus = captionCtl.status
  const captionCancel = captionCtl.cancel
  const captionTargets = captionCtl.targets
  function dispose() { captionCtl.shutdown() }
  // 采集时用的「看图起名」也走同一个控制器（保持原有的 caption 行为）
  const caption = captionCtl.caption

  return { collect, addFromBuffer, remove, removeMany, rename, segmentFor, setPrimary, markUsed, trim, captionLibrary, captionStatus, captionCancel, captionTargets, dispose, library: loadLibrary, match: (q) => matchSticker(loadLibrary().items, q), pickForReply: (t) => pickForReply(loadLibrary().items, t) }
}
