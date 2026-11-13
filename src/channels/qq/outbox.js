// 网关未就绪时的本地发送队列：只在“确定没发出去”时入队，连接后补发。
// 不处理超时/不确定的调用，避免重复发消息。

import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { dataDir, ensureDir } from '../../core/store.js'

const DEFAULT_TTL = 5 * 60_000
const DEFAULT_MAX_ITEMS = 100
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024

const ttlForKind = (kind) => {
  if (kind === 'proactive') return 60_000
  if (kind === 'diary' || kind === 'qzone') return 10 * 60_000
  return DEFAULT_TTL
}

export function createOutbox ({ file = dataDir('outbox', 'queue.json'), log, now = Date.now, maxItems = DEFAULT_MAX_ITEMS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  let items = []
  let loaded = false
  let flushing = null

  function load () {
    if (loaded) return
    loaded = true
    try {
      if (!existsSync(file)) return
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      items = Array.isArray(parsed) ? parsed.filter((x) => x && x.id && x.action) : []
    } catch (error) {
      log?.warn?.('发送队列读不出来，已忽略旧文件：', error.message)
      items = []
    }
  }

  function save (next) {
    try {
      ensureDir(dirname(file))
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(next), { encoding: 'utf8', mode: 0o600 })
      try { chmodSync(tmp, 0o600) } catch (error) {}
      renameSync(tmp, file)
      items = next
      return true
    } catch (error) {
      log?.warn?.('发送队列落盘失败：', error.message)
      return false
    }
  }

  function prune (at = now()) {
    load()
    const next = items.filter((x) => Number(x.expiresAt) > at)
    if (items.length !== next.length) save(next)
  }

  function list () {
    prune()
    return items.filter((x) => x.expiresAt > now()).map((x) => structuredClone(x))
  }

  /**
   * 加入一条待发送消息。只接受 send_private_msg / send_group_msg；
   * 图片 base64 等过大内容不入队，避免队列文件失控。
   */
  function add ({ action, params, chatId = '', note = '', kind = 'reply', ttlMs, privacyRevision = '' } = {}) {
    if (action !== 'send_private_msg' && action !== 'send_group_msg') {
      return { ok: false, message: '不是可补发的消息类型' }
    }
    // 媒体消息（语音 / 图片 / 文件）不落盘补发：体积大，且可能已经过了合适的时机。
    const segs = Array.isArray(params?.message) ? params.message : []
    if (segs.some((seg) => !seg || !['text', 'at', 'reply'].includes(seg.type))) {
      return { ok: false, message: '媒体消息不放进补发队列' }
    }
    load()
    const text = JSON.stringify(params || {})
    if (Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, message: '消息太大，不放进补发队列' }
    prune()
    const at = now()
    const item = {
      id: randomUUID(),
      action,
      params: JSON.parse(text),
      chatId: String(chatId || ''),
      note: String(note || '').slice(0, 120),
      kind,
      ...(privacyRevision ? { privacyRevision } : {}),
      createdAt: at,
      expiresAt: at + Math.max(10_000, Number(ttlMs) || ttlForKind(kind)),
      attempts: 0,
      nextAt: at,
    }
    const full = items.length >= maxItems
    if (!save([...(full ? items.slice(1) : items), item])) return { ok: false, message: '发送队列未能保存' }
    if (full) log?.warn?.(`发送队列已满（${maxItems}），丢弃最旧一条`)
    return { ok: true, id: item.id, expiresAt: item.expiresAt }
  }

  function remove (id) {
    load()
    const next = items.filter((x) => x.id !== id)
    return items.length !== next.length && save(next)
  }

  /**
   * 连接后按顺序补发。call(action, params, { retries: 0 }) 由调用方提供。
   * 仅 transport 失败保留；uncertain / 业务错误丢弃，避免重复发或永远堵住队列。
   */
  function flush (call, { onSent, canSend, isReady = () => true } = {}) {
    if (!flushing) flushing = Promise.resolve().then(() => drain(call, onSent, canSend, isReady)).finally(() => { flushing = null })
    return flushing
  }

  async function drain (call, onSent, canSend, isReady) {
    load()
    let sent = 0
    let dropped = 0
    for (const item of list()) {
      if (!isReady()) break
      if (!items.some(({ id }) => id === item.id)) continue
      const at = now()
      if (item.expiresAt <= at) {
        if (!remove(item.id)) break
        dropped++
        log?.warn?.(`补发过期，丢弃：${item.note || item.chatId || item.action}`)
        continue
      }
      if (Number(item.nextAt) > at) break
      if (canSend && !canSend(item)) {
        if (!remove(item.id)) break
        dropped++
        continue
      }
      // 先落盘移出队列。若网关已经收到而进程在回执前退出，重启也不会重发。
      if (!remove(item.id)) break
      try {
        const result = await call(item.action, item.params, { retries: 0, timeoutMs: 30_000 })
        sent++
        log?.info?.(`补发成功：${item.note || item.chatId || item.action}`)
        try { onSent?.(item, result) } catch (error) { log?.warn?.('记录补发结果失败：', error.message) }
      } catch (error) {
        if (error?.uncertain) {
          // 可能已经发出去了，宁可少发一次，不能重复。
          dropped++
          log?.warn?.(`补发结果不确定，丢弃避免重复：${item.note || item.chatId || item.action}`)
          continue
        }
        if (!error?.transport) {
          dropped++
          log?.warn?.(`补发失败（非网络）：${error?.message || error}`)
          continue
        }
        item.attempts = Number(item.attempts || 0) + 1
        item.nextAt = at + Math.min(60_000, 2 ** Math.min(item.attempts, 5) * 1000)
        if (items.length < maxItems && save([item, ...items])) log?.warn?.(`补发时网关仍不可用，留队重试：${item.note || item.chatId || item.action}`)
        else dropped++
        break
      }
    }
    return { sent, dropped, left: list().length }
  }

  function status () {
    const current = list()
    return { count: current.length, oldestAt: current.length ? Math.min(...current.map((x) => x.createdAt)) : 0 }
  }

  return { add, list, remove, prune, flush, status }
}
