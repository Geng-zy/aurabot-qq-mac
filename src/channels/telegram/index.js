// Telegram 平台适配器：长轮询 Bot API，不要求公网端口。
// 只实现最小能力：文本、回复、图片；平台特有的按钮/文件等以后按 caps 增加。
import { chatIdOf, parseChat } from '../ids.js'

export const PLATFORM = 'telegram'
export const TELEGRAM_CAPS = Object.freeze({ text: true, reply: true, images: true, files: false, voice: false, stickers: false, faces: false, poke: false, react: false, typing: false, history: false, forward: false, card: false, friendRequests: false, groupRequests: false, profile: false, groupAdmin: false })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function createTelegramChannel({ getConfig, log = {}, fetchImpl = globalThis.fetch } = {}) {
  const listeners = new Set()
  let state = 'stopped'
  let me = null
  let offset = 0
  let startedAt = 0
  let running = false
  let controller = null
  let polling = null
  const cfg = () => getConfig()?.platforms?.telegram || {}
  const token = () => String(cfg().token || '').trim()
  const base = () => `${String(cfg().apiBase || 'https://api.telegram.org').replace(/\/+$/, '')}/bot${token()}`
  const ready = () => state === 'connected' && Boolean(me)
  const emit = (e) => { for (const fn of [...listeners]) { try { fn(e) } catch (error) { log.warn?.('Telegram 事件处理失败：', error.message) } } }

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
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.description || `Telegram ${method} 失败：HTTP ${res.status}`)
      return data.result
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
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.description || `Telegram ${method} 失败：HTTP ${res.status}`)
      return data.result
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', abort)
    }
  }

  function normalize(msg) {
    if (!msg?.chat) return null
    const kind = msg.chat.type === 'private' ? 'private' : 'group'
    const chatId = chatIdOf(PLATFORM, kind, String(msg.chat.id))
    const text = String(msg.text || msg.caption || '')
    const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo.at(-1) : null
    const images = photo?.file_id ? [{ type: 'image', data: { file: photo.file_id } }] : []
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
      text, mentioned, atOthers, messageId: String(msg.message_id), replyId: msg.reply_to_message?.message_id ? String(msg.reply_to_message.message_id) : '',
      images, stickers: [], records: [], files: [], segments: [{ type: 'text', data: { text } }, ...images], raw: msg,
    }
  }

  async function dispatchUpdate(update) {
    const msg = update?.message || update?.edited_message
    if (!msg) return
    // 重启后不要补回上次进程停掉之前的旧消息；只处理本次启动后的消息。
    if (Number(msg.date) && Number(msg.date) < startedAt - 2) return
    const parsed = normalize(msg)
    if (parsed) emit({ type: 'message', msg: parsed })
  }

  async function pollLoop() {
    while (running && !controller?.signal.aborted) {
      try {
        const updates = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'edited_message'] }, { signal: controller.signal, timeoutMs: 35000 })
        for (const update of updates || []) {
          offset = Math.max(offset, Number(update.update_id) + 1)
          await dispatchUpdate(update)
        }
      } catch (error) {
        if (controller?.signal.aborted) break
        log.warn?.('Telegram 轮询失败：', error.message)
        await sleep(3000)
      }
    }
    if (state !== 'stopped') state = 'stopped'
  }

  const channel = {
    platform: PLATFORM, label: 'Telegram', caps: TELEGRAM_CAPS,
    selfId: () => String(me?.id || ''),
    ready, state: () => state,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    async start() {
      if (running) return
      if (!getConfig()?.enabled || !cfg().enabled || !token()) { state = 'stopped'; return }
      running = true; state = 'connecting'; startedAt = Math.floor(Date.now() / 1000); controller = new AbortController()
      try {
        me = await call('getMe', {}, { signal: controller.signal })
        state = 'connected'
        log.info?.(`Telegram 已连接：@${me.username || me.id}`)
        polling = pollLoop()
      } catch (error) {
        running = false; state = 'stopped'
        log.warn?.('Telegram 启动失败：', error.message)
        throw error
      }
    },
    stop() {
      running = false
      try { controller?.abort() } catch {}
      controller = null; me = null; state = 'stopped'
    },
    async restart() { this.stop(); await this.start() },
    watch() {
      if (state === 'connecting') return
      if (!getConfig()?.enabled || !cfg().enabled || !token()) { if (state !== 'stopped') this.stop(); return }
      if (state === 'stopped') this.start().catch(() => {})
    },
    async status() { return { state, login: me ? { uin: String(me.id), nickname: me.username || me.first_name || '' } : null, endpoint: { wsUrl: '', httpUrl: 'https://api.telegram.org' }, problem: state === 'connected' ? '' : (token() ? '' : 'Bot Token 未配置') } },
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
      else return { queued: false }
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
