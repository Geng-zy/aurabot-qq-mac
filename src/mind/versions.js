// 版本历史：人格卡 / 自我 / 特质 / 习惯 每一版都存一份，可回看、删除、置顶、按保留数清理。
// 从 mind/index.js 抽出来：这一支只碰 versions 表，另有两个注入：读设置（保留数）与恢复人格卡。

export function createVersions({ store, now, setting, setPersonaCard, getMemory }) {
  function addVersion(kind, data, { by = 'owner', reason = '', pinned = false } = {}) {
    const r = store.prep('INSERT INTO versions (kind, at, by, reason, pinned, json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(kind, now(), by, reason, pinned ? 1 : 0, JSON.stringify(data))
    pruneVersions(kind)
    return Number(r.lastInsertRowid)
  }
  function listVersions(kind, limit = 100, before = Number.MAX_SAFE_INTEGER) {
    return store.prep('SELECT id, kind, at, by, reason, pinned, json FROM versions WHERE kind = ? AND id < ? ORDER BY id DESC LIMIT ?')
      .all(kind, before, limit).map((r) => ({ id: r.id, kind: r.kind, at: r.at, by: r.by, reason: r.reason, pinned: Boolean(r.pinned), data: JSON.parse(r.json) }))
  }
  function deleteVersion(id) {
    return Number(store.prep('DELETE FROM versions WHERE id = ?').run(Number(id)).changes)
  }
  function deleteVersions(kind, { from, through }) {
    if (!['persona', 'self', 'traits', 'habits'].includes(kind) || !Number.isFinite(from) || !Number.isFinite(through) || from >= through) {
      throw new Error('请填写有效的版本类别和日期范围')
    }
    return Number(store.prep(`DELETE FROM versions WHERE kind = ? AND at >= ? AND at < ? AND pinned = 0
      AND id <> (SELECT max(id) FROM versions WHERE kind = ?)`).run(kind, from, through, kind).changes)
  }
  function getVersion(id) {
    const row = store.prep('SELECT id, kind, at, by, reason, pinned, json FROM versions WHERE id = ?').get(Number(id))
    return row ? { id: row.id, kind: row.kind, at: row.at, by: row.by, reason: row.reason, pinned: Boolean(row.pinned), data: JSON.parse(row.json) } : null
  }
  function pinVersion(id, pinned = true) {
    store.prep('UPDATE versions SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, Number(id))
  }
  /** 超过保留数的旧版本自动清理；标为重要的不清，最新一个永远保留。 */
  function pruneVersions(kind) {
    const keep = Math.max(1, Number(setting('memory.versionKeep')) || 50)
    const ids = store.prep('SELECT id FROM versions WHERE kind = ? AND pinned = 0 ORDER BY id DESC').all(kind).map((r) => r.id)
    for (const id of ids.slice(keep)) store.prep('DELETE FROM versions WHERE id = ?').run(id)
  }
  /** 退回到某个人格卡版本（会新存一个版本，写明是退回）。 */
  function restorePersona(id) {
    const row = store.prep("SELECT by, json FROM versions WHERE id = ? AND kind = 'persona'").get(Number(id))
    if (!row) throw new Error('没有这个版本')
    const v = JSON.parse(row.json)
    const publish = ['owner', 'migration'].includes(row.by) && v.published !== false
    return setPersonaCard(v.card, { by: 'owner', reason: `退回到版本 ${id}`, name: v.name, nickname: v.nickname, publish })
  }


  return { addVersion, listVersions, deleteVersion, deleteVersions, getVersion, pinVersion, pruneVersions, restorePersona }
}
