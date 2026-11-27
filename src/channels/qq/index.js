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
import { readForward } from './forward.js'
import { createEventApi } from './features/events.js'
import { createConnectionApi } from './features/connection.js'
import { createDispatcher } from './features/dispatch.js'
import { createQuoteApi } from './features/quote.js'
import { createConfigApi } from './features/config.js'
import { createLifecycle } from './features/lifecycle.js'
import { createLoginGate } from './features/login.js'
import { createGateStatus } from './features/gate-status.js'
import { createOutboxWiring } from './features/outbox-wiring.js'
import { createQqInbox } from './inbox.js'
import { PLATFORM, QQ_CAPS, qqTarget } from './contract.js'

export { PLATFORM, QQ_CAPS, qqTarget, qqChat } from './contract.js'

/**
 * @param {object} o
 * @param {() => object} o.getConfig 插件配置（snowluma 连接、botQQ、enabled）
 * @param {{info:Function, warn:Function, debug:Function, child?:Function}} o.log
 * @param {object} [o.client]   测试用：直接给一个 { call, start, stop, restart, state } 当网关
 * @param {object} [o.outbox]   测试用
 */
export function createQqChannel({ getConfig, log, client = null, outbox = null, flushEveryMs = 10_000, canReplayDelivery, outboxBarrier = null }) {
  let outboxBeforeSend = outboxBarrier
  const listeners = new Set()
  const emit = (e) => { for (const fn of [...listeners]) { try { fn(e) } catch (error) { log.warn('处理 QQ 事件出错：', error.message) } } }

  const { endpoint, enabled, botAccount, connectionProblem: baseConnectionProblem } = createConfigApi({ getConfig })

  let disposed = false
  const inbox = createQqInbox({ getConfig, log })

  // outbox: false = 不要补发队列（测试、只读场合）
  const box = outbox === false ? null : (outbox || createOutbox({ log: log.child ? log.child('outbox') : log }))

  // 网关状态机与登录核对在 features/gate-status.js 里；这边只接线。
  let gate = null
  const gw = client || createOneBotClient({
    endpoint,
    log,
    onState: (s, d) => gate?.onState(s, d),
    onEvent: (ev) => gate?.onEvent(ev),
  })
  const people = createPeopleApi({ call: (a, p, o) => gw.call(a, p, o), targetOf: qqTarget })
  const fetchHistory = createHistoryApi({ call: (a, p, o) => gw.call(a, p, o), targetOf: qqTarget, isLegacyDirectRecord })

  const dispatch = createDispatcher({ emit, inbox, getChannel: () => channel, isDisposed: () => disposed, log })

  gate = createGateStatus({
    createLoginGate,
    call: (a, p, o) => gw.call(a, p, o),
    getBotAccount: botAccount,
    inbox,
    dispatch,
    emit,
    getChannel: () => channel,
    isDisposed: () => disposed,
    log,
    // 核对通过就补发队列；号不对就停机（具体动作由装配决定，状态机不管）
    onLoginOk: (revision) => { if (revision === gate.revision()) flushOutbox() },
    onLoginFatal: () => gw.stop(),
  })

  // 网关未就绪时先攒着：只有「确定没发出去」的消息才入队，连接后按 TTL 补发。
  const wiring = createOutboxWiring({
    box,
    call: (a, p, o) => gw.call(a, p, o),
    getConfig,
    isConnected: () => ready(),
    isDisposed: () => disposed,
    getRevision: () => gate.revision(),
    canReplayDelivery,
    getBarrier: () => outboxBeforeSend,
    emit,
    log,
    flushEveryMs,
  })
  const flushOutbox = wiring.flush

  const connectionProblem = () => baseConnectionProblem(() => gate.auth.wrongAccount)
  const ready = () => gate.ready()

  const { faces, textSegments } = createFaceCodec({ call: (a, p, o) => gw.call(a, p, o), log })

  const quoteApi = createQuoteApi({ call: (a, p, o) => gw.call(a, p, o), targetOf: qqTarget, parse: (e) => channel.parse(e), fetchHistory, log, isLegacyDirectRecord })
  const outboundReady = () => !gate.auth.wrongAccount && (gate.state() !== 'connected' || gate.auth.loginOk)
  const outbound = createOutboundApi({ call: (a, p, o) => gw.call(a, p, o), targetOf: qqTarget, box, isDefiniteFailure, isReady: outboundReady })
  const actions = createActionsApi({ call: (a, p, o) => gw.call(a, p, o), targetOf: qqTarget })
  const connection = createConnectionApi({ call: (a, p, o) => gw.call(a, p, o), endpoint, getConfig, getState: () => gate.state(), ready, getLogin: () => gate.auth.verifiedLogin, getWrongAccount: () => gate.auth.wrongAccount, setWrongAccount: (v) => { gate.auth.wrongAccount = v }, isDisposed: () => disposed, connectionProblem, enabled, restart: () => gw.restart() })
  const events = createEventApi({ call: (a, p, o) => gw.call(a, p, o), parse: (e) => channel.parse(e), selfId: () => channel.selfId(), faceName: (id) => faces.nameOf(id) })
  const lifecycle = createLifecycle({ gw, inbox, listeners, getFlushTimer: () => wiring.timer, setDisposed: (v) => { disposed = v }, isDisposed: () => disposed, enabled, getWrongAccount: () => gate.auth.wrongAccount })

  const channel = {
    platform: PLATFORM,
    label: 'QQ',
    caps: QQ_CAPS,
    selfId: () => botAccount(),
    ready,
    state: () => gate.state(),
    wrongAccount: () => gate.auth.wrongAccount,
    /** 机器人号改了、连接设置改了：旧的核对结果作废。 */
    resetAccount: () => gate.resetAccount(),
    ...lifecycle,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    /** 平台自己的接口（OneBot 动作）。 */
    call: (action, params, opts) => gw.call(action, params, opts),
    endpoint,
    connectionProblem,
    ...connection,
    ...outbound,
    // ---------- 收 ----------
    faces,
    faceCatalog: () => faces.list(),
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
    // 合并转发展开：一层纯装配，原 features/forward.js 只有 8 行纯透传（删除测试不过），内联在这里。
    forward: (id) => readForward({ call: (a, p, o) => gw.call(a, p, o) }, id, { selfId: channel.selfId(), faceName: (n) => faces.nameOf(n), log }),
    outbox: box,
    flushOutbox,
    /** 宿主注入：补发前等当前聊天的多气泡发送结束。 */
    setOutboxBarrier: (fn) => { outboxBeforeSend = fn },
    isDefiniteFailure,
  }
  return channel
}
