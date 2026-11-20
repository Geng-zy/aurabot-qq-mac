// QQ 的连接：OneBot v11（macOS 上是你自己跑的 SnowLuma）。连网关、核对登录的是不是机器人号、补发队列、
// 把 OneBot 事件拆成通用形状，以及壳要的那些动作（发消息、群成员、聊天记录、戳一戳、贴表情……）。
// 壳只通过这里碰 QQ；只有 QQ 才有的功能（空间、改资料、SnowLuma 接口表）由声明了需要 QQ 的模块用 call()。

import { createOneBotClient, isDefiniteFailure } from './transport.js'
import { createOutbox } from './outbox.js'
import { createPeopleApi } from './features/people.js'
import { createHistoryApi } from './features/history.js'
import { createOutboundApi } from './features/outbound.js'
import { createActionsApi } from './features/actions.js'
import { isLegacyDirectRecord, parseMessageEvent } from './convert.js'
import { createFaces, textToSegments, stripFaceTags } from './faces.js'
import { createFaceCatalog } from './features/face-catalog.js'
import { readForward } from './forward.js'
import { createEventApi } from './features/events.js'
import { createConnectionApi } from './features/connection.js'
import { createDispatcher } from './features/dispatch.js'
import { createOutboxFlush } from './features/outbox-flush.js'
import { createQuoteApi } from './features/quote.js'
import { createQqInbox } from './inbox.js'
import { PLATFORM, QQ_CAPS, qqTarget, qqChat } from './contract.js'

export { PLATFORM, QQ_CAPS, qqTarget, qqChat } from './contract.js'

/**
 * @param {object} o
 * @param {() => object} o.getConfig 插件配置（snowluma 连接、botQQ、enabled）
 * @param {{info:Function, warn:Function, debug:Function, child?:Function}} o.log
 * @param {object} [o.client]   测试用：直接给一个 { call, start, stop, restart, state } 当网关
 * @param {object} [o.outbox]   测试用
 */
export function createQqChannel({ getConfig, log, client = null, outbox = null, flushEveryMs = 10_000, canReplayDelivery }) {
  const listeners = new Set()
  const emit = (e) => { for (const fn of [...listeners]) { try { fn(e) } catch (error) { log.warn('处理 QQ 事件出错：', error.message) } } }

  const endpoint = () => {
    const cfg = getConfig() || {}
    const s = cfg.platforms?.qq || cfg.snowluma || {}
    return { httpUrl: s.httpUrl || '', wsUrl: s.wsUrl || '', httpToken: s.httpToken || '', wsToken: s.wsToken || '' }
  }
  const enabled = () => {
    const cfg = getConfig() || {}
    return cfg.enabled !== false && cfg.platforms?.qq?.enabled !== false
  }
  const botAccount = () => String(getConfig()?.platforms?.qq?.botQQ || getConfig()?.botQQ || '')

  let gwState = 'stopped'
  // 连上后先核对登录的是不是机器人号，核对通过前不处理任何消息；不是就断开，不再自动重连
  let loginOk = false
  let verifiedLogin = null
  let wrongAccount = ''
  // 核对期间收到的事件先攒着：核对通过就补处理，核对失败就丢掉。
  // 直接丢弃的话，刚连上那几百毫秒里管理员发的消息就没了（登录核对要等一次 get_login_info 往返）。
  let verifying = false
  let pendingEvents = []
  let connectionRevision = 0
  let disposed = false
  const inbox = createQqInbox({ getConfig, log })

  // outbox: false = 不要补发队列（测试、只读场合）
  const box = outbox === false ? null : (outbox || createOutbox({ log: log.child ? log.child('outbox') : log }))

  async function checkLogin(revision, connectedAt) {
    verifying = true
    pendingEvents = []
    try {
      let login = null
      try {
        // 核对事件来自哪一个连接，必须以当前 WebSocket 上的响应为准。
        const info = await gw.call('get_login_info', {}, { timeoutMs: 10000, wsOnly: true })
        login = { uin: String(info?.user_id ?? ''), nickname: info?.nickname || '' }
      } catch (error) {
        if (revision !== connectionRevision) return
        log.warn('核对登录的 QQ 号失败：', error.message)
      }
      if (revision !== connectionRevision) return
      if (!login?.uin) {
        // 核对不了就别用，断开后由看门狗重试
        gw.stop()
        return
      }
      if (login.uin === botAccount()) {
        loginOk = true
        verifiedLogin = login
        wrongAccount = ''
        const recovery = inbox.prepare(connectedAt)
        // 把核对期间攒下的补上（按到达顺序）
        const queued = pendingEvents
        pendingEvents = []
        for (const ev of queued) {
          if (revision !== connectionRevision) break
          dispatch(ev)
        }
        void inbox.recover(recovery, {
          call: (action, params, options) => gw.call(action, params, options),
          isCurrent: () => !disposed && revision === connectionRevision && ready(),
          onMessage: (ev) => emit({ type: 'message', msg: { ...channel.parse(ev), recovered: true } }),
        })
      } else {
        wrongAccount = login.uin
        pendingEvents = []
        gw.stop()
      }
    } finally {
      if (revision === connectionRevision) verifying = false
    }
  }

  const gw = client || createOneBotClient({
    endpoint,
    log,
    onState: (s, d) => onState(s, d),
    onEvent: (ev) => onEvent(ev),
  })
  const people = createPeopleApi({ call: (a, p, o) => gw.call(a, p, o), targetOf: qqTarget })
  const fetchHistory = createHistoryApi({ call: (a, p, o) => gw.call(a, p, o), targetOf: qqTarget, isLegacyDirectRecord })

  function onState(s, d) {
    const revision = ++connectionRevision
    gwState = s
    if (s !== 'connected') {
      if (loginOk) inbox.disconnect()
      loginOk = false
      verifiedLogin = null
      verifying = false
      pendingEvents = []
    } else checkLogin(revision, Date.now()).then(() => { if (revision === connectionRevision && loginOk) flushOutbox() }).catch((error) => log.warn('核对登录号出错：', error.message))
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

  const dispatch = createDispatcher({ emit, inbox, getChannel: () => channel, isDisposed: () => disposed, log })

  // 网关未就绪时先攒着：只有「确定没发出去」的消息才入队，连接后按 TTL 补发。
  let outboxFlusher = null
  async function flushOutbox() { return outboxFlusher?.flush() }

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

  const quoteApi = createQuoteApi({ call: (a, p, o) => gw.call(a, p, o), targetOf: qqTarget, parse: (e) => channel.parse(e), fetchHistory, log, isLegacyDirectRecord })
  const { quoteNeedsHistory, quoteFromHistory } = quoteApi

  const outbound = createOutboundApi({ call: (a, p, o) => gw.call(a, p, o), targetOf: qqTarget, box, isDefiniteFailure })
  const actions = createActionsApi({ call: (a, p, o) => gw.call(a, p, o), targetOf: qqTarget })
  const faceCatalog = createFaceCatalog({ call: (a, p, o) => gw.call(a, p, o), log })
  const connection = createConnectionApi({ call: (a, p, o) => gw.call(a, p, o), endpoint, getConfig, getState: () => gwState, ready, getLogin: () => verifiedLogin, getWrongAccount: () => wrongAccount, setWrongAccount: (v) => { wrongAccount = v }, isDisposed: () => disposed, connectionProblem, enabled, restart: () => gw.restart() })
  const events = createEventApi({ call: (a, p, o) => gw.call(a, p, o), parse: (e) => channel.parse(e), selfId: () => channel.selfId(), faceName: (id) => faces.nameOf(id) })

  const channel = {
    platform: PLATFORM,
    label: 'QQ',
    caps: QQ_CAPS,
    selfId: () => botAccount(),
    ready,
    state: () => gwState,
    wrongAccount: () => wrongAccount,
    /** 机器人号改了、连接设置改了：旧的核对结果作废。 */
    resetAccount() { wrongAccount = '' },
    resetInbox() { inbox.suspend() },
    start() { if (!disposed && enabled()) gw.start() },
    stop() { gw.stop() },
    restart() { if (!disposed && enabled()) gw.restart() },
    /** 看门狗：总开关开着、上次没连错号，就保持连着。 */
    watch() {
      if (disposed) return
      if (!enabled()) { if (gw.state !== 'stopped') gw.stop(); return }
      // 上次连上的不是机器人号：等管理员点「重新连接」或改设置再连
      if (wrongAccount) return
      if (gw.state === 'stopped') gw.start()
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    /** 平台自己的接口（OneBot 动作）。 */
    call: (action, params, opts) => gw.call(action, params, opts),
    endpoint,
    connectionProblem,
    ...connection,
    ...outbound,
    /** 网关明确说没发出去（可以换一种方式再发）；超时、结果不确定的不算。 */
    isDefiniteFailure,

    // ---------- 收 ----------
    faces,
    faceCatalog,
    /** OneBot 消息事件 → 通用形状。 */
    parse: (event) => parseMessageEvent(event, String(event?.self_id || channel.selfId()), { faceName: faces.nameOf }),
    /** AstrBot 风格的适配器方法别名：转换一条原始事件。 */
    convert: (event) => channel.parse(event),
    meta: () => ({ id: 'qq', label: 'QQ', caps: QQ_CAPS }),
    /** 她写的文字 → 消息段：<face:名字> 换成 QQ 系统表情（withFaces 关着就去掉标签）。 */
    textSegments: (text, withFaces = true) => (withFaces ? textToSegments(text, faces.idOf) : [{ type: 'text', data: { text: stripFaceTags(text) } }]),
    // ---------- 入站事件 ----------
    ...events,


    // ---------- 人和群 ----------
    ...people,

    // ---------- 动作 ----------
    ...actions,
    history: fetchHistory,
    quote: quoteApi.quote,
    /** 展开一条合并转发：{ lines, images, stickers }。 */
    forward: (id) => readForward({ call: (a, p, o) => gw.call(a, p, o) }, id, { selfId: channel.selfId(), faceName: faces.nameOf, log }),
    outbox: box,
    flushOutbox,
    isDefiniteFailure,
    dispose() {
      disposed = true
      inbox.flush()
      if (flushTimer) clearInterval(flushTimer)
      listeners.clear()
      gw.stop()
    },
  }
  outboxFlusher = createOutboxFlush({
    box,
    call: (action, params, opts) => gw.call(action, params, { ...opts, retries: 0 }),
    getConfig,
    isConnected: () => ready(),
    isDisposed: () => disposed,
    getRevision: () => connectionRevision,
    canReplayDelivery,
    onSent: (item, result) => emit({
      type: 'delivered', chatId: item.chatId, message: item.params.message, note: item.note,
      messageId: result?.message_id ?? `outbox:${item.id}`, system: item.kind === 'system', replyJournal: item.replyJournal, replyFeed: item.replyFeed,
    }),
    log,
  })

  return channel
}
