// 把所有停下来/等待补记的窗口都记一遍。
export function createEncodePending({ store, now, deps, log, dayKey, encodeWindow, pendingWindows, cursorOf }) {
  return async function encodePending({ force = false } = {}) {
    let n = 0
    for (const w of pendingWindows()) {
      try {
        for (let i = 0; i < 20; i++) {
          const r = await encodeWindow(w.window, { force })
          n += r.encoded || 0
          if (!r.encoded && (r.waiting || r.budget || r.failed || cursorOf(w.window) >= (store.prep('SELECT MAX(id) AS m FROM perception WHERE window = ?').get(w.window).m || 0))) break
        }
      } catch (error) {
        log.warn(`记 ${w.window} 失败：`, error.message)
      }
    }
    for (let i = 0; i < 20; i++) {
      if (store.get('budget.unlimitedDay') !== dayKey(now(), deps.tz())) break
      const recovery = store.get('encode.recovery', [])[0]
      if (!recovery) break
      const r = await encodeWindow(recovery.window, { recovery, through: recovery.through, force: true })
      n += r.encoded || 0
      if (r.budget || r.changed) break
      if (r.failed) continue
      const next = store.get('encode.recovery', [])[0]
      if (next?.window === recovery.window && next.after === recovery.after && next.through === recovery.through) break
    }
    return n
  }
}
