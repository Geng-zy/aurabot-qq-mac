// QQ 的连接：OneBot v11（macOS 上是你自己跑的 SnowLuma）。连网关、核对登录的是不是机器人号、补发队列、
// 把 OneBot 事件拆成通用形状，以及壳要的那些动作（发消息、群成员、聊天记录、戳一戳、贴表情……）。
// 壳只通过这里碰 QQ；只有 QQ 才有的功能（空间、改资料、SnowLuma 接口表）由声明了需要 QQ 的模块用 call()。

import { createOneBotClient, isDefiniteFailure } from './client.js'
import { createOutbox } from './outbox.js'
import { diagnose as diagnoseOneBot } from './diagnose.js'
import { parseMessageEvent } from './inbound.js'
import { createFaces, textToSegments, stripFaceTags } from './faces.js'
import { readForward } from './forward.js'
import { noticeText } from './notices.js'
import { fetchImage } from '../../core/net.js'
import { chatIdOf, parseChat } from '../ids.js'

export const PLATFORM = 'qq'

export const QQ_CAPS = Object.freeze({
  faces: true, stickers: true, voice: true, files: true, recall: true, poke: true, react: true, typing: true,
  history: true, forward: true, card: true, friendRequests: true, groupRequests: true, profile: true, groupAdmin: true,
})

/** 'qq:group:456' → { kind:'group', id:'456' }；别的平台、认不出返回 null。 */
export function qqTarget(chatId) {
  const p = parseChat(chatId)
  return p && p.platform === PLATFORM ? { kind: p.kind, id: p.id } : null
}
export const qqChat = (kind, id) => chatIdOf(PLATFORM, kind, String(id))

/**
 * @param {object} o
 * @param {() => object} o.getConfig 插件配置（snowluma 连接、botQQ、enabled）
 * @param {{info:Function, warn:Function, debug:Function, child?:Function}} o.log
 * @param {object} [o.client]   测试用：直接给一个 { call, start, stop, restart, state } 当网关
 * @param {object} [o.outbox]   测试用
 */
export function createQqChannel({ getConfig, log, client = null, outbox = null, flushEveryMs = 10_000 }) {
  const listeners = new Set()
  const emit = (e) => { for (const fn of [...listeners]) { try { fn(e) } catch (error) { log.warn('处理 QQ 事件出错：', error.message) } } }

  const endpoint = () => {
    const s = getConfig().snowluma || {}
    return { httpUrl: s.httpUrl || '', wsUrl: s.wsUrl || '', httpToken: s.httpToken || '', wsToken: s.wsToken || '' }
  }

  let gwState = 'stopped'
  // 连上后先核对登录的是不是机器人号，核对通过前不处理任何消息；不是就断开，不再自动重连
  let loginOk = false
  let wrongAccount = ''
  // 核对期间收到的事件先攒着：核对通过就补处理，核对失败就丢掉。
  // 直接丢弃的话，刚连上那几百毫秒里主人发的消息就没了（登录核对要等一次 get_login_info 往返）。
  let verifying = false
  let pendingEvents = []
  let disposed = false

  // outbox: false = 不要补发队列（测试、只读场合）
  const box = outbox === false ? null : (outbox || createOutbox({ log: log.child ? log.child('outbox') : log }))

  async function checkLogin() {
    verifying = true
    pendingEvents = []
    try {
      let uin = ''
      try {
        const info = await gw.call('get_login_info', {}, { timeoutMs: 10000 })
        uin = String(info?.user_id ?? '')
      } catch (error) {
        log.warn('核对登录的 QQ 号失败：', error.message)
      }
      if (gwState !== 'connected') return
      if (!uin) {
        // 核对不了就别用，断开后由看门狗重试
        gw.stop()
        return
      }
      if (uin === String(getConfig().botQQ)) {
        loginOk = true
        wrongAccount = ''
        // 把核对期间攒下的补上（按到达顺序）
        const queued = pendingEvents
        pendingEvents = []
        for (const ev of queued) dispatch(ev)
      } else {
        wrongAccount = uin
        pendingEvents = []
        gw.stop()
      }
    } finally {
      verifying = false
    }
  }

  const gw = client || createOneBotClient({
    endpoint,
    log,
    onState: (s, d) => onState(s, d),
    onEvent: (ev) => onEvent(ev),
  })

  function onState(s, d) {
    gwState = s
    if (s !== 'connected') { loginOk = false; pendingEvents = [] }
    else checkLogin().then(() => { if (loginOk) flushOutbox() }).catch((error) => log.warn('核对登录号出错：', error.message))
    log.info(`QQ 网关：${s}${d ? '（' + d + '）' : ''}`)
    emit({ type: 'state', state: s })
  }

  function onEvent(ev) {
    // 还没核对是机器人号：核对期间先攒着，核对通过后补处理
    if (!loginOk) {
      if (verifying) {
        pendingEvents.push(ev)
        if (pendingEvents.length > 200) pendingEvents.shift()
      }
      return
    }
    dispatch(ev)
  }

  /** 核对通过后的事件：先原样给一份（模块能看到所有原始事件），再拆成壳认识的几种。 */
  function dispatch(ev) {
    emit({ type: 'raw', event: ev })
    if (ev.post_type === 'message') emit({ type: 'message', msg: channel.parse(ev) })
    else if (ev.post_type !== 'notice') return
    else if (ev.notice_type === 'bot_offline') {
      log.warn(`QQ 账号离线${ev.tag ? '（' + String(ev.tag).slice(0, 100) + '）' : ''}${ev.message ? '：' + String(ev.message).slice(0, 300) : ''}`)
    } else if (ev.notice_type === 'notify' && ev.sub_type === 'poke') {
      const poke = channel.pokeOf(ev)
      if (poke) emit({ type: 'poke', poke })
    } else if (ev.notice_type === 'group_upload') {
      // 群文件是单独的通知，不是消息：转成一条文件消息走正常流程（白名单、头衔过滤都照旧）
      channel.groupFileMessage(ev).then((msg) => { if (msg && !disposed) emit({ type: 'message', msg }) }).catch((error) => log.warn('处理群文件出错：', error.message))
    } else {
      emit({ type: 'notice', notice: channel.noticeOf(ev) })
    }
  }

  // 网关未就绪时先攒着：只有「确定没发出去」的消息才入队，连接后按 TTL 补发。
  async function flushOutbox() {
    const config = getConfig()
    if (!box || gwState !== 'connected' || !loginOk || config.enabled === false || config.debug || config.dryRun) return
    try {
      const r = await box.flush((action, params, opts) => gw.call(action, params, { ...opts, retries: 0 }), {
        onSent: (item, result) => emit({
          type: 'delivered', chatId: item.chatId, message: item.params.message, note: item.note,
          messageId: result?.message_id ?? `outbox:${item.id}`, system: item.kind === 'system',
        }),
      })
      if (r.sent || r.dropped || r.left) log.info(`补发队列：成功 ${r.sent}，丢弃 ${r.dropped}，剩余 ${r.left}`)
    } catch (error) {
      log.warn('补发队列出错：', error.message)
    }
  }
  // 连接后漏掉的、或补发中途又断网的，定时再试；没连接时直接返回。
  const flushTimer = flushEveryMs > 0 ? setInterval(() => { flushOutbox().catch(() => {}) }, flushEveryMs) : null
  flushTimer?.unref?.()

  /** 连不上 QQ 网关时，按顺序找卡在哪一步，给一句人话。 */
  function connectionProblem() {
    const cfg = getConfig()
    if (!cfg.enabled) return '总开关关着（右上角），打开后才会连'
    if (!cfg.botQQ) return '还没填机器人 QQ 号'
    const ep = endpoint()
    if (!ep.wsUrl) return '还没填 OneBot 的 WebSocket 地址：在「连接」页填你的 OneBot v11 正向 WebSocket 地址（收消息要靠它；HTTP 可以不填）'
    if (wrongAccount) return `连上的是 ${wrongAccount}，不是机器人号 ${cfg.botQQ}，已经断开：让你的 OneBot 服务登录机器人号，再点「重新连接」`
    return `连 ${ep.wsUrl || ep.httpUrl} 没连上：确认 OneBot 服务（比如 OrbStack 里的 SnowLuma）开着、地址和 token 填对了`
  }

  const ready = () => gwState === 'connected' && loginOk

  const faces = createFaces({ onebot: { call: (a, p, o) => gw.call(a, p, o) }, log }) // QQ 系统表情：<face:名字> ↔ 编号

  /** 表情包/图片段里有没有能直接下载的地址（有些 get_msg 只回了空 url + 裸文件名）。 */
  const quoteSegUsable = (seg) => {
    const d = (seg && seg.data) || {}
    return [d.url, d.file].some((x) => typeof x === 'string'
      && (/^https?:\/\//i.test(x) || x.startsWith('base64://') || x.startsWith('file://') || /^[a-zA-Z]:[\\/]/.test(x)))
  }
  const quoteNeedsHistory = (parsed) => [...(parsed.images || []), ...(parsed.stickers || [])].some((seg) => !quoteSegUsable(seg))
  async function quoteFromHistory(chatId, id) {
    // 先用引用 id 当锚点（能取到更早的消息），拿不到再退回「最近 30 条」
    const anchor = /^-?\d+$/.test(id) ? Number(id) : 0
    const attempts = anchor ? [{ anchor, count: 5 }, { count: 30 }] : [{ count: 30 }]
    for (const a of attempts) {
      try {
        const list = await channel.history(chatId, a.count, { anchor: a.anchor, retries: 0 })
        const hit = list.find((m) => String(m?.message_id ?? '') === id || String(m?.real_id ?? '') === id)
        if (hit) return hit
      } catch (error) {
        log.debug(`引用消息历史也拉不到（${id}）：`, error.message)
      }
    }
    return null
  }

  const channel = {
    platform: PLATFORM,
    label: 'QQ',
    caps: QQ_CAPS,
    selfId: () => String(getConfig().botQQ || ''),
    ready,
    state: () => gwState,
    wrongAccount: () => wrongAccount,
    /** 机器人号改了、连接设置改了：旧的核对结果作废。 */
    resetAccount() { wrongAccount = '' },
    start() { if (!disposed) gw.start() },
    stop() { gw.stop() },
    restart() { if (!disposed) gw.restart() },
    /** 看门狗：总开关开着、上次没连错号，就保持连着。 */
    watch() {
      if (!getConfig().enabled) { if (gw.state !== 'stopped') gw.stop(); return }
      // 上次连上的不是机器人号：等主人点「重新连接」或改设置再连
      if (wrongAccount) return
      if (gw.state === 'stopped') gw.start()
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    /** 平台自己的接口（OneBot 动作）。 */
    call: (action, params, opts) => gw.call(action, params, opts),
    endpoint,
    connectionProblem,
    async login(timeoutMs = 5000) {
      const info = await gw.call('get_login_info', {}, { timeoutMs })
      return { uin: String(info?.user_id ?? ''), nickname: info?.nickname || '' }
    },
    async status() {
      let login = null
      if (gwState === 'connected') { try { login = await channel.login(5000) } catch {} }
      const ep = endpoint()
      return { state: gwState, login, endpoint: { httpUrl: ep.httpUrl, wsUrl: ep.wsUrl }, problem: ready() ? '' : connectionProblem() }
    },
    /** 一键诊断：顺着 OrbStack → SnowLuma 容器 → 端口 → 连上 → 登录的号 → 在线 一项项看 */
    diagnose: () => diagnoseOneBot({ cfg: getConfig(), state: gwState, wrongAccount, call: (a, p, o) => gw.call(a, p, o) }),
    /** 面板「重新连接」：等几秒看结果，别只回一句「正在重连」。 */
    async reconnect() {
      if (!getConfig().enabled) return { ok: false, message: connectionProblem() }
      wrongAccount = ''
      gw.restart()
      for (let i = 0; i < 16 && !ready(); i++) await new Promise((r) => setTimeout(r, 500))
      if (ready()) return { ok: true, message: '连上了' }
      return { ok: false, message: '没连上：' + connectionProblem() }
    },
    /**
     * 发一条消息。route.groupId：私聊是从群里临时会话来的，回的时候带上群号。
     * queue：确定没发出去（网关还没就绪）时放进补发队列，返回 { queued:true }；入不了队把原因写在 error.queueProblem 上再抛。
     */
    async send(chatId, message, { timeoutMs, route, queue = false, note = '', system = false } = {}) {
      const tgt = qqTarget(chatId)
      if (!tgt) throw new Error(`不是 QQ 的聊天：${chatId}`)
      const action = tgt.kind === 'group' ? 'send_group_msg' : 'send_private_msg'
      const sourceGroupId = tgt.kind === 'private' ? String(route?.groupId || '') : ''
      const params = tgt.kind === 'group' ? { group_id: Number(tgt.id), message } : { user_id: Number(tgt.id), ...(sourceGroupId ? { group_id: Number(sourceGroupId) } : {}), message }
      try {
        const r = await gw.call(action, params, timeoutMs ? { timeoutMs } : undefined)
        return { ...(r && typeof r === 'object' ? r : {}), ...(r && r.message_id !== undefined ? { messageId: String(r.message_id) } : {}) }
      } catch (error) {
        // 超时（uncertain）不入队，避免同一条消息发两次。
        if (queue && box && isDefiniteFailure(error)) {
          const q = box.add({ action, params, chatId, note, kind: system ? 'system' : 'reply' })
          if (q.ok) return { queued: true, queuedId: q.id, error }
          error.queueProblem = q.message
        }
        throw error
      }
    },
    /** 发文件（upload_group_file / upload_private_file）。file 可以是本机路径、网址或 base64://。 */
    async sendFile(chatId, { file, name }, { timeoutMs } = {}) {
      const tgt = qqTarget(chatId)
      if (!tgt) throw new Error(`不是 QQ 的聊天：${chatId}`)
      const action = tgt.kind === 'group' ? 'upload_group_file' : 'upload_private_file'
      const params = tgt.kind === 'group' ? { group_id: Number(tgt.id), file, name } : { user_id: Number(tgt.id), file, name }
      return gw.call(action, params, timeoutMs ? { timeoutMs } : undefined)
    },
    /** 网关明确说没发出去（可以换一种方式再发）；超时、结果不确定的不算。 */
    isDefiniteFailure,

    // ---------- 收 ----------
    faces,
    /** OneBot 消息事件 → 通用形状。 */
    parse: (event) => parseMessageEvent(event, String(event?.self_id || channel.selfId()), { faceName: faces.nameOf }),
    /** 她写的文字 → 消息段：<face:名字> 换成 QQ 系统表情（withFaces 关着就去掉标签）。 */
    textSegments: (text, withFaces = true) => (withFaces ? textToSegments(text, faces.idOf) : [{ type: 'text', data: { text: stripFaceTags(text) } }]),
    /** 群文件是单独的通知，不是消息：转成一条文件消息。 */
    async groupFileMessage(ev) {
      if (!ev?.file?.name) return null
      let nickname = String(ev.user_id)
      try {
        const m = await gw.call('get_group_member_info', { group_id: ev.group_id, user_id: ev.user_id }, { timeoutMs: 5000 })
        nickname = String(m?.card || m?.nickname || nickname)
      } catch (error) {}
      return channel.parse({
        post_type: 'message', message_type: 'group', sub_type: 'normal', self_id: ev.self_id, group_id: ev.group_id, user_id: ev.user_id, message_id: 0,
        sender: { user_id: ev.user_id, nickname },
        message: [{ type: 'file', data: { name: ev.file.name, size: ev.file.size, id: ev.file.id, busid: ev.file.busid } }],
      })
    },
    /** 戳一戳通知 → { chatId, groupId, userId, selfId, action, suffix }；不是戳她的返回 null。 */
    pokeOf(ev) {
      const self = String(ev?.self_id || channel.selfId())
      if (String(ev?.target_id) !== self) return null
      const groupId = ev.group_id ? String(ev.group_id) : ''
      const userId = String(groupId ? ev.user_id : ev.sender_id ?? ev.user_id)
      if (!userId || userId === self) return null
      return { platform: PLATFORM, chatId: groupId ? `group:${groupId}` : `private:${userId}`, kind: groupId ? 'group' : 'private', groupId, userId, selfId: self, action: ev.action || '', suffix: ev.suffix || '', raw: ev }
    },
    /** 把一次戳一戳当成一条对她说的话。 */
    pokeMessage(poke, nickname) {
      const group = poke.groupId
      return channel.parse({
        post_type: 'message', message_type: group ? 'group' : 'private', sub_type: group ? 'normal' : 'friend',
        self_id: Number(poke.selfId), user_id: Number(poke.userId), ...(group ? { group_id: Number(group) } : {}), message_id: 0,
        sender: { user_id: Number(poke.userId), nickname, card: nickname },
        message: [{ type: 'at', data: { qq: poke.selfId } }, { type: 'text', data: { text: ` [戳了戳你${poke.action ? '：' + poke.action + poke.suffix : ''}]` } }],
      })
    },
    /** 通知（撤回、进群、禁言……）→ { chatId, groupId, userId, people }；翻成一句话用 noticeText。 */
    noticeOf(ev) {
      if (ev?.post_type !== 'notice') return null
      const groupId = ev.group_id ? String(ev.group_id) : ''
      return { platform: PLATFORM, groupId, userId: String(ev.user_id ?? ''), people: [...new Set([ev.user_id, ev.operator_id, ev.sender_id].filter(Boolean).map(String))], raw: ev }
    },
    noticeText: (notice, { name, ownMessage } = {}) => noticeText(notice.raw, { botQQ: channel.selfId(), name, ownMessage, faceName: faces.nameOf }),

    // ---------- 人和群 ----------
    /** 群成员：{ user_id, nickname, card, role, title, join_time … }（OneBot 的样子）。 */
    async member(chatId, userId, { timeoutMs = 5000, retries, fresh = false } = {}) {
      const tgt = qqTarget(chatId)
      if (!tgt || tgt.kind !== 'group') return null
      return gw.call('get_group_member_info', { group_id: Number(tgt.id), user_id: Number(userId), ...(fresh ? { no_cache: true } : {}) }, { timeoutMs, ...(retries !== undefined ? { retries } : {}) })
    },
    async members(chatId, { timeoutMs = 15000, fresh = false } = {}) {
      const tgt = qqTarget(chatId)
      if (!tgt || tgt.kind !== 'group') return []
      const r = await gw.call('get_group_member_list', { group_id: Number(tgt.id), ...(fresh ? { no_cache: true } : {}) }, { timeoutMs })
      return Array.isArray(r) ? r : r?.data || []
    },
    user: (userId, { timeoutMs = 5000 } = {}) => gw.call('get_stranger_info', { user_id: Number(userId) }, { timeoutMs }),
    /** 群资料：{ name }。 */
    async group(chatId) {
      const tgt = qqTarget(chatId)
      if (!tgt || tgt.kind !== 'group') return null
      // 查群名是锦上添花：失败就退回群号，别在网关抖动时白等重试
      const info = await gw.call('get_group_info', { group_id: Number(tgt.id) }, { retries: 0 })
      return info ? { ...info, name: info.group_name || '' } : null
    },

    // ---------- 动作 ----------
    async react(chatId, messageId, emojiId) {
      await gw.call('set_msg_emoji_like', { message_id: String(messageId), emoji_id: String(emojiId), set: true }, { timeoutMs: 10000 })
    },
    async poke(chatId, userId) {
      const tgt = qqTarget(chatId)
      await gw.call('send_poke', { user_id: Number(userId), ...(tgt?.kind === 'group' ? { group_id: Number(tgt.id) } : {}) }, { timeoutMs: 10000 })
    },
    /** 「对方正在输入」：QQ 只有私聊有。 */
    async typing(chatId) {
      const tgt = qqTarget(chatId)
      if (!tgt || tgt.kind !== 'private') return
      await gw.call('set_input_status', { user_id: Number(tgt.id), event_type: 1 }, { timeoutMs: 5000 })
    },
    /** 最近的消息（OneBot 原样）。 */
    async history(chatId, count, { timeoutMs = 8000, retries, anchor } = {}) {
      const tgt = qqTarget(chatId)
      if (!tgt) return []
      const base = tgt.kind === 'group' ? { group_id: Number(tgt.id) } : { user_id: Number(tgt.id) }
      const params = anchor ? { ...base, message_id: anchor, count, reverse_order: false } : { ...base, count }
      const r = await gw.call(tgt.kind === 'group' ? 'get_group_msg_history' : 'get_friend_msg_history', params, { timeoutMs, ...(retries !== undefined ? { retries } : {}) })
      return Array.isArray(r) ? r : r?.messages || []
    },
    /**
     * 被引用的那条消息：{ time, userId, nickname, msg }（msg 是通用形状）。
     * get_msg 对「她发出的表情包/图片」可能只回空 url + 裸文件名（下载不了），这时退回消息历史，里面带可用 url。
     */
    async quote(chatId, id) {
      const tgt = qqTarget(chatId)
      const m = await gw.call('get_msg', { message_id: Number(id) || id }, { timeoutMs: 5000, retries: 0 })
      // 被引用那条消息的发生时间（QQ 给的是秒）
      let time = Number(m?.time) || 0
      const sender = m?.sender || {}
      const userId = String(sender.user_id ?? m?.user_id ?? '')
      const nickname = String(sender.card || sender.nickname || userId || '某人')
      const kind = tgt?.kind === 'group' ? 'group' : 'private'
      const groupId = kind === 'group' ? tgt.id : undefined
      let parsed = channel.parse({ message_type: kind, group_id: groupId, user_id: userId, sender, message: m?.message ?? m?.raw_message ?? '' })
      if (tgt && quoteNeedsHistory(parsed)) {
        const hit = await quoteFromHistory(chatId, String(id))
        if (hit) {
          time ||= Number(hit?.time) || 0
          const again = channel.parse({ message_type: kind, group_id: groupId, user_id: userId, sender: hit.sender || sender, message: hit.message ?? '' })
          if (!quoteNeedsHistory(again)) parsed = again
          else { parsed.images = [...(parsed.images || []), ...(again.images || [])]; parsed.stickers = [...(parsed.stickers || []), ...(again.stickers || [])] }
        }
      }
      return { time, userId, nickname, msg: parsed }
    },
    /** 语音条 → wav（原始字节，没转采样率）。QQ 语音是 silk，让网关转。 */
    async voiceWav(rec) {
      const info = await gw.call('get_record', { file: rec.data?.file, out_format: 'wav' }, { timeoutMs: 30000 })
      return info?.base64 ? Buffer.from(info.base64, 'base64') : await fetchImage(info?.file || info?.url, { maxBytes: 30 * 1024 * 1024 })
    },
    /** QQ 自己的语音转文字。 */
    async voiceText(msg) {
      const r = await gw.call('fetch_ptt_text', { message_id: Number(msg.messageId) || msg.messageId }, { timeoutMs: 20000 })
      return String(r?.text || '').trim()
    },
    /** 展开一条合并转发：{ lines, images, stickers }。 */
    forward: (id) => readForward({ call: (a, p, o) => gw.call(a, p, o) }, id, { selfId: channel.selfId(), faceName: faces.nameOf, log }),
    outbox: box,
    flushOutbox,
    isDefiniteFailure,
    dispose() {
      disposed = true
      if (flushTimer) clearInterval(flushTimer)
      listeners.clear()
      gw.stop()
    },
  }
  return channel
}
