// 向量/精排的远程客户端：把文本发给嵌入或精排接口，拿回向量或分数。
// 从 memory/vectors.js 拆出来：那边是本地库里的向量与索引进度（SQLite + 内存索引），
// 这边是纯 HTTP 客户端（可注入 fetch 单测），两件事混在一个文件里时测试要一起扛。

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

/**
 * 精排（Reranker）客户端：OpenAI / Jina / SiliconFlow 通用的 /rerank 接口。
 * 给一句线索和一批候选，返回每条的相关度（0～1，按原顺序）。和向量接口共用地址和密钥。
 * @param {{ url: () => string, model: () => string, key?: () => string, fetch?: typeof fetch }} o
 */
export function createRerankClient(o) {
  const doFetch = o.fetch || globalThis.fetch
  return async function rerank(query, docs, { timeoutMs = 1500 } = {}) {
    const list = (Array.isArray(docs) ? docs : []).map((t) => String(t || '').slice(0, 1000))
    if (!list.length || !String(query || '').trim()) return []
    const base = String(o.url() || '').trim().replace(/\/+$/, '')
    const model = String(o.model() || '').trim()
    if (!base || !model) throw new Error('没设精排模型')
    const u = new URL(base)
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('精排接口地址不对')
    const key = String(o.key?.() || '')
    if (!key && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) throw new Error('没填精排接口的密钥')
    const headers = { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const r = await doFetch(`${base}/rerank`, { method: 'POST', headers, body: JSON.stringify({ model, query: String(query).slice(0, 1000), documents: list, top_n: list.length, return_documents: false }), signal: ctl.signal, redirect: 'error' })
      if (!r.ok) throw new Error('精排接口返回 ' + r.status)
      const j = await r.json()
      const out = Array.from({ length: list.length }, () => 0)
      for (const x of Array.isArray(j?.results) ? j.results : []) {
        const i = Number(x?.index)
        const s = Number(x?.relevance_score ?? x?.score)
        if (Number.isInteger(i) && i >= 0 && i < out.length && Number.isFinite(s)) out[i] = Math.max(0, Math.min(1, s))
      }
      return out
    } finally {
      clearTimeout(timer)
    }
  }
}

// ---------- 向量进度（从 vector-state.js 合并进来） ----------
// 哪些还没用当前模型算过、算到哪了、能不能算。
