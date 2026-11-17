// 把人设块搬到系统提示词最前面。
//
// 宿主维护插件（dsh-purge）会在自己的 rewrite 里把注入放到最前，即使 aurabot 的
// persona 是 complete 段也会被排到注入后面。身份锁定虽然还在，但位置太靠后。
//
// 这里用一个只对 aurabot 预设可见的 HTML 注释包住 persona + 规则 + 身份锁定，
// 在模型请求出口（llm/stream）把这一整块搬到 system 文本最前面，再移除标记。
// 不解析、不改写块内文字；找不到标记时原样返回。
export const PERSONA_START = '<!-- AURABOT:PERSONA:START -->'
export const PERSONA_END = '<!-- AURABOT:PERSONA:END -->'

function textOf(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
}

function withText(message, text) {
  const content = message?.content
  if (typeof content === 'string') return { ...message, content: text }
  if (!Array.isArray(content)) return message
  let replaced = false
  const next = content.map((block) => {
    if (replaced || !block || block.type !== 'text' || typeof block.text !== 'string') return block
    replaced = true
    return { ...block, text }
  })
  return { ...message, content: next }
}

/** 找标记块；返回 { block, before, after } 或 null。块内保留原文，去掉标记。 */
export function splitPersonaBlock(text) {
  const src = String(text ?? '')
  const start = src.indexOf(PERSONA_START)
  if (start < 0) return null
  const end = src.indexOf(PERSONA_END, start + PERSONA_START.length)
  if (end < 0) return null
  const block = src.slice(start + PERSONA_START.length, end).trim()
  const before = src.slice(0, start).trim()
  const after = src.slice(end + PERSONA_END.length).trim()
  return { block, before, after }
}

/** 把 persona 块搬到最前；标记总是移除。 */
export function hoistPersonaBlock(text) {
  const parts = splitPersonaBlock(text)
  if (!parts) return String(text ?? '')
  return [parts.block, parts.before, parts.after].filter(Boolean).join('\n\n')
}

/**
 * 改写一次 llm/stream 请求：只处理带标记的 system 消息。
 * options 是 deepFreeze 的，整体浅拷贝 + 只替换 system 消息。
 */
export function rewriteRequestPersona(options) {
  if (!options || !Array.isArray(options.messages)) return options
  const messages = options.messages
  const systemIndexes = []
  for (let i = 0; i < messages.length; i += 1) if (messages[i]?.role === 'system') systemIndexes.push(i)
  if (!systemIndexes.length) return options
  let block = ''
  let changed = false
  const next = messages.slice()
  for (const index of systemIndexes) {
    const text = textOf(messages[index])
    const parts = splitPersonaBlock(text)
    if (!parts) continue
    if (!block) block = parts.block
    const cleaned = [parts.before, parts.after].filter(Boolean).join('\n\n')
    next[index] = withText(messages[index], cleaned)
    changed = true
  }
  if (!changed || !block) return options
  const first = systemIndexes[0]
  const firstText = textOf(next[first])
  next[first] = withText(next[first], firstText ? `${block}\n\n${firstText}` : block)
  return { ...options, messages: next }
}

export function installPersonaHoist(ctx, { llm, isAurabotRequest, log } = {}) {
  if (!ctx) return () => {}
  const apply = (options) => {
    try {
      const ok = typeof isAurabotRequest === 'function' ? isAurabotRequest(options) : true
      if (!ok) return options
      return rewriteRequestPersona(options)
    } catch (error) {
      log?.debug?.('人设前置失败：', error.message)
      return options
    }
  }

  // 最终落点：包住每个 provider adapter 的请求入口。llm/stream 的 next() 不转发参数，
  // 其他插件在监听里重建的 options 会在 waterfall 里丢掉；adapter 拿到的是最终请求体，
  // 这里改写不受监听顺序影响。只改 system 文本，工具和其他字段原样保留。
  const restores = []
  const wrapped = new WeakSet()
  const wrapAdapter = (adapter) => {
    if (!adapter || wrapped.has(adapter)) return false
    wrapped.add(adapter)
    const restore = []
    try {
      const originalPrepare = adapter.prepareCall
      if (typeof originalPrepare === 'function') {
        adapter.prepareCall = async function patchedPrepare(provider, model, signal) {
          const call = await originalPrepare.call(this, provider, model, signal)
          if (!call || typeof call.stream !== 'function') return call
          const originalStream = call.stream
          return {
            ...call,
            stream(options, ...rest) { return originalStream.call(call, apply(options), ...rest) },
          }
        }
        restore.push(() => { adapter.prepareCall = originalPrepare })
      }
      const originalStream = adapter.stream
      if (typeof originalStream === 'function') {
        adapter.stream = function patchedStream(options, ...rest) {
          return originalStream.call(this, apply(options), ...rest)
        }
        restore.push(() => { adapter.stream = originalStream })
      }
    } catch (error) {
      log?.debug?.('包 adapter 失败：', error.message)
      return false
    }
    restores.push(() => { for (const fn of restore) { try { fn() } catch (error) { /* ignore */ } } })
    return true
  }

  const service = llm || (typeof ctx.get === 'function' ? ctx.get('llm') : null) || ctx.llm
  const adapters = service?.adapters
  if (adapters instanceof Map) {
    for (const entry of adapters.values()) wrapAdapter(entry?.adapter)
  }

  let offAdapters = null
  try {
    offAdapters = ctx.on('llm/adapters-updated', () => {
      try {
        if (adapters instanceof Map) for (const entry of adapters.values()) wrapAdapter(entry?.adapter)
      } catch (error) { /* ignore */ }
    })
  } catch (error) { /* ignore */ }

  return () => {
    try { if (typeof offAdapters === 'function') offAdapters() } catch (error) { /* ignore */ }
    for (const restore of restores) restore()
  }
}
