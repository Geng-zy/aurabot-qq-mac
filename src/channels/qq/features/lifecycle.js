// QQ 适配器生命周期：停止定时器、清监听、停 transport。
export function createLifecycle({ gw, inbox, listeners, getFlushTimer, setDisposed }) {
  return {
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
