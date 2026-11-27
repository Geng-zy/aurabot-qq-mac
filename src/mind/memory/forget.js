// 睡前的「淡化与归档」：情绪变淡一点、想不起来的归档（数据不删，面板里看得到）。
// 从 memory/sleep.js 抽出来：这两个动作只碰已经存着的经历，与回放/做梦无关。

const DAY = 86400000

export function createForget({ store, mem, now, setting }) {
  const S = (k) => setting('memory.' + k)
  const clamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0))

  function soften(since) {
    const k = Number(setting('emotion.sleepSoften')) || 0
    if (k <= 0) return 0
    let n = 0
    store.tx(() => {
      for (const r of store.prep("SELECT * FROM episodes WHERE at >= ? AND json LIKE '%\"emotion\":{%'").all(since)) {
        const e = { ...r, data: JSON.parse(r.json) }
        if (!e.data.emotion || e.data.softened) continue
        e.data.emotion.intensity = clamp01(e.data.emotion.intensity * (1 - k))
        e.data.softened = true
        mem.save(e)
        n++
      }
    })
    return n
  }

  /** 想不起来的归档（数据不删，管理员在面板里看得到，加强一下就回来）。 */
  function archive() {
    const tip = Number(S('levelTip'))
    let n = 0
    const at = now()
    store.tx(() => {
      for (const r of store.prep("SELECT * FROM episodes WHERE status = 'live'").all()) {
        const e = { ...r, data: JSON.parse(r.json) }
        // 还没到时间的约定不归档；没说时间、很久没想起的会和别的事一样慢慢淡忘
        if (e.data.kind === 'intention' && !e.data.done && e.data.due && e.data.due > at - 3 * DAY) continue
        if (mem.rOf(e, at) < tip) { e.status = 'archived'; mem.save(e); n++ }
      }
    })
    return n
  }


  return { soften, archive }
}
