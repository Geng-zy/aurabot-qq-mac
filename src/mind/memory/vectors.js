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
export function createEmbedClient(o) {
  const doFetch = o.fetch || globalThis.fetch
  return async function embed(texts) {
    const list = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t || '').slice(0, 2000))
    if (!list.length) return []
    const base = String(o.url() || '').trim().replace(/\/+$/, '')
    const model = String(o.model() || '').trim()
    if (!base || !model) throw new Error('没设向量模型')
    const u = new URL(base)
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('向量接口地址不对')
    const headers = { 'Content-Type': 'application/json' }
    const key = String(o.key?.() || '')
    // 没密钥时只有本机的服务能用（在线服务没密钥必然被拒，不白等）
    if (!key && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) throw new Error('没填向量接口的密钥')
    if (key) headers.Authorization = `Bearer ${key}`
    const out = []
    for (let i = 0; i < list.length; i += 32) {
      const part = list.slice(i, i + 32)
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), o.timeoutMs || 15000)
      try {
        const r = await doFetch(`${base}/embeddings`, { method: 'POST', headers, body: JSON.stringify({ model, input: part }), signal: ctl.signal, redirect: 'error' })
        if (!r.ok) throw new Error('向量接口返回 ' + r.status)
        const j = await r.json()
        const rows = Array.isArray(j?.data) ? [...j.data] : []
        if (rows.length !== part.length) throw new Error('向量数量不对')
        if (rows.every((x) => Number.isInteger(x?.index))) rows.sort((a, b) => a.index - b.index)
        for (const row of rows) {
          if (!Array.isArray(row?.embedding) || !row.embedding.length || !row.embedding.every(Number.isFinite)) throw new Error('向量无效')
          out.push(row.embedding)
        }
      } finally {
        clearTimeout(timer)
      }
    }
    return out
  }
}
