// 睡前的「回顾」：给这一天 / 这一周 / 这一个月各写一段总结。
// 从 memory/sleep.js 抽出来：那边管整理流程（回放、再巩固、淡化、归档、做梦），
// 这边只做一件事——把一段时间里的事写成一段第一人称回顾；写过的、没什么事的不写。
//
// 依赖全部注入（store / mem / now / tz / parseJson / dayKey / parsePeriod / sourceUnchanged / name）。

const DAY = 86400000

export function createReview({ store, mem, now, tz, parseJson, dayKey, parsePeriod, sourceUnchanged, name }) {
  const REVIEW_SYSTEM = (what) => `你是${name()}，睡前回想${what}。下面是这段时间里你记得的事（按时间）。
用第一人称、口语写一段回顾：发生了哪些要紧的事、和谁、你的心情怎么变的。只用给你的内容，不要编，不要加没有的人和事；琐碎的略过。
${what === '这一天' ? '一百五十字以内' : '两百五十字以内'}。只输出 JSON：{"summary":""}`
  const REVIEWS = {
    day: { kind: 'day-summary', what: '这一天', from: null },
    week: { kind: 'week-summary', what: '这一周', from: 'day-summary' },
    month: { kind: 'month-summary', what: '这个月', from: 'week-summary' },
  }
  const reviewed = (kind, key) => Boolean(store.prep("SELECT 1 FROM episodes WHERE kind = ? AND json_extract(json, '$.day') = ?").get(kind, key)) || Boolean(store.get(`review.${kind}.${key}`))
  /** 给一段时间写回顾（写过、或这段时间没什么事就不写）。返回新记的 id。 */
  async function reviewPeriod(type, key, range) {
    const R = REVIEWS[type]
    if (reviewed(R.kind, key)) return null
    // 周、月：优先用更小一级的回顾，不够再用经历本身
    let rows = []
    if (R.from) rows = store.prep('SELECT * FROM episodes WHERE kind = ? AND at >= ? AND at < ? ORDER BY at').all(R.from === 'week-summary' ? 'week-summary' : 'day-summary', range.start, range.end)
    if (R.from === 'week-summary' && rows.length < 2) rows = store.prep("SELECT * FROM episodes WHERE kind = 'day-summary' AND at >= ? AND at < ? ORDER BY at").all(range.start, range.end)
    if (rows.length < 2) {
      rows = store.prep("SELECT * FROM episodes WHERE status IN ('live', 'archived') AND at >= ? AND at < ? AND coalesce(kind, '') NOT IN ('dream', 'public-note', 'day-summary', 'week-summary', 'month-summary') ORDER BY at LIMIT 400").all(range.start, range.end)
        .map((r) => ({ ...r, data: JSON.parse(r.json) }))
        .sort((a, b) => (b.data.importance || 0) + (b.data.emotion?.intensity || 0) - (a.data.importance || 0) - (a.data.emotion?.intensity || 0))
        .slice(0, 80).sort((a, b) => a.at - b.at)
    }
    if (rows.length < 2) { store.set(`review.${R.kind}.${key}`, { at: now(), empty: true }); return null }
    // 提示词和可见性检查使用同一批来源。
    rows = rows.slice(-100)
    const text = rows.map((r) => `- ${dayKey(r.at, tz())} ${r.gist}`).join('\n')
    const out = parseJson(await mem.ask('review', REVIEW_SYSTEM(R.what), text, 900))
    const summary = String(out?.summary || '').trim()
    if (!summary) return null
    const imp = Math.min(1, 0.6 + 0.1 * Math.log2(rows.length))
    return store.tx(() => {
      if (reviewed(R.kind, key) || !rows.every(sourceUnchanged)) return null
      return mem.insert({ at: range.end - 1, window: '', gist: summary.slice(0, 600), kind: R.kind, importance: imp, speaker: 'self', attention: 1, extra: { day: key, period: { start: range.start, end: range.end }, from: rows.map((r) => r.id) } })
    })
  }
  /** 睡觉时：没写过回顾的前几天、上一周、上个月补上（今天还没过完，不写）。 */
  async function review() {
    const zone = tz()
    const at = now()
    const made = []
    for (const job of mem.takeJobs('review', 12)) {
      const { type, key, range } = job.data
      if (!REVIEWS[type] || !range || !key) { mem.doneJob(job.id); continue }
      const id = await reviewPeriod(type, key, range)
      if (id) made.push(id)
      if (id || reviewed(REVIEWS[type].kind, key)) mem.doneJob(job.id)
    }
    for (let i = 3; i >= 1; i--) {
      const day = dayKey(at - i * DAY, zone)
      const range = parsePeriod(day, at, zone)
      if (range) { const id = await reviewPeriod('day', day, range); if (id) made.push(id) }
    }
    const week = parsePeriod('上周', at, zone)
    if (week) { const id = await reviewPeriod('week', dayKey(week.start, zone), week); if (id) made.push(id) }
    const month = parsePeriod('上个月', at, zone)
    if (month) { const id = await reviewPeriod('month', dayKey(month.start, zone).slice(0, 7), month); if (id) made.push(id) }
    return made.length
  }

  return { review, reviewPeriod }
}
