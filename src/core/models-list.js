// 「获取可用模型」：填好服务地址和 API Key 后，问那个服务有哪些模型（OpenAI 兼容的 GET /models），
// 面板里点一下就能选，不用自己抄模型名。和 DSH「模型」设置里的「获取可用模型」一样。
//
// 按用途筛：SiliconFlow 的 /models 支持按子类型问（只给向量 / 精排 / 语音识别 / 画图的），
// 别家（OpenAI、Ollama、OneAPI 之类）一次全给，就按名字认个大概；认不出的也给，放在后面、默认不显示。

/** 用途 → SiliconFlow 的子类型，和认名字用的规则。 */
export const MODEL_KINDS = {
  embedding: { sub: 'embedding', re: /embed|bge-m3|bge-large|\be5\b|gte|jina-emb|nomic/i, label: '向量模型' },
  rerank: { sub: 'reranker', re: /rerank/i, label: '精排模型' },
  asr: { sub: 'speech-to-text', re: /whisper|sensevoice|asr|transcri|speech|paraformer|telespeech/i, label: '语音识别模型' },
  image: { sub: 'text-to-image', re: /image|dall-?e|flux|kolors|stable|diffusion|\bsd|seedream|cogview|hunyuan-?image|qwen-?image|janus/i, label: '画图模型' },
}

/** 地址只认 http / https，不带账号密码；末尾的 / 去掉。 */
export function checkBase(url) {
  const base = String(url || '').trim().replace(/\/+$/, '')
  let u
  try { u = new URL(base) } catch { throw new Error('服务地址不对（要 http:// 或 https:// 开头，一般以 /v1 结尾）') }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('服务地址不对（要 http:// 或 https:// 开头）')
  return base
}

/**
 * 问服务有哪些模型。
 * @param {{ baseUrl: string, apiKey?: string, kind?: string, fetch?: typeof fetch, timeoutMs?: number }} o
 * @returns {Promise<{ ok: true, models: string[], others: string[], kind: string }>}
 *   models：看起来是这个用途的；others：认不出用途的（面板里「显示全部」才列出来）
 */
export async function listModels({ baseUrl, apiKey = '', kind = '', fetch: doFetch = globalThis.fetch, timeoutMs = 10000 }) {
  const base = checkBase(baseUrl)
  const k = MODEL_KINDS[kind] || null
  const host = new URL(base).hostname
  const silicon = /(^|\.)siliconflow\.(cn|com)$/.test(host)
  const url = `${base}/models` + (silicon && k ? `?sub_type=${encodeURIComponent(k.sub)}` : '')
  const key = String(apiKey || '').trim()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  let r
  try {
    r = await doFetch(url, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: ctl.signal, redirect: 'error' })
  } catch (error) {
    throw new Error(ctl.signal.aborted ? '服务太久没回应，地址对吗？' : '连不上这个服务：' + error.message)
  } finally {
    clearTimeout(timer)
  }
  if (r.status === 401 || r.status === 403) throw new Error('API Key 不对或没有权限（服务回了 ' + r.status + '）')
  if (r.status === 404) throw new Error('这个服务没有「列出模型」的接口（/models），只能自己填模型名')
  if (!r.ok) throw new Error('服务回了 ' + r.status)
  let j
  try { j = await r.json() } catch { throw new Error('服务回的不是模型列表') }
  // OpenAI 风格 { data: [{ id }] }；Ollama 原生 { models: [{ name }] } 也认
  const raw = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : Array.isArray(j) ? j : []
  const ids = [...new Set(raw.map((m) => String(m?.id ?? m?.name ?? m?.model ?? (typeof m === 'string' ? m : '')).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  if (!ids.length) return { ok: true, models: [], others: [], kind }
  // SiliconFlow 按子类型问过了，全都算；别家按名字认
  if (!k || (silicon && url.includes('sub_type'))) return { ok: true, models: ids, others: [], kind }
  return { ok: true, models: ids.filter((id) => k.re.test(id)), others: ids.filter((id) => !k.re.test(id)), kind }
}
