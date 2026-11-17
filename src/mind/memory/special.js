// 生日/纪念日/认识周年，以及到点约定的投递状态。
export function createSpecial({ store, now, deps, DAY, visibleIn, localParts, nameOf, row, save }) {
  function specialDays({ within = 0, audienceWindow } = {}) {
    const tz = deps.tz()
    const at = now()
    const md = (m, d) => `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const ahead = []
    for (let i = 0; i <= within; i++) {
      const p = localParts(at + i * DAY, tz)
      ahead.push({ key: md(p.month, p.day), year: p.year, i })
    }
    const isOwner = (id) => Boolean(deps.isOwner?.(id))
    const out = []
    const seen = new Set()
    const label = (i) => (i === 0 ? '今天' : i === 1 ? '明天' : i === 2 ? '后天' : `${i} 天后`)
    for (const r of store.prep("SELECT * FROM episodes WHERE kind = 'date' AND status IN ('live', 'archived') ORDER BY at DESC LIMIT 300").all()) {
      const e = { ...r, data: JSON.parse(r.json) }
      if (!visibleIn(e, audienceWindow)) continue
      const day = ahead.find((a) => a.key === e.data.yearly)
      if (!day) continue
      const key = (e.data.about || '') + '|' + e.data.yearly
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ text: `${label(day.i)}：${e.gist}`, about: e.data.about || '', inDays: day.i, owner: isOwner(e.data.about), self: e.data.about === 'self', kind: 'date' })
    }
    for (const p of deps.firstMet?.() || []) {
      if (!p.firstSeen) continue
      const f = localParts(p.firstSeen, tz)
      const day = ahead.find((a) => a.key === md(f.month, f.day) && a.year > f.year)
      if (!day) continue
      out.push({ text: `${label(day.i)}：和${p.owner ? '管理员' : nameOf(p.id)}认识满 ${day.year - f.year} 年`, about: p.id, inDays: day.i, owner: Boolean(p.owner), self: false, kind: 'met' })
    }
    return out.sort((a, b) => a.inDays - b.inDays)
  }

  function dueNow({ eligible = () => true } = {}) {
    const at = now()
    return store.prep("SELECT * FROM episodes WHERE kind = 'intention' AND status = 'live' AND json_extract(json, '$.done') IS NULL AND json_extract(json, '$.nudged') IS NULL AND json_extract(json, '$.reminderUncertain') IS NULL AND json_extract(json, '$.reminderSending') IS NULL AND json_extract(json, '$.due') BETWEEN ? AND ? ORDER BY json_extract(json, '$.due'), id")
      .all(at - 30 * 60000, at).map((r) => ({ ...r, data: JSON.parse(r.json) })).filter(eligible).slice(0, 5)
  }

  function setReminderDelivery(id, status) {
    return store.tx(() => {
      const e = row(id)
      if (!e || e.data.done) return false
      if (status === 'sending') {
        if (e.data.reminderSending != null || e.data.nudged != null || e.data.reminderUncertain != null) return false
        e.data.reminderSending = now()
      } else {
        delete e.data.reminderSending
        if (status === 'sent') e.data.nudged = now()
        if (status === 'uncertain') e.data.reminderUncertain = now()
      }
      save(e)
      return true
    })
  }

  return { specialDays, dueNow, setReminderDelivery }
}
