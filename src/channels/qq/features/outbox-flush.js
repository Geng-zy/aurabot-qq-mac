// 补发队列：连接恢复后按 outbox 的 TTL 重发。用工厂延迟创建，避免在 ready()/channel 初始化前触发 TDZ。
export function createOutboxFlush({ box, call, getConfig, isConnected, isDisposed, getRevision, canReplayDelivery, onSent, log }) {
  return {
    async flush() {
      const revision = getRevision()
      const isReady = () => {
        const config = getConfig()
        return !isDisposed() && revision === getRevision() && isConnected() && config.enabled !== false && !config.debug && !config.dryRun
      }
      if (!box || !isReady()) return
      try {
        const r = await box.flush(call, { isReady, canSend: canReplayDelivery, onSent })
        if (r.sent || r.dropped || r.left) log.info(`补发队列：成功 ${r.sent}，丢弃 ${r.dropped}，剩余 ${r.left}`)
      } catch (error) {
        log.warn('补发队列出错：', error.message)
      }
    },
  }
}
