// 向量：找「意思相近」的记忆。只决定相似，不决定记多久。
// 向量存在本机数据库里；算向量要调外部接口（默认 SiliconFlow 上免费的 BAAI/bge-m3）。

/** 存在库里的向量 → 内存里的索引（单位化后点积就是余弦）。 */
export function createVectorIndex(store) {
  let cache = null // id → { model, vec: Float32Array }
  const unit = (arr) => {
    const v = Float32Array.from(arr)
    let n = 0
    for (const x of v) n += x * x
    n = Math.sqrt(n) || 1
    for (let i = 0; i < v.length; i++) v[i] /= n
    return v
  }
  function load() {
    if (cache) return cache
    cache = new Map()
    for (const r of store.prep('SELECT id, model, dim, vec FROM vectors').all()) {
      const b = r.vec
      cache.set(r.id, { model: r.model, vec: unit(new Float32Array(b.buffer, b.byteOffset, r.dim)) })
    }
    return cache
  }
  function put(id, model, vec, textHash = null) {
    store.prep('INSERT INTO vectors (id, model, dim, text_hash, vec) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET model = excluded.model, dim = excluded.dim, text_hash = excluded.text_hash, vec = excluded.vec')
      .run(String(id), String(model), vec.length, textHash, new Uint8Array(new Float32Array(vec).buffer))
    load().set(String(id), { model: String(model), vec: unit(vec) })
  }
  function remove(id) {
    store.prep('DELETE FROM vectors WHERE id = ?').run(String(id))
    load().delete(String(id))
  }
  function has(id, model) {
    const v = load().get(String(id))
    return Boolean(v && (!model || v.model === model))
  }
  /** 和 query 最像的若干条（只比同一个模型算的）。 */
  function search(query, { model, limit = 50, min = 0, filter } = {}) {
    if (!query || !query.length) return []
    const q = unit(query)
    const out = []
    for (const [id, v] of load()) {
      if (model && v.model !== model) continue
      if (v.vec.length !== q.length) continue
      if (filter && !filter(id)) continue
      let dot = 0
      for (let i = 0; i < q.length; i++) dot += q[i] * v.vec[i]
      if (dot >= min) out.push({ id, sim: dot })
    }
    out.sort((a, b) => b.sim - a.sim)
    return out.slice(0, limit)
  }
  /** 两条记忆之间的相似度；有一条没向量返回 0。 */
  function similarity(a, b) {
    const x = load().get(String(a))
    const y = load().get(String(b))
    if (!x || !y || x.vec.length !== y.vec.length || x.model !== y.model) return 0
    let dot = 0
    for (let i = 0; i < x.vec.length; i++) dot += x.vec[i] * y.vec[i]
    return dot
  }
  return { put, remove, has, search, similarity, reset: () => { cache = null } }
}

/**
 * OpenAI 兼容的 /embeddings 接口。
 * @param {{ url: () => string, model: () => string, key: () => string, fetch?: typeof fetch, timeoutMs?: number }} o
 */

// ---------- 向量进度（B35 从 vector-state.js 合并进来） ----------
export function createVectorState({ store, getEmbedModel, isEmbedConnected, isEmbeddingReady }) {
  const canEmbed = () => Boolean(isEmbedConnected()) && (isEmbeddingReady?.() ?? true)

  function staleVectorIds(limit = 500) {
    return store.prep(`SELECT e.id FROM episodes e LEFT JOIN vectors v ON v.id = e.id
      WHERE e.status = 'live' AND (v.id IS NULL OR v.model != ?) ORDER BY e.at DESC LIMIT ?`).all(getEmbedModel(), limit).map((r) => r.id)
  }

  function vectorProgress() {
    const model = getEmbedModel()
    const total = store.prep("SELECT COUNT(*) AS n FROM episodes WHERE status = 'live'").get().n
    const done = store.prep("SELECT COUNT(*) AS n FROM episodes e JOIN vectors v ON v.id = e.id WHERE e.status = 'live' AND v.model = ?").get(model).n
    return { done, total, model }
  }

  return { staleVectorIds, vectorProgress, canEmbed }
}
