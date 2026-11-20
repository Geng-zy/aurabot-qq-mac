// 面板查询：列表、来源统计、关联、展开一条回忆。
export function createPanel({ store, now, place, rOf, levelOf, levels, shareSourceAllowed, visibleIn, visibleForRecall, render, visibleOriginalLines, row }) {
  // ---------- 给面板看 ----------
  /** 面板：按状态、种类、关键字列出（关键字在大意、细节和原始记录里找）。 */
  function list({ status = 'live', limit = 100, offset = 0, kind, q = '' } = {}) {
    const at = now()
    const like = (x) => '%' + String(x).replace(/[%_\\]/g, (c) => '\\' + c) + '%'
    const where = ['status = ?', "coalesce(json_extract(json, '$.shareRevoked'), 0) = 0"]
    const args = [status]
    if (kind) { where.push('kind = ?'); args.push(String(kind)) }
    if (q) { where.push("(gist LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\' OR json LIKE ? ESCAPE '\\')"); args.push(like(q), like(q), like(q)) }
    const rows = store.prep(`SELECT * FROM episodes WHERE ${where.join(' AND ')} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset)
    return rows.map((r) => {
      const e = { ...r, data: JSON.parse(r.json) }
      const rv = rOf(e, at)
      return { id: e.id, at: e.at, window: e.window, platform: place(e.window).platform || '', gist: e.gist, detail: e.detail, kind: e.data.kind, r: rv, level: levelOf(rv, 1, levels()), stability: e.stability, original: e.data.original || null, emotion: e.data.emotion || null, outdated: e.data.outdated || null, toldTo: e.data.toldTo || null, privateOnly: e.data.privateOnly === true, canShare: Boolean(shareSourceAllowed(e)), shareWith: e.data.shareWith || null }
    })
  }
  function sourceCounts(status) {
    const result = new Map()
    const rows = store.prep('SELECT window, COUNT(*) AS n FROM episodes WHERE status = ? GROUP BY window').all(status)
    for (const r of rows) {
      const platform = place(r.window).platform || ''
      result.set(platform, (result.get(platform) || 0) + r.n)
    }
    return [...result].map(([platform, count]) => ({ platform, count })).sort((a, b) => b.count - a.count)
  }

  function related(id, { canRead = () => true } = {}) {
    const root = row(id)
    if (!root || !['live', 'archived'].includes(root.status) || root.data.needsRecompute) return []
    const rows = store.prep(`SELECT b AS id, kind, weight FROM links WHERE a = ?
      UNION ALL SELECT a AS id, kind, weight FROM links WHERE b = ? ORDER BY weight DESC, id LIMIT 12`).all(id, id)
    const found = new Map()
    for (const edge of rows) if (!found.has(edge.id)) found.set(edge.id, edge.kind)
    for (const key of ['derivedFrom', 'from']) {
      if (!Array.isArray(root.data[key])) continue
      for (const source of root.data[key].slice(0, 12)) if (typeof source === 'string') found.set(source, 'source')
    }
    return [...found].flatMap(([key, relation]) => {
      if (key === id) return []
      const other = row(key)
      if (!other || !['live', 'archived'].includes(other.status) || other.data.needsRecompute || !canRead(other)) return []
      return [{ id: key, relation, at: other.at, gist: other.gist, kind: other.data.kind, platform: place(other.window).platform || '' }]
    }).slice(0, 12)
  }

  /** 只展开一跳。原始经历和每个相邻经历都按实际接收会话核对可见性。 */
  function recallMore(id, { audienceWindow = '' } = {}) {
    const entry = row(id)
    const canRecall = (e) => e && e.status === 'live' && visibleIn(e, audienceWindow)
    if (!canRecall(entry)) return null
    const level = levelOf(rOf(entry), 1, levels())
    if (!level || (level === 'tip' && entry.data.kind !== 'pending')) return null
    const neighbors = related(entry.id, { canRead: canRecall }).flatMap(({ id }) => {
      const e = row(id)
      if (!canRecall(e)) return []
      const clarity = levelOf(rOf(e), 1, levels())
      return !clarity || clarity === 'tip' ? [] : [{ id, at: e.at, text: render(e, clarity, true).slice(0, 180) }]
    }).slice(0, 4)
    const evidence = visibleOriginalLines(entry, audienceWindow)
      .slice(0, 10).map(({ at, who, dir, text }) => ({ at, who, dir, text: text.slice(0, 200) }))
    return { id: entry.id, at: entry.at, text: render(entry, level).slice(0, 600), related: neighbors, evidence }
  }

  function counts() {
    return Object.fromEntries(store.prep('SELECT status, COUNT(*) AS n FROM episodes GROUP BY status').all().map((r) => [r.status, r.n]))
  }


  return { list, sourceCounts, related, recallMore, counts }
}
