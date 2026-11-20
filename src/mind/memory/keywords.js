// 线索词命中：全文索引/字面查找，并按词的分量归一。
import { keywords } from './words.js'

export function createKeywordHits({ store, visibleIn, visibleForRecall, row }) {
  const ftsQ = () => store.prep("SELECT e.id FROM episodes_fts f JOIN episodes e ON e.rowid = f.rowid WHERE episodes_fts MATCH ? AND e.status = 'live' LIMIT 30")
  const likeQ = () => store.prep("SELECT id FROM episodes WHERE status = 'live' AND (gist LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\') ORDER BY at DESC LIMIT 30")
  return function keywordHits(text, audienceWindow) {
    const got = new Map()
    const found = []
    for (const { w, weight } of keywords(text)) {
      let ids = []
      try {
        ids = [...w].length >= 3
          ? ftsQ().all('"' + w.replace(/"/g, '""') + '"').map((r) => r.id)
          : likeQ().all(...Array(2).fill('%' + w.replace(/[%_\\]/g, (c) => '\\' + c) + '%')).map((r) => r.id)
      } catch {}
      if (audienceWindow !== undefined) ids = ids.filter((id) => visibleForRecall(row(id)))
      found.push({ ids: [...new Set(ids)], weight: ids.length >= 30 ? weight * 0.25 : weight })
    }
    const hit = found.filter((t) => t.ids.length)
    if (!hit.some((t) => t.ids.length < 30)) return got
    const total = hit.reduce((n, t) => n + t.weight, 0)
    for (const { ids, weight } of found) for (const id of ids) got.set(id, (got.get(id) || 0) + weight)
    for (const [id, n] of got) got.set(id, Math.min(1, n / Math.min(total, 3)))
    return got
  }
}
