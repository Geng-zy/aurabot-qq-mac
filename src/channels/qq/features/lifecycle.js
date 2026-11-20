// QQ 适配器生命周期：启动/停止/看门狗/清理。
export function createLifecycle({ gw, inbox, listeners, getFlushTimer, setDisposed, isDisposed, enabled, getWrongAccount }) {
  let manualStop = false
  return {
    start() { manualStop = false; if (!isDisposed() && enabled()) gw.start() },
    stop() { manualStop = true; gw.stop() },
    restart() { manualStop = false; if (!isDisposed() && enabled()) gw.restart() },
    watch() {
      if (isDisposed()) return
      if (!enabled()) { if (gw.state !== 'stopped') gw.stop(); return }
      // 上次连上的不是机器人号：等管理员点「重新连接」或改设置再连
      if (getWrongAccount() || manualStop) return
      if (gw.state === 'stopped') gw.start()
    },
    resetInbox() { inbox.suspend() },
    dispose() {
      setDisposed(true)
      inbox.flush()
      const timer = getFlushTimer()
      if (timer) clearInterval(timer)
      listeners.clear()
      gw.stop()
    },
  }
}
