// 生图的各条供应商链：xAI、OpenAI 兼容、ComfyUI、Gemini、自定义 HTTP。
// 从 features/imagegen.js 抽出来：那边是「读配置 → 选链 → 归一化结果 → 记最近错误」的编排，
// 这边是每条链自己的请求形状与响应解析（互不调用），加一条链不用动编排。
//
// request / valueToBuffer / serviceError / customRequest / log 全部由调用方注入，因此可以单独喂假依赖测。

import { withTimeoutSignal } from '../core/net.js'
import { randomUUID } from 'node:crypto'
import { fetchImage } from '../core/net.js'
import { mimeOf } from '../core/image-info.js'
import { dimsOf, dotted, fill, findImage, multiReference } from './imagegen-template.js'

/**
 * @param {object} o
 * @param {(url: string, init: object) => Promise<Response>} o.request 带超时/错误包装的 fetch
 * @param {(v: any, signal?: AbortSignal) => Promise<Buffer>} o.valueToBuffer
 * @param {(status: number, message: string, image?: any) => Error} o.serviceError
 * @param {(cfg: object, prompt: string, image?: Buffer) => object} o.customRequest
 * @param {object} o.log
 */
// 与 features/imagegen.js 里的 PROVIDER_PRESETS 保持一致（那边给面板/回退用）
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_MODEL = 'gemini-2.5-flash-image'

export function createProviders({ request, valueToBuffer, serviceError, customRequest, log }) {
  async function viaXaiEdit(c, prompt, image, signal) {
    const base = String(c.baseUrl || '').replace(/\/+$/, '')
    if (!base || !c.model) throw serviceError(404, '还没填生图服务地址或模型', false)
    const headers = { 'content-type': 'application/json' }
    if (c.apiKey) headers.authorization = `Bearer ${c.apiKey}`
    const body = { model: c.model, prompt, image: { type: 'image_url', url: `data:${mimeOf(image)};base64,${image.toString('base64')}` }, n: 1, response_format: 'b64_json' }
    let r = await request(`${base}/images/edits`, { method: 'POST', headers, body: JSON.stringify(body), signal: withTimeoutSignal(180000, signal) })
    if ([404, 405].includes(r.status)) r = await request(`${base}/images/generations`, { method: 'POST', headers, body: JSON.stringify(body), signal: withTimeoutSignal(180000, signal) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw serviceError(r.status, j?.error?.message || j?.message || `HTTP ${r.status}`, true)
    const item = (j.data || j.images || [])[0] || {}
    if (item.b64_json) return Buffer.from(item.b64_json, 'base64')
    if (item.url) return fetchImage(item.url, { maxBytes: 20 * 1024 * 1024, allowLocal: false, timeoutMs: 120000, signal })
    throw serviceError(502, 'xAI 没有返回图片', false)
  }

  /** OpenAI 兼容接口。 */
  async function viaOpenAI (c, prompt, image, extra, signal) {
    const base = String(c.baseUrl || '').replace(/\/+$/, '')
    if (!base || !c.model) throw serviceError(404, '还没填生图服务地址或模型', false)
    if (image && c.provider === 'xai') return viaXaiEdit(c, prompt, image, signal)
    const headers = image ? {} : { 'content-type': 'application/json' }
    if (c.apiKey) headers.authorization = `Bearer ${c.apiKey}`
    // response_format、image_size 不是每家都认（官方 OpenAI 就不认）：被拒了去掉再发。被拒的请求没出图，重发不会多画
    const body = { model: c.model, prompt, size: c.size, n: 1, response_format: 'b64_json', image_size: c.size }
    let requestBody
    if (image) {
      requestBody = new FormData()
      const more = multiReference(c.model) ? (extra || []).filter((b) => Buffer.isBuffer(b)).slice(0, 7) : []
      // 一次收好几张的（gpt-image 系列）用 image[]，别家只认一个 image
      const field = more.length ? 'image[]' : 'image'
      for (const [i, b] of [image, ...more].entries()) requestBody.append(field, new Blob([b], { type: mimeOf(b) }), `reference-${i + 1}.` + mimeOf(b).split('/')[1])
      for (const [key, value] of Object.entries({ prompt, model: c.model, size: c.size })) requestBody.append(key, value)
    }
    let r, j
    for (;;) {
      signal?.throwIfAborted()
      r = await request(`${base}/images/${image ? 'edits' : 'generations'}`, { method: 'POST', headers, body: requestBody || JSON.stringify(body), signal: withTimeoutSignal(180000, signal), ...(c.isFallback ? { redirect: 'error' } : {}) })
      j = await r.json().catch(() => ({}))
      if (r.ok) break
      const message = j?.error?.message || j?.message || `HTTP ${r.status}`
      const bad = !image && r.status === 400 && ['response_format', 'image_size'].find((k) => k in body && message.includes(k))
      if (!bad) throw serviceError(r.status, message, image)
      delete body[bad]
    }
    const item = (j.data || j.images || [])[0] || {}
    let buf
    if (item.b64_json) {
      if (String(item.b64_json).length > 28 * 1024 * 1024) throw serviceError(502, '生图服务返回的图片太大', false)
      buf = Buffer.from(item.b64_json, 'base64')
    }
    // 有的服务返回 CDN 链接，下载可能要几十秒（实测 22 秒），默认 20 秒会误判成失败
    else if (item.url) buf = await fetchImage(item.url, { maxBytes: 20 * 1024 * 1024, allowLocal: false, timeoutMs: 120000, signal })
    else throw serviceError(502, '生图服务没有返回图片', false)
    return buf
  }

  /** ComfyUI 直连：提交 API workflow，轮询 history，取输出图。 */
  async function viaComfy(c, prompt, image, signal) {
    const cf = c.comfy || {}
    const base = String(cf.baseUrl || '').replace(/\/+$/, '')
    if (!base || !cf.workflow) throw serviceError(404, '还没填 ComfyUI 地址或 workflow', false)
    let workflow
    try { workflow = typeof cf.workflow === 'string' ? JSON.parse(cf.workflow) : cf.workflow } catch { throw serviceError(400, 'ComfyUI workflow 不是合法 JSON', false) }
    if (!workflow || typeof workflow !== 'object') throw serviceError(400, 'ComfyUI workflow 为空', false)
    let hasPrompt = false
    const put = (obj, value) => {
      if (Array.isArray(obj)) return obj.map((x) => put(x, value))
      if (!obj || typeof obj !== 'object') return obj
      const out = {}
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' && v.includes('__PROMPT__')) { out[k] = v.replaceAll('__PROMPT__', value); hasPrompt = true }
        else out[k] = put(v, value)
      }
      return out
    }
    workflow = put(workflow, prompt)
    const promptNode = String(cf.promptNode || '')
    if (promptNode) {
      const node = workflow[promptNode]
      if (!node?.inputs) throw serviceError(400, `找不到 ComfyUI 提示词节点 ${promptNode}`, false)
      node.inputs.text = prompt
      hasPrompt = true
    }
    if (!hasPrompt) throw serviceError(400, 'workflow 里没有 __PROMPT__，也没配提示词节点', false)
    if (image) {
      const fd = new FormData()
      fd.append('image', new Blob([image], { type: mimeOf(image) }), 'reference.' + mimeOf(image).split('/')[1])
      fd.append('overwrite', 'true')
      const up = await request(base + '/upload/image', { method: 'POST', body: fd, signal: withTimeoutSignal(60000, signal) })
      const uj = await up.json().catch(() => ({}))
      if (!up.ok) throw serviceError(up.status, uj?.error || 'ComfyUI 上传参考图失败', image)
      const name = [uj.subfolder, uj.name].filter(Boolean).join('/') || uj.name
      const imageNode = String(cf.imageNode || '')
      if (!imageNode || !workflow[imageNode]?.inputs) throw serviceError(400, '用了参考图，但没配 ComfyUI LoadImage 节点', image)
      workflow[imageNode].inputs.image = name
    }
    const clientId = randomUUID()
    const r = await request(base + '/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: clientId }), signal: withTimeoutSignal(60000, signal) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw serviceError(r.status, j?.error?.message || j?.error || 'ComfyUI 提交失败', image)
    const id = j.prompt_id || j.promptId
    if (!id) throw serviceError(502, 'ComfyUI 没有返回 prompt_id', image)
    const deadline = Date.now() + 180000
    while (Date.now() < deadline) {
      signal?.throwIfAborted()
      await new Promise((resolve) => setTimeout(resolve, Math.max(200, Number(cf.pollMs) || 1000)))
      const hr = await request(base + '/history/' + encodeURIComponent(id), { signal: withTimeoutSignal(20000, signal) })
      if (!hr.ok) continue
      const hj = await hr.json().catch(() => ({}))
      const entry = hj[id]
      const outputs = entry?.outputs || {}
      const nodes = cf.outputNode ? [outputs[cf.outputNode]] : Object.values(outputs)
      const img = nodes.flatMap((o) => o?.images || []).find((x) => x?.filename)
      if (img) {
        const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' })
        const fr = await request(base + '/view?' + q.toString(), { signal: withTimeoutSignal(60000, signal) })
        if (!fr.ok) throw serviceError(fr.status, 'ComfyUI 取图失败', image)
        const buf = Buffer.from(await fr.arrayBuffer())
        if (!buf.length || buf.length > 20 * 1024 * 1024) throw serviceError(502, 'ComfyUI 返回的图片为空或太大', false)
        return buf
      }
    }
    throw serviceError(504, 'ComfyUI 等待出图超时', image)
  }

  /** Gemini 原生 generateContent（API Key 走 query，和 OpenAI 兼容层分开）。 */
  async function viaGemini(c, prompt, image, signal) {
    const base = String(c.baseUrl || GEMINI_BASE).replace(/\/+$/, '')
    const model = c.model || GEMINI_MODEL
    if (!c.apiKey) throw serviceError(401, 'Gemini 需要 API Key', false)
    const parts = []
    if (image) parts.push({ inlineData: { mimeType: mimeOf(image), data: image.toString('base64') } })
    parts.push({ text: prompt })
    const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(c.apiKey)}`
    const r = await request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ parts }] }), signal: withTimeoutSignal(180000, signal) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw serviceError(r.status, j?.error?.message || `HTTP ${r.status}`, image)
    const out = (j.candidates || []).flatMap((x) => x?.content?.parts || []).find((p) => p?.inlineData?.data)
    if (out?.inlineData?.data) {
      const buf = Buffer.from(out.inlineData.data, 'base64')
      if (buf.length > 20 * 1024 * 1024) throw serviceError(502, '生图服务返回的图片太大', false)
      return buf
    }
    const text = (j.candidates || []).flatMap((x) => x?.content?.parts || []).map((p) => p?.text).filter(Boolean).join('\n')
    if (text) return valueToBuffer(text, signal)
    throw serviceError(502, 'Gemini 没有返回图片', image)
  }

  /** 自定义接口：GET 直接把参数拼在地址上，POST 放进 JSON / 表单。 */
  async function viaCustom (c, prompt, image, signal) {
    const cp = c.custom || {}
    if (!cp.url) throw serviceError(404, '还没填自定义生图接口地址', false)
    const req = customRequest(c, prompt, image)
    log.info(`生图请求：${req.method} ${image ? '（含参考图）' : req.url.slice(0, 160)}`)
    const r = await request(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: withTimeoutSignal(180000, signal),
    })
    const type = String(r.headers.get('content-type') || '')
    // 直接返回图片字节（pollinations 这类）
    if (type.startsWith('image/')) {
      if (!r.ok) throw serviceError(r.status, `HTTP ${r.status}`, image)
      const raw = Buffer.from(await r.arrayBuffer())
      if (raw.length > 20 * 1024 * 1024) throw serviceError(502, '生图服务返回的图片太大', false)
      return raw
    }
    const j = await r.json().catch(() => null)
    if (!r.ok) throw serviceError(r.status, (j && (j.error?.message || j.message)) || `HTTP ${r.status}`, image)
    if (!j) throw serviceError(502, '生图接口没有返回图片', false)
    const v = (cp.responsePath ? dotted(j, cp.responsePath) : null) || findImage(j)
    if (!v) throw serviceError(502, '生图接口没有返回图片地址', false)
    return valueToBuffer(v, signal)
  }


  return { viaXaiEdit, viaOpenAI, viaComfy, viaGemini, viaCustom }
}
