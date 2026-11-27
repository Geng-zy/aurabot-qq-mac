// 批量导入：把旧数据 / 别的系统搬过来 —— 整批一个事务、同一个 tag 只导一次、重复 id 自动跳过。
// 从 mind/index.js 抽出来：那边是心智各层的装配与对外接口，本文件只碰库与几个小工具。

export function createImport({ store, person, savePerson, now, log = { debug() {}, info() {}, warn() {} } }) {
  /**
   * 一次性导入一批数据，整批在一个事务里，失败整体回滚。
   * 同一个 tag 只导一次（再调直接返回上次的结果）；每条都有稳定 id，重复的自动跳过。
   * @param {string} tag 这批数据的名字，例如 'aurabot-legacy-v1'
   * @param {{
   *   perception?: Array<{ window: string, who: string, dir?: 'in'|'out', name?: string, text: string, at: number, msgId: string }>,
   *   episodes?: Array<{ id: string, at: number, window?: string, gist: string, detail?: string, strength?: number, stability?: number, lastRecall?: number, status?: string, data?: object }>,
   *   people?: Array<{ id: string, name?: string, data?: object }>,
   *   vectors?: Array<{ id: string, model: string, vec: number[], textHash?: string }>,
   *   notes?: Record<string, any>,
   * }} bundle
   */
  function importBatch(tag, bundle = {}) {
    const doneKey = 'import.' + tag
    const done = store.get(doneKey)
    if (done) return { ...done, skipped: true }
    const counts = store.tx(() => {
      const c = { perception: 0, episodes: 0, people: 0, vectors: 0, notes: 0 }
      const pIns = store.prep('INSERT OR IGNORE INTO perception (at, window, who, dir, text, msg_id, json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      for (const m of bundle.perception || []) {
        if (!m.window || !m.msgId || !String(m.text || '').trim()) continue
        const r = pIns.run(Number(m.at) || 0, String(m.window), String(m.who || ''), m.dir === 'out' ? 'out' : 'in', String(m.text), String(m.msgId), JSON.stringify({ name: m.name || '', source: tag }))
        c.perception += r.changes
      }
      const eIns = store.prep('INSERT OR IGNORE INTO episodes (id, at, window, gist, detail, strength, stability, last_recall, status, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      for (const e of bundle.episodes || []) {
        if (!e.id || !String(e.gist || '').trim()) continue
        const strength = Math.min(1, Math.max(0, Number(e.strength ?? 0.5)))
        const stability = Math.max(0.1, Number(e.stability ?? 1))
        const r = eIns.run(String(e.id), Number(e.at) || 0, e.window ? String(e.window) : null, String(e.gist), e.detail ? String(e.detail) : null, strength, stability, e.lastRecall ? Number(e.lastRecall) : null, String(e.status || 'live'), JSON.stringify({ ...(e.data || {}), source: tag }))
        c.episodes += r.changes
      }
      for (const p of bundle.people || []) {
        if (!p.id) continue
        const key = String(p.id)
        const cur = person(key) || { id: key, name: '', aliases: [], firstSeen: now(), lastSeen: 0 }
        const n = String(p.name || '').trim()
        if (n && !cur.name) cur.name = n
        else if (n && n !== cur.name && !cur.aliases.includes(n)) cur.aliases.push(n)
        cur.imported = { ...(cur.imported || {}), [tag]: p.data || {} }
        store.prep('INSERT INTO people (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(key, JSON.stringify(cur))
        c.people++
      }
      const vIns = store.prep('INSERT OR IGNORE INTO vectors (id, model, dim, text_hash, vec) VALUES (?, ?, ?, ?, ?)')
      for (const v of bundle.vectors || []) {
        if (!v.id || !Array.isArray(v.vec) || !v.vec.length) continue
        const r = vIns.run(String(v.id), String(v.model || ''), v.vec.length, v.textHash ? String(v.textHash) : null, new Uint8Array(new Float32Array(v.vec).buffer))
        c.vectors += r.changes
      }
      for (const [k, v] of Object.entries(bundle.notes || {})) {
        if (v === undefined || v === null) continue
        store.set(`imported.${tag}.${k}`, v)
        c.notes++
      }
      const out = { at: now(), counts: c }
      store.set(doneKey, out)
      return out
    })
    log.info(`导入 ${tag}：`, JSON.stringify(counts.counts))
    return counts
  }
  /** 导入时存下、后面阶段还要用的原始资料（相处经验、说话方式、心情记录等）。 */
  function imported(tag, key) {
    return store.get(`imported.${tag}.${key}`, null)
  }
  function importDone(tag) {
    return store.get('import.' + tag, null)
  }
  /** 取一条向量（按 episodes.id）。 */
  function vectorOf(id) {
    const r = store.prep('SELECT model, dim, text_hash, vec FROM vectors WHERE id = ?').get(String(id))
    if (!r) return null
    const b = r.vec
    return { model: r.model, dim: r.dim, textHash: r.text_hash, vec: Array.from(new Float32Array(b.buffer, b.byteOffset, r.dim)) }
  }
  function episode(id) {
    const r = store.prep('SELECT * FROM episodes WHERE id = ?').get(String(id))
    return r ? { ...r, data: JSON.parse(r.json) } : null
  }


  return { importBatch, imported, importDone, vectorOf, episode }
}
