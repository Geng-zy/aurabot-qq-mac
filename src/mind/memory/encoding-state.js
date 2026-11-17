// 编码游标、待记窗口和按窗口记到指定位置。
export function createEncodingState({ store, encodeWindow }) {
  function cursorOf(window) {
    return Number(store.get('encode.cursor.' + window, 0)) || 0
  }

  function pendingThrough(window) {
    const latest = store.prep('SELECT MAX(id) AS id FROM perception WHERE window = ?').get(window).id || 0
    return latest > cursorOf(window) ? latest : 0
  }

  async function encodeThrough(window, through, isCurrent) {
    let count = 0
    while (isCurrent() && cursorOf(window) < through) {
      const before = cursorOf(window)
      const result = await encodeWindow(window, { force: true, through })
      count += result.encoded || 0
      if (result.failed || cursorOf(window) <= before) break
    }
    return count
  }

  function pendingWindows() {
    const rows = store.prep('SELECT window, MAX(id) AS last, MAX(at) AS lastAt FROM perception GROUP BY window').all()
    return rows.filter((r) => r.last > cursorOf(r.window)).map((r) => ({ window: r.window, lastAt: r.lastAt }))
  }

  return { cursorOf, pendingThrough, encodeThrough, pendingWindows }
}
