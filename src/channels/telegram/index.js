// Telegram 平台适配器：长轮询 Bot API，不要求公网端口。
// 只实现最小能力：文本、回复、图片；平台特有的按钮/文件等以后按 caps 增加。
import { chatIdOf, parseChat } from '../ids.js'

export const PLATFORM = 'telegram'
// 能力位只能用 channels/index.js 的 CAPS 规范键：text / reply / images 不是能力位
// （文本、引用、图片是所有平台的核心消息段，本来就该支持），写在这里等于对调用方撒谎。
// 现在 Telegram 侧只实现了文本 + 引用 + 图片，其余能力位一律 false —— 声明为 true 就必须真有对应方法。
export const TELEGRAM_CAPS = Object.freeze({
  faces: false, stickers: false, voice: false, files: false, recall: false, poke: false,
  react: false, typing: false, history: false, forward: false, card: false,
  friendRequests: false, groupRequests: false, profile: false, groupAdmin: false,
})

/**
 * 传输层错误。`uncertain` 表示「这次请求可能已经到达 Telegram，消息可能已经发出去了」——
 * 调用方据此决定能不能重发（reminders 的「不确定不重发」、群聊去重都依赖这个语义）。
 * QQ 那边由 OneBotError 带同名字段；Telegram 这里补齐，否则超时会被当成「肯定没发出去」而重发，造成重复消息。
 */
export class TelegramTransportError extends Error {
  constructor(message, { uncertain = false, cause } = {}) {
    super(message)
    this.name = 'TelegramTransportError'
    this.uncertain = uncertain
    if (cause !== undefined) this.cause = cause
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function createTelegramChannel({ getConfig, log = {}, fetchImpl = globalThis.fetch } = {}) {
  const listeners = new Set()
  let state = 'stopped'
  let me = null
  let offset = 0
  let offsetIdentity = ''
  let startedAt = 0
  let running = false
  let controller = null
  let polling = null
  let generation = 0
  let lastError = ''
  let manualStop = false
  const cfg = () => getConfig()?.platforms?.telegram || {}
  const token = () => String(cfg().token || '').trim()
  const base = () => `${String(cfg().apiBase || 'https://api.telegram.org').replace(/\/+$/, '')}/bot${token()}`
  const ready = () => state === 'connected' && Boolean(me)
  const emit = (e) => { for (const fn of [...listeners]) { try { fn(e) } catch (error) { log.warn?.('Telegram 事件处理失败：', error.message) } } }
  const setState = (next) => { if (state === next) return; state = next; emit({ type: 'state', state: next }) }

  // Bot API 明确回了 ok:false：服务端处理过这次请求。4xx 说明没接受（肯定没发出去）；
  // 5xx 说明它自己出错了，请求可能已经生效 —— 标 uncertain，别让上层重发。
  function httpFailure(method, res, data) {
    const status = Number(res?.status || 0)
    const detail = data?.description || `HTTP ${status}（返回不是 Bot API JSON）`
    return new TelegramTransportError(`Telegram ${method} 失败：${detail}`, { uncertain: status >= 500 })
  }

  // fetch 抛错 / 我们自己超时 / 被中止：请求可能已经到达 Telegram，一律标 uncertain。
  // 已经是 TelegramTransportError 的原样抛出（不要覆盖 httpFailure 的判定）。
  function asTransportError(method, error, ctl) {
    if (error instanceof TelegramTransportError) return error
    const aborted = Boolean(ctl?.signal?.aborted)
    return new TelegramTransportError(`Telegram ${method} 请求未确认：${String(error?.message || error)}`, { uncertain: true, cause: aborted ? 'aborted' : undefined })
  }

  async function call(method, params = {}, { signal, timeoutMs = 30000 } = {}) {
    if (!token()) throw new Error('Telegram Bot Token 未配置')
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(new Error('Telegram 请求超时')), timeoutMs)
    const abort = () => ctl.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const res = await fetchImpl(`${base()}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params), signal: ctl.signal,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data || data.ok !== true) throw httpFailure(method, res, data)
      if (data.result === undefined || data.result === null) throw new TelegramTransportError(`Telegram ${method} 失败：返回缺少 result`, { uncertain: true })
      return data.result
    } catch (error) {
      throw asTransportError(method, error, ctl)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', abort)
    }
  }

  async function callForm(method, form, { signal, timeoutMs = 30000 } = {}) {
    if (!token()) throw new Error('Telegram Bot Token 未配置')
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(new Error('Telegram 请求超时')), timeoutMs)
    const abort = () => ctl.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const res = await fetchImpl(`${base()}/${method}`, { method: 'POST', body: form, signal: ctl.signal })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data || data.ok !== true) throw httpFailure(method, res, data)
      if (data.result === undefined || data.result === null) throw new TelegramTransportError(`Telegram ${method} 失败：返回缺少 result`, { uncertain: true })
      return data.result
    } catch (error) {
      throw asTransportError(method, error, ctl)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', abort)
    }
  }

  async function normalize(msg, signal) {
    if (!msg?.chat) return null
    const kind = msg.chat.type === 'private' ? 'private' : 'group'
    const chatId = chatIdOf(PLATFORM, kind, String(msg.chat.id))
    const text = String(msg.text || msg.caption || '')
    const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo.at(-1) : null
    let images = []
    if (photo?.file_id) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const info = await call('getFile', { file_id: photo.file_id }, { signal, timeoutMs: 15000 })
          const path = String(info?.file_path || '')
          if (!path) throw new Error('getFile 没有返回 file_path')
          const fileUrl = `${String(cfg().apiBase || 'https://api.telegram.org').replace(/\/+$/, '')}/file/bot${token()}/${path}`
          signal?.throwIfAborted?.()
          const r = await fetchImpl(fileUrl, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) })
          if (!r.ok) throw new Error(`图片下载 HTTP ${r.status}`)
          const buf = Buffer.from(await r.arrayBuffer())
          if (!buf.length || buf.length > 20 * 1024 * 1024) throw new Error('图片为空或过大')
          images = [{ type: 'image', data: { file: 'base64://' + buf.toString('base64') }, mediaType: String(r.headers?.get?.('content-type') || 'image/jpeg') }]
          break
        } catch (error) {
          if (signal?.aborted || attempt === 3) { log.warn?.('Telegram 图片下载失败：', error.message); break }
          await sleep(250 * attempt)
        }
      }
    }
    if (!text && !images.length && photo?.file_id) throw Object.assign(new Error('图片最终下载失败'), { mediaTransient: true })
    const entities = [...(msg.entities || []), ...(msg.caption_entities || [])].filter((e) => e?.type === 'mention' && Number.isInteger(e.offset) && Number.isInteger(e.length))
    const handles = entities.map((e) => text.slice(e.offset, e.offset + e.length).replace(/^@/, '').toLowerCase()).filter(Boolean)
    const botName = String(me?.username || '').toLowerCase()
    // 文本里的 @ 只有明确 @ 机器人时才算叫她；@ 别人不能被群聊策略当成叫她。
    const textMention = botName ? new RegExp('(^|\\s)@' + botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$|[，。！？,.!?])', 'iu').test(text) : false
    const replyToBot = Boolean(msg.reply_to_message?.from?.is_bot && String(msg.reply_to_message.from.id) === String(me?.id))
    const mentioned = textMention || handles.includes(botName) || replyToBot
    const atOthers = handles.some((h) => h !== botName) || Boolean(msg.reply_to_message?.from && !replyToBot)
    return {
      platform: PLATFORM, kind, chatId, userId: String(msg.from?.id || msg.chat.id),
      groupId: kind === 'group' ? String(msg.chat.id) : '', nickname: msg.from?.first_name || msg.from?.username || '',
      text, mentioned, atOthers, messageId: String(msg.message_id), selfId: String(me?.id || ''), replyId: msg.reply_to_message?.message_id ? String(msg.reply_to_message.message_id) : '',
      images, stickers: [], records: [], files: [], segments: [{ type: 'text', data: { text } }, ...images], raw: msg,
    }
  }

  async function dispatchUpdate(update, { signal, current } = {}) {
    // 编辑事件只更新平台上下文，不触发新一轮回复；否则对方改一个字她就回一遍。
    const msg = update?.message
    if (!msg) return true
    if (signal?.aborted || (current && !current())) return false
    // 重启后不要补回上次进程停掉之前的旧消息；只处理本次启动后的消息。
    if (Number(msg.date) && Number(msg.date) < startedAt - 2) return true // 明确丢弃的旧消息也要确认游标
    let parsed
    try { parsed = await normalize(msg, signal) } catch (error) {
      if (error?.mediaTransient) { log.warn?.('Telegram 图片下载最终失败，保留消息稍后重试：', error.message); return false }
      throw error
    }
    if (signal?.aborted || (current && !current())) return false
    if (parsed) emit({ type: 'message', msg: parsed })
    return true
  }

  async function pollLoop(ctl, gen) {
    const current = () => running && generation === gen && !ctl.signal.aborted
    while (current()) {
      try {
        const updates = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'edited_message'] }, { signal: ctl.signal, timeoutMs: 35000 })
        for (const update of updates || []) {
          if (!current()) break
          const delivered = await dispatchUpdate(update, { signal: ctl.signal, current })
          if (!delivered) { await sleep(3000); break }
          offset = Math.max(offset, Number(update.update_id) + 1)
        }
      } catch (error) {
        if (!current()) break
        log.warn?.('Telegram 轮询失败：', error.message)
        await sleep(3000)
      }
    }
    if (generation === gen) setState('stopped')
  }

  const channel = {
    platform: PLATFORM, label: 'Telegram', caps: TELEGRAM_CAPS,
    selfId: () => String(me?.id || ''),
    ready, state: () => state,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    async start() {
      if (running) return
      if (!getConfig()?.enabled || !cfg().enabled || !token()) { setState('stopped'); return }
      const gen = ++generation
      const ctl = new AbortController()
      controller = ctl
      manualStop = false
      running = true; lastError = ''; setState('connecting'); startedAt = Math.floor(Date.now() / 1000)
      try {
        const meInfo = await call('getMe', {}, { signal: ctl.signal })
        if (generation !== gen || !running) { ctl.abort(); return }
        me = meInfo; lastError = ''
        // 换 Bot Token / API 地址后，旧 offset 属于另一个 Bot，必须从新 Bot 的第一条更新开始。
        const identity = base() + '|' + String(me.id || '')
        if (identity !== offsetIdentity) { offset = 0; offsetIdentity = identity }
        setState('connected')
        log.info?.(`Telegram 已连接：@${me.username || me.id}`)
        polling = pollLoop(ctl, gen)
      } catch (error) {
        if (generation !== gen || !running) return
        running = false; lastError = String(error?.message || error); setState('stopped'); controller = null; me = null
        log.warn?.('Telegram 启动失败：', lastError)
        throw error
      }
    },
    stop() {
      manualStop = true
      running = false
      generation += 1
      try { controller?.abort() } catch {}
      controller = null; me = null; setState('stopped')
    },
    async restart() { this.stop(); await this.start() },
    // 丢掉未处理的入站：把「只处理本次启动之后的消息」的时间基准推到当下，
    // 已经在队列里的旧 update 会在 dispatchUpdate 里被判为过期而丢弃（不需要联网）。
    resetInbox() { startedAt = Math.floor(Date.now() / 1000); offset = 0 },
    // 关通道时清理干净：停轮询、摘监听、忘掉 Bot 身份，免得重新创建时继承旧的 offset 与订阅者。
    dispose() {
      this.stop()
      listeners.clear()
      me = null
      offset = 0
      offsetIdentity = ''
      lastError = ''
    },
    watch() {
      if (manualStop) return
      if (state === 'connecting') return
      if (!getConfig()?.enabled || !cfg().enabled || !token()) { if (state !== 'stopped') this.stop(); return }
      if (state === 'stopped') this.start().catch(() => {})
    },
    async status() { return { state, login: me ? { uin: String(me.id), nickname: me.username || me.first_name || '' } : null, endpoint: { wsUrl: '', httpUrl: 'https://api.telegram.org' }, problem: state === 'connected' ? '' : (token() ? lastError : 'Bot Token 未配置') } },
    async send(chatId, segments) {
      const target = parseChat(chatId)
      if (!target || target.platform !== PLATFORM) throw new Error('不是 Telegram 的聊天：' + chatId)
      const text = (segments || []).filter((s) => s.type === 'text').map((s) => s.data?.text || '').join('')
      const image = (segments || []).find((s) => s.type === 'image')
      const replyId = (segments || []).find((s) => s.type === 'reply')?.data?.id
      const params = { chat_id: target.id, ...(replyId ? { reply_parameters: { message_id: Number(replyId) } } : {}) }
      let result
      const photo = image?.data?.file || image?.data?.url
      const isLocalPhoto = typeof photo === 'string' && (photo.startsWith('base64://') || photo.startsWith('data:image/'))
      if (image && isLocalPhoto) {
        // Telegram 的 sendPhoto 不接受裸 base64，需要 multipart 上传。
        const raw = photo.replace(/^base64:\/\//, '').replace(/^data:image\/[^;]+;base64,/, '')
        const bytes = Buffer.from(raw, 'base64')
        const form = new FormData()
        form.set('chat_id', target.id)
        if (replyId) form.set('reply_parameters', JSON.stringify({ message_id: Number(replyId) }))
        if (text && text.length <= 1024) form.set('caption', text)
        form.set('photo', new Blob([bytes]), 'sticker.jpg')
        result = await callForm('sendPhoto', form)
        if (text && text.length > 1024) await call('sendMessage', { chat_id: target.id, text })
      } else if (image && text.length > 1024) {
        result = await call('sendPhoto', { ...params, photo })
        await call('sendMessage', { chat_id: target.id, text })
      } else if (image) result = await call('sendPhoto', { ...params, photo, caption: text || undefined })
      else if (text) result = await call('sendMessage', { ...params, text })
      else return null
      return { ...result, messageId: String(result?.message_id || '') }
    },
    async group(chatId) {
      const target = parseChat(chatId)
      if (!target || target.kind !== 'group') return null
      const r = await call('getChat', { chat_id: target.id })
      return { name: r?.title || target.id }
    },
    textSegments: (text) => [{ type: 'text', data: { text } }],
    meta: () => ({ id: PLATFORM, label: 'Telegram', caps: TELEGRAM_CAPS }),
    convert: (raw) => normalize(raw),
  }
  return channel
}
