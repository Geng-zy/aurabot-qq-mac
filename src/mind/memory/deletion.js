// 删除、重算、加强和私密标记。
export function createDeletion({ store, now, S, deps, vectors, row, save, queueJob, touchAudience }) {
  // ---------- 删除和重算 ----------
  /** 管理员删一条：连同向量、联系一起删，记进删除记录；由它整理出来的「知道的事」重算。 */
  function deleteEpisode(id, { record = true } = {}) {
    const e = row(id)
    if (!e) return false
    store.tx(() => { removeOne(e, record); touchAudience() })
    return true
  }
  function removeOne(e, record) {
    store.prep('DELETE FROM episodes WHERE id = ?').run(e.id)
    vectors.remove(e.id)
    store.prep('DELETE FROM links WHERE a = ? OR b = ?').run(e.id, e.id)
    store.prep('DELETE FROM jobs WHERE ref = ?').run(e.id)
    if (record) deps.recordDeletion(e.id, 'episode')
    deps.onDeleted?.(e)
    // 由它整理出来的知道的事：来源都没了就一起删，还有别的来源就排进重算
    for (const r of store.prep("SELECT * FROM episodes WHERE instr(json, ?) > 0").all(JSON.stringify(e.id))) {
      const f = row(r.id)
      if (!f) continue
      if (f.data.publicSource === e.id) { removeOne(f, record); continue }
      if (Array.isArray(f.data.from) && f.data.from.includes(e.id)) {
        if (f.data.period && f.data.day) {
          queueJob('review', f.data.kind + ':' + f.data.day, { type: f.data.kind.split('-')[0], key: f.data.day, range: f.data.period })
        }
        if (row(f.id)) removeOne(f, record)
        continue
      }
      const derived = Array.isArray(f.data.derivedFrom) && f.data.derivedFrom.includes(e.id)
      const inPrompt = Array.isArray(f.data.promptSources) && f.data.promptSources.includes(e.id)
      const outdated = f.data.outdated?.by === e.id
      const rewritten = f.data.rewrittenWith === e.id
      if (f.data.kind === 'semantic' && (derived || inPrompt)) {
        const left = (f.data.derivedFrom || []).filter((id) => id !== e.id && row(id))
        if (!left.length) removeOne(f, record)
        else {
          f.data.derivedFrom = left
          f.data.needsRecompute = true
          save(f)
          queueJob('recompute', f.id)
        }
        continue
      }
      if (!outdated && !rewritten && !inPrompt) continue
      if (outdated || inPrompt) {
        delete f.data.outdated
        delete f.data.promptSources
      }
      if (rewritten && f.data.original) {
        f.gist = f.data.original.gist
        f.detail = f.data.original.detail
        delete f.data.rewrittenWith
        delete f.data.original
        vectors.remove(f.id)
        queueJob('embed', f.id)
      }
      save(f)
    }
  }
  /** 从备份恢复后，把恢复前删掉的再删一遍。 */
  function applyDeletions(list) {
    let n = 0
    store.tx(() => {
      for (const d of list || []) {
        if (d.kind !== 'episode') continue
        const e = row(d.id)
        if (e) { removeOne(e, false); n++ }
        store.prep('INSERT OR REPLACE INTO deletions (id, kind, at) VALUES (?, ?, ?)').run(String(d.id), 'episode', Number(d.at) || now())
      }
    })
    return n
  }
  /** 管理员加强一条（归档的也会回来）。 */
  function boost(id, factor = 2) {
    const e = row(id)
    if (!e) return false
    e.stability = Math.max(e.stability * factor, Number(S('baseStability')) * 2)
    e.last_recall = now()
    if (e.status === 'archived') e.status = 'live'
    save(e)
    return true
  }

  function setPrivateOnly(id, enabled, { record = true } = {}) {
    const e = row(id)
    if (!e) return false
    if ((e.data.privateOnly === true) === (enabled === true)) return true
    if (record) deps.recordPrivacy?.(e.id, enabled === true)
    e.data.privateOnly = enabled === true
    store.tx(() => { save(e); touchAudience() })
    return true
  }


  return { deleteEpisode, applyDeletions, boost, setPrivateOnly }
}
