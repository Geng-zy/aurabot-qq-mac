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
import { createFaceCodec } from './features/face-codec.js'
import { createFaceCatalog } from './features/face-catalog.js'
import { createEventApi } from './features/events.js'
import { createConnectionApi } from './features/connection.js'
import { createDispatcher } from './features/dispatch.js'
import { createOutboxFlush } from './features/outbox-flush.js'
import { createQuoteApi } from './features/quote.js'
import { createForwardApi } from './features/forward.js'
import { createConfigApi } from './features/config.js'
import { createLifecycle } from './features/lifecycle.js'
import { createLoginGate } from './features/login.js'
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

  const { endpoint, enabled, botAccount, connectionProblem: baseConnectionProblem } = createConfigApi({ getConfig })

  let gwState = 'stopped'
  // 连上后先核对登录的是不是机器人号；核对期间事件暂存，通过后补处理。
  const auth = { loginOk: false, verifiedLogin: null, wrongAccount: '', verifying: false, pendingEvents: [] }
  let connectionRevision = 0
  let disposed = false
  const inbox = createQqInbox({ getConfig, log })

  // outbox: false = 不要补发队列（测试、只读场合）
  const box = outbox === false ? null : (outbox || createOutbox({ log: log.child ? log.child('outbox') : log }))

  const gw = client || createOneBotClient({
    endpoint,
    log,
    onState: (s, d) => onState(s, d),
    onEvent: (ev) => onEvent(ev),
  })
  const people = createPeopleApi({ call: (a, p, o) => gw.call(a, p, o), targetOf: qqTarget })
  const fetchHistory = createHistoryApi({ call: (a, p, o) => gw.call(a, p, o), targetOf: qqTarget, isLegacyDirectRecord })

  const loginGate = createLoginGate({
    call: (a, p, o) => gw.call(a, p, o),
    getBotAccount: botAccount,
    inbox,
    dispatch: (ev) => dispatch(ev),
    emit,
    getChannel: () => channel,
    isDisposed: () => disposed,
    getRevision: () => connectionRevision,
    isReady: () => ready(),
    state: auth,
    log,
  })

  function onState(s, d) {
    const revision = ++connectionRevision
    gwState = s
    if (s !== 'connected') loginGate.onDisconnected()
    else loginGate.checkLogin(revision, Date.now()).then((result) => {
      if (revision === connectionRevision && result?.ok) flushOutbox()
      else if (result?.reason === 'no-login' || result?.reason === 'wrong-account') gw.stop()
    }).catch((error) => log.warn('核对登录号出错：', error.message))
    log.info(`QQ 网关：${s}${d ? '（' + d + '）' : ''}`)
    emit({ type: 'state', state: s })
  }

  function onEvent(ev) {
    loginGate.onEvent(ev)
  }

  const dispatch = createDispatcher({ emit, inbox, getChannel: () => channel, isDisposed: () => disposed, log })

  // 网关未就绪时先攒着：只有「确定没发出去」的消息才入队，连接后按 TTL 补发。
  let outboxFlusher = null
  async function flushOutbox() { return outboxFlusher?.flush() }

  // 连接后漏掉的、或补发中途又断网的，定时再试；没连接时直接返回。
  const flushTimer = flushEveryMs > 0 ? setInterval(() => { flushOutbox().catch(() => {}) }, flushEveryMs) : null
  flushTimer?.unref?.()

  const connectionProblem = () => baseConnectionProblem(() => auth.wrongAccount)

  const ready = () => gwState === 'connected' && auth.loginOk

  const { faces, textSegments } = createFaceCodec({ call: (a, p, o) => gw.call(a, p, o), log })

  const quoteApi = createQuoteApi({ call: (a, p, o) => gw.call(a, p, o), targetOf: qqTarget, parse: (e) => channel.parse(e), fetchHistory, log, isLegacyDirectRecord })
  const outbound = createOutboundApi({ call: (a, p, o) => gw.call(a, p, o), targetOf: qqTarget, box, isDefiniteFailure })
  const actions = createActionsApi({ call: (a, p, o) => gw.call(a, p, o), targetOf: qqTarget })
  const faceCatalog = createFaceCatalog({ call: (a, p, o) => gw.call(a, p, o), log })
  const connection = createConnectionApi({ call: (a, p, o) => gw.call(a, p, o), endpoint, getConfig, getState: () => gwState, ready, getLogin: () => auth.verifiedLogin, getWrongAccount: () => auth.wrongAccount, setWrongAccount: (v) => { auth.wrongAccount = v }, isDisposed: () => disposed, connectionProblem, enabled, restart: () => gw.restart() })
  const events = createEventApi({ call: (a, p, o) => gw.call(a, p, o), parse: (e) => channel.parse(e), selfId: () => channel.selfId(), faceName: (id) => faces.nameOf(id) })
  const forward = createForwardApi({ call: (a, p, o) => gw.call(a, p, o), selfId: () => channel.selfId(), faceName: (id) => faces.nameOf(id), log })
  const lifecycle = createLifecycle({ gw, inbox, listeners, getFlushTimer: () => flushTimer, setDisposed: (v) => { disposed = v } })

  const channel = {
    platform: PLATFORM,
    label: 'QQ',
    caps: QQ_CAPS,
    selfId: () => botAccount(),
    ready,
    state: () => gwState,
    wrongAccount: () => auth.wrongAccount,
    /** 机器人号改了、连接设置改了：旧的核对结果作废。 */
    resetAccount() { auth.wrongAccount = '' },
    resetInbox() { inbox.suspend() },
    start() { if (!disposed && enabled()) gw.start() },
    stop() { gw.stop() },
    restart() { if (!disposed && enabled()) gw.restart() },
    /** 看门狗：总开关开着、上次没连错号，就保持连着。 */
    watch() {
      if (disposed) return
      if (!enabled()) { if (gw.state !== 'stopped') gw.stop(); return }
      // 上次连上的不是机器人号：等管理员点「重新连接」或改设置再连
      if (auth.wrongAccount) return
      if (gw.state === 'stopped') gw.start()
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    /** 平台自己的接口（OneBot 动作）。 */
    call: (action, params, opts) => gw.call(action, params, opts),
    endpoint,
    connectionProblem,
    ...connection,
    ...outbound,
    // ---------- 收 ----------
    faces,
    faceCatalog,
    /** OneBot 消息事件 → 通用形状。 */
    parse: (event) => parseMessageEvent(event, String(event?.self_id || channel.selfId()), { faceName: faces.nameOf }),
    /** AstrBot 风格的适配器方法别名：转换一条原始事件。 */
    convert: (event) => channel.parse(event),
    meta: () => ({ id: 'qq', label: 'QQ', caps: QQ_CAPS }),
    /** 她写的文字 → 消息段：<face:名字> 换成 QQ 系统表情（withFaces 关着就去掉标签）。 */
    textSegments,
    // ---------- 入站事件 ----------
    ...events,


    // ---------- 人和群 ----------
    ...people,

    // ---------- 动作 ----------
    ...actions,
    history: fetchHistory,
    quote: quoteApi.quote,
    /** 展开一条合并转发：{ lines, images, stickers }。 */
    ...forward,
    outbox: box,
    flushOutbox,
    isDefiniteFailure,
    ...lifecycle,
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
