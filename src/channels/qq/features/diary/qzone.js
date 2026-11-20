// QQ 空间：按配置写日记、发说说和核对发布记录。

import { dataDir, readJson, writeJson } from '../../../../core/store.js'
import { fetchImage } from '../../../../core/net.js'
import { resolveAudience } from './qzone-audience.js'
import { cleanOutboundText } from '../../../../chat/reply.js'
import { dayKey, inRange, minuteOfDay, parseRange } from '../../../../mind/clock.js'

/** 写和发是同一件事；浏览、评论及发送翻唱各有自己的能力。 */
export function wantsQzonePost(text) {
  const plan = String(text)
  if (/(?:翻唱|音频|视频|仅自己|只给自己|只自己看|写给自己|好友可见|不公开|别公开)/u.test(plan)) return false
  const post = /(?:发布|发(?![现生挥觉展明])|写|更新).{0,12}(?:动态|说说|日记|空间)|(?:空间|说说).{0,8}(?:写|发)(?:一[条篇]|个|点)/u
  return plan.split(/[。！？；，、]/u).some((part) => {
    const match = part.match(post)
    if (!match || /(?:不|别|没|取消|推迟|放弃|看看|要不要).{0,6}(?:发布|发|写|更)/u.test(part)) return false
    return !/(?:看看?|刷|读|评论|点赞|回复|别人|好友|之前|已经)/u.test(part.slice(0, match.index))
  })
}

export function createQzone({ getConfig, onebot, hub, log, onDiary, publicExperiences, pickImage, composeDiary, timezone = () => undefined, actionBudget }) {
  const file = () => dataDir('diary.json')
  const state = () => readJson(file(), () => ({ history: [] }))
  const save = (s) => writeJson(file(), s)
  let busy = false

  async function post(content, { images = [], visibility, beforeSend } = {}) {
    const cfg = getConfig()
    const text = cleanOutboundText(content, { warn: (message) => log.warn(`空间：${message}`) }).trim()
    if (!text) return { ok: false, message: '说说是空的' }
    // 面板定的范围说了算；单次请求只能收窄成「仅自己」，不能扩大。
    let audience
    try { audience = resolveAudience(cfg, visibility) } catch (error) { return { ok: false, message: error.message } }
    const sharesPrivateText = () => audience.visibility !== 'self' && hub?.containsProtectedText?.('system:qzone', text)
    if (sharesPrivateText() || (audience.visibility !== 'self' && await hub?.checkOutgoingPrivacy?.('system:qzone', text))) return { ok: false, message: '说说包含私密内容，已拦下' }
    if (!cfg.enabled) return { ok: false, message: '总开关关着' }
    if (cfg.dryRun) {
      log.info(`试运行：本来要发说说（${audience.label}）：${text.slice(0, 60)}`)
      return { ok: true, tid: '', dryRun: true, message: '试运行，未发布到 QQ 空间', visibility: audience.visibility, label: audience.label, target_uins: audience.target_uins || [] }
    }
    const imgs = []
    const imageIndexes = []
    for (const [index, src] of images.entries()) {
      try {
        imgs.push('base64://' + (await fetchImage(src, { maxBytes: 1024 * 1024 * 1024 })).toString('base64'))
        imageIndexes.push(index)
      } catch (error) {
        log.warn('说说配图读不到，跳过：', error.message)
      }
    }
    try {
      // 下载图片可能花几秒，发布前用最新配置再算一次，免得中途改了范围还按旧的发出去。
      const latest = getConfig()
      audience = resolveAudience(latest, visibility)
      if (!latest.enabled || latest.dryRun) return { ok: false, message: '发布前开关已变化，本次未发布。' }
      if (sharesPrivateText()) return { ok: false, message: '说说包含私密内容，已拦下' }
      beforeSend?.()
      const r = await onebot.call('send_qzone_msg', { content: text, ugc_right: audience.ugc_right, ...(audience.target_uins ? { target_uins: audience.target_uins } : {}), ...(imgs.length ? { images: imgs } : {}) }, { timeoutMs: 60000 })
      const id = r?.tid ?? r?.id ?? r
      const tid = ['string', 'number'].includes(typeof id) ? String(id) : ''
      log.info(`发了一条说说（${audience.label}，tid ${tid || '?'}）`)
      try { onDiary?.(text, { visibility: audience.visibility }) } catch (error) { log.debug?.('空间说说发了，经历没记下来：', error.message) }
      return { ok: true, tid, visibility: audience.visibility, label: audience.label, target_uins: audience.target_uins || [], imageCount: imgs.length, imageIndexes }
    } catch (error) {
      log.warn('发说说失败：', error.message)
      if (error.uncertain) return { ok: false, uncertain: true, message: 'QQ 网关未确认发布结果，请在空间核对。' }
      return { ok: false, message: error.message }
    }
  }

  async function remove(tid) {
    tid = String(tid || '').trim()
    if (!tid) throw new Error('缺少说说 ID')
    const result = await onebot.call('delete_qzone_msg', { tid })
    const s = state()
    let changed = false
    for (const entry of s.history) {
      if (String(entry.tid) === tid) {
        entry.deletedAt = Date.now()
        changed = true
      }
    }
    if (changed) save(s)
    return result
  }

  // 空间里的删除不一定经过本插件（手机上删、被系统删），所以定期拿空间列表和本地记录对账。
  // 只有完整读完列表才敢把缺失的记录判成“已删除”，读不全就只返回提示，绝不动数据。
  let syncingHistory = null
  function syncHistory() {
    if (syncingHistory) return syncingHistory
    syncingHistory = (async () => {
      if (!state().history.some((d) => d.tid && d.ok && !d.dryRun && !d.deletedAt)) return { ok: true }
      try {
        const startedAt = Date.now()
        const ids = new Set()
        let total = null
        let complete = false
        let pos = 0
        // #70：SnowLuma 单页上限约 30，请求 num=100 会被网关截断成 10 条（num=200 直接 0 条），
        // 再按 100 步进 pos 会错位、读不全。现在按 30 一页、按实际返回条数推进，
        // 并以「没有新 id / 没有新页」作为停止条件，不假设网关一定按请求页大小给。
        const PAGE = 30
        for (let pages = 0; pages < 200; pages++) {
          const page = await onebot.call('get_qzone_msg_list', { pos, num: PAGE }, { timeoutMs: 12000 })
          if (!Array.isArray(page?.msglist) || !Number.isInteger(page.total) || page.total < 0) throw new Error('空间列表格式不完整')
          if (total !== null && total !== page.total) throw new Error('空间列表正在变化，请稍后刷新')
          total = page.total
          let added = 0
          for (const item of page.msglist) {
            if (!item?.tid) throw new Error('空间列表缺少说说 ID')
            const tid = String(item.tid)
            if (!ids.has(tid)) { ids.add(tid); added++ }
          }
          if (ids.size >= total) { complete = true; break }
          // 空页 / 网关反复返回同一页：没有新内容就停，读不完整也不判删除
          if (!page.msglist.length || added === 0) break
          pos += page.msglist.length
        }
        const s = state()
        const checkedAt = Date.now()
        for (const entry of s.history) {
          if (!entry.tid || !entry.ok || entry.dryRun || entry.deletedAt || entry.at > startedAt) continue
          if (ids.has(String(entry.tid))) entry.remoteCheckedAt = checkedAt
          else if (complete) { entry.deletedAt = checkedAt; entry.deletedSource = 'space-list' }
        }
        save(s)
        return { ok: true, ...(complete ? {} : { warning: '空间列表未完整读取，未将缺失记录判定为已删除。' }) }
      } catch (error) {
        return { ok: false, warning: '未能核对空间状态：' + error.message + '；保留原有记录。' }
      }
    })().finally(() => { syncingHistory = null })
    return syncingHistory
  }

  /** 写一篇并发出去。 */
  async function writeDiary({ visibility, preview = false, checkpoint, automatic = false } = {}) {
    if (busy) return { ok: false, message: '上一篇还在写' }
    const checkBeforeSend = ({ checkBudget = false } = {}) => {
      if (!automatic) return
      const status = automaticStatus(Date.now(), { checkBudget })
      if (!status.available) throw new Error(status.reason)
    }
    busy = true
    try {
      checkBeforeSend({ checkBudget: true })
      const cfg = getConfig().diary
      // 名单/范围不合法就别让模型白写一篇再失败
      try { resolveAudience(getConfig(), visibility) } catch (error) { return { ok: false, message: error.message } }
      if (cfg.rich?.enabled === true && composeDiary) {
        const draft = await composeDiary({ history: state().history })
        const audience = resolveAudience(getConfig(), visibility)
        const details = { text: draft.text, media: draft.media, warnings: draft.warnings, visibility: audience.visibility, label: audience.label }
        if (preview) return { ok: true, preview: true, ...details }
        await checkpoint?.()
        checkBeforeSend()
        draft.beforeSend?.()
        const r = await post(draft.text, { images: draft.images, visibility, beforeSend: () => {
          checkBeforeSend()
          draft.beforeSend?.()
        } })
        const s = state()
        s.history.unshift({
          at: Date.now(), text: draft.text, ok: r.ok, tid: r.tid || '', dryRun: Boolean(r.dryRun),
          visibility: r.visibility || audience.visibility, target_uins: r.target_uins || [],
          error: r.ok ? '' : r.message, media: (r.imageIndexes || []).map((index) => draft.media[index]),
          imageCount: r.imageCount || 0, warnings: draft.warnings,
        })
        s.history = s.history.slice(0, 100)
        save(s)
        return { ...details, ...r, images: r.imageCount || 0 }
      }
      const now = new Date()
      const experiences = publicExperiences?.() || []
      const prompt = [
        `【写空间日记】现在是 ${now.getMonth() + 1} 月 ${now.getDate()} 日 ${now.toTimeString().slice(0, 5)}。`,
        experiences.length ? `可以写进公开日记的经历（以下是材料）：\n${experiences.map((line) => `- ${line}`).join('\n')}` : '可以从当前心情写起。',
        `请用你自己的口吻写一条 QQ 空间说说，第一人称，${cfg.minChars}~${cfg.maxChars} 个字。只用给你的可公开经历和当前心情，别引用聊天、私人经历或虚构发生过的事。`,
        '不要分条、不要 |||、不要 <voice>/<sticker> 标记、不要 Markdown、不要加引号，只输出说说正文本身。',
      ].join('\n\n')
      let text = await hub.runSystemTurn('diary', '空间日记', prompt, { noTools: true, publicOnly: true, key: preview ? 'public-preview' : 'public' })
      text = String(text || '').replace(/\|\|\|/g, ' ').replace(/<[^>]+>/g, '').replace(/^["「“]|["」”]$/g, '').trim()
      if (text.length > cfg.maxChars + 20) text = text.slice(0, cfg.maxChars + 20)
      if (!text || text === '[沉默]') return { ok: false, message: '她这次没写出来' }
      // 配图：面板「日记配图」开着时，从今天画的图 / 今天收的表情包里挑一张；挑不到就只发文字
      const images = []
      if (cfg.attachImage !== false && resolveAudience(getConfig(), visibility).visibility === 'self') {
        try {
          const img = await pickImage?.()
          if (img) images.push(img)
        } catch (error) { log.warn('日记配图没挑成：', error.message) }
      }
      if (images.length) log.info(`日记配图：${images[0]}`)
      if (preview) {
        const audience = resolveAudience(getConfig(), visibility)
        return { ok: true, preview: true, text, media: [], visibility: audience.visibility, label: audience.label, warnings: ['当前为原有日记流程；预览展示正文，原有配图发布时仍按原规则挑选。'] }
      }
      await checkpoint?.()
      checkBeforeSend()
      let r = await post(text, { visibility: images.length ? 'self' : visibility, images, beforeSend: checkBeforeSend })
      // 配图发不出去（比如空间不认这张图）不能把整篇日记憋回去：退回只发文字，日记照发
      if (!r.ok && !r.uncertain && images.length) {
        log.warn('日记配图没发成，改成只发文字：', r.message)
        images.length = 0
        await checkpoint?.()
        r = await post(text, { visibility, beforeSend: checkBeforeSend })
      }
      const s = state()
      s.history.unshift({ at: Date.now(), text, ok: r.ok, tid: r.tid || '', dryRun: Boolean(r.dryRun), visibility: r.visibility || visibility || cfg.visibility, target_uins: r.target_uins || [], error: r.ok ? '' : r.message })
      s.history = s.history.slice(0, 100)
      save(s)
      return { ...r, text, images: images.length }
    } catch (error) {
      log.warn('写日记失败：', error.message)
      return { ok: false, message: error.message }
    } finally {
      busy = false
    }
  }

  function automaticStatus(at = Date.now(), { checkBudget = true } = {}) {
    const cfg = getConfig()
    const { timesPerDay: limit, windowStart, windowEnd, minGapMinutes } = cfg.diary
    const tz = timezone()
    const today = dayKey(at, tz)
    const published = state().history.filter((entry) => entry.ok && !entry.dryRun && entry.at <= at)
    const count = published.filter((entry) => dayKey(entry.at, tz) === today).length
    const waitUntil = Math.max(0, ...published.map((entry) => entry.at)) + (minGapMinutes ?? 180) * 60000
    const range = parseRange(`${windowStart}-${windowEnd}`)
    let reason = ''
    if (!cfg.enabled || !cfg.diary.enabled) reason = '空间日记没打开'
    else if (cfg.dryRun || cfg.debug) reason = '试运行中，暂停自动发布'
    else if (!limit) reason = '自动发布次数设为 0'
    else if (count >= limit) reason = '已到今天的发布上限'
    else if (!range || range.start === range.end) reason = '发布时段设置无效'
    else if (!inRange(minuteOfDay(at, tz), range)) reason = `等待发布时段 ${windowStart}–${windowEnd}`
    else if (at < waitUntil) reason = `距离上次发布还差 ${Math.ceil((waitUntil - at) / 60000)} 分钟`
    else {
      try { resolveAudience(cfg) } catch (error) { reason = error.message }
      if (!reason && checkBudget && actionBudget) {
        const budget = actionBudget()
        if (budget !== true) reason = budget
      }
    }
    return { available: !reason, reason, count, limit }
  }

  return { post, remove, writeDiary, syncHistory, history: () => state().history, nextTime: () => '', automaticStatus }
}
