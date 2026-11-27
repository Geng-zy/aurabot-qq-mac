// 补发队列的接线：把 outbox、网关调用与「发出了就广播 delivered」连起来，并按间隔定时重试。
// 从 qq/index.js 抽出来的：定时器、重试阈值、delivered 事件形状都在这里，装配只负责传入依赖。

import { createOutboxFlush } from './outbox-flush.js'

/**
 * @param {object} o
 * @param {object|null} o.box 补发队列（false 表示不要队列）
 * @param {(action: string, params?: object, opts?: object) => Promise<any>} o.call 网关调用（重试由队列自己管）
 * @param {() => object} o.getConfig
 * @param {() => boolean} o.isConnected 只有核对过登录号才算连着
 * @param {() => boolean} o.isDisposed
 * @param {() => number} o.getRevision 连接代次：换连接后不再补发旧队列
 * @param {Function} [o.canReplayDelivery]
 * @param {() => Function|null} [o.getBarrier] 宿主注入：补发前等当前聊天的多气泡发送结束
 * @param {(e: object) => void} o.emit
 * @param {object} o.log
 * @param {number} [o.flushEveryMs] 定时重试间隔（<=0 关闭）
 */
export function createOutboxWiring({ box, call, getConfig, isConnected, isDisposed, getRevision, canReplayDelivery, getBarrier, emit, log, flushEveryMs = 10_000 }) {
  const flusher = createOutboxFlush({
    box,
    call: (action, params, opts) => call(action, params, { ...opts, retries: 0 }),
    getConfig,
    isConnected,
    isDisposed,
    getRevision,
    canReplayDelivery,
    beforeSend: (chatId) => getBarrier?.()?.(chatId),
    onSent: (item, result) => emit({
      type: 'delivered',
      chatId: item.chatId,
      message: item.params.message,
      note: item.note,
      messageId: result?.message_id ?? `outbox:${item.id}`,
      system: item.kind === 'system',
      replyJournal: item.replyJournal,
      replyFeed: item.replyFeed,
    }),
    log,
  })
  const flush = () => flusher.flush()
  const timer = flushEveryMs > 0 && box ? setInterval(() => { flush().catch(() => {}) }, flushEveryMs) : null
  timer?.unref?.()
  return { flush, timer }
}
