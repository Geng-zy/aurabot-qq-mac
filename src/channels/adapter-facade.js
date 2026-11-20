// 统一的 PlatformAdapter 外形，参考 AstrBot：
// meta / run / convert / sendBySession / commitEvent + 原有 Channel 生命周期。
// 各平台只负责 transport（收原始事件、发平台消息），不再各自实现一套宿主接口。
const WRAPPER_KEYS = new Set([
  'platform', 'label', 'caps', 'meta', 'run', 'start', 'stop', 'restart', 'ready', 'state',
  'status', 'on', 'convert', 'send', 'sendBySession', 'commitEvent', 'transport',
])

export function sessionChatId(session, platform) {
  if (typeof session === 'string') return session
  if (session?.chatId) return String(session.chatId)
  if (session?.kind === 'group' && session.groupId) return `${platform}:group:${session.groupId}`
  if (session?.kind === 'private' && session.userId) return `${platform}:private:${session.userId}`
  return ''
}

export function createPlatformAdapter({ platform, label, transport, sessionToChatId = sessionChatId }) {
  if (!transport) throw new Error(`${platform} 适配器缺少 transport`)
  const adapter = {
    platform,
    label,
    caps: transport.caps || {},
    meta: () => transport.meta?.() || ({ id: platform, label, caps: transport.caps || {} }),
    run: () => transport.start(),
    start: () => transport.start(),
    stop: () => transport.stop(),
    restart: () => transport.restart?.(),
    ready: () => transport.ready(),
    state: () => transport.state?.(),
    status: () => transport.status?.(),
    on: (fn) => transport.on(fn),
    convert: (raw) => transport.convert(raw),
    send: (chatId, segments, opts) => transport.send(chatId, segments, opts),
    sendBySession: (session, segments, opts) => transport.send(sessionToChatId(session, platform), segments, opts),
    commitEvent: (fn) => transport.on(fn),
    transport,
  }
  for (const [key, value] of Object.entries(transport)) {
    if (!WRAPPER_KEYS.has(key)) adapter[key] = value
  }
  return adapter
}
