// AstrBot 风格的 QQ 适配器入口。
// 对外只暴露 PlatformAdapter 形状：meta / run / convert / sendBySession / commitEvent。
// WebSocket、OneBot 事件解析、出站队列等实现暂时收在 transport 里，后续可以逐块替换，
// 这样群管、空间、文件、语音这些已有能力不会在重写入口时一起丢掉。
import { createQqChannel } from './index.js'
import { convertMessageEvent } from './convert.js'

export function createQqAdapter(ctx = {}) {
  const transport = ctx.createTransport ? ctx.createTransport(ctx) : createQqChannel(ctx)

  return {
    platform: 'qq',
    label: 'QQ',
    caps: transport.caps,
    meta: () => transport.meta?.() || ({ id: 'qq', label: 'QQ', caps: transport.caps }),
    // AstrBot 的 run() 是阻塞式启动；这里保持现有 start() 的非阻塞语义。
    run: () => transport.start(),
    start: () => transport.start(),
    stop: () => transport.stop(),
    restart: () => transport.restart(),
    ready: () => transport.ready(),
    state: () => transport.state(),
    status: () => transport.status(),
    on: (fn) => transport.on(fn),
    convert: (raw) => convertMessageEvent(raw, transport.selfId(), { faceName: transport.faces?.nameOf }),
    send: (chatId, segments, opts) => transport.send(chatId, segments, opts),
    sendBySession: (session, segments, opts) => transport.send(session, segments, opts),
    // 事件由 ChannelManager 统一转发；保留别名，方便以后接 AstrBot 式 queue。
    commitEvent: (fn) => transport.on(fn),
    transport,
    ...Object.fromEntries(Object.entries(transport).filter(([key]) => ![
      'platform', 'label', 'caps', 'meta', 'run', 'start', 'stop', 'restart', 'ready',
      'state', 'status', 'on', 'convert', 'send', 'sendBySession', 'commitEvent', 'transport',
    ].includes(key))),
  }
}
