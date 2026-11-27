// 生图：OpenAI 兼容、自定义接口，以及实验性 Codex 订阅接法。
//   ① openai —— 兼容 OpenAI /v1/images/generations 的服务（硅基流动、通义万相兼容层、本地 ComfyUI / SD WebUI 的 OpenAI 代理……）
//   ② custom —— 自己填接口：GET / POST、URL 模板（{prompt} 占位）、自定义参数名、从返回 JSON 里按路径取图
// 地址和密钥由管理员在面板里填；生成结果统一成 Buffer 交给 QQ 发出。

import { lstatSync, readFileSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fetchImage, withTimeoutSignal } from '../core/net.js'
import { resolvePainting } from './paintings.js'
import { createCodexAuth } from './codex-auth.js'
import { createCodexImage } from './codex-image.js'
import { mimeOf } from '../core/image-info.js'
import { imageToolBlock } from '../core/img.js'
import { fitSizeForProvider, imageSizeFor, normalizeRequestedSize } from './image-shape.js'
import { dataDir, readJson, writeJson } from '../core/store.js'
import { dimsOf, dotted, fill, findImage, multiReference } from './imagegen-template.js'
import { createProviders } from './imagegen-providers.js'

export { fill, dimsOf, dotted, findImage, multiReference }
export { imageToolBlock }

/** 工具只接受聊天里的短期引用或图库文件名；绝不把模型给的路径 / URL 当图片读。 */
export async function resolveDrawImage(image, { hub, chat, allowGlobalPaintings = false, quoteId }) {
  if (image === undefined || image === null || image === '') return null
  if (typeof image !== 'string') throw new Error('参考图只接受 last、quote 或画作文件名')
  const ref = image.trim()
  let buf
  if (/^(last|最近|最近一张|最近发的图|对方最近发的图)$/i.test(ref)) {
    buf = await hub.referenceImage(chat, 'last')
  } else if (/^(quote|引用|引用消息里的图)$/i.test(ref)) {
    buf = await hub.referenceImage(chat, 'quote', { replyId: quoteId })
  } else {
    if (!ref || /[\\/:\0]/.test(ref)) throw new Error('参考图只接受 last、quote 或画作文件名，不接受路径或网址')
    const path = resolvePainting(chat.chatId, ref, { allowGlobal: allowGlobalPaintings })?.path
    if (!path || !lstatSync(path).isFile()) throw new Error('找不到这张画作，请使用图库里的文件名')
    buf = readFileSync(path)
  }
  if (!Buffer.isBuffer(buf) || !String(mimeOf(buf)).startsWith('image/')) throw new Error('参考图不是可用的图片')
  return buf
}

const UNSUPPORTED_REFERENCE = '这个生图服务不支持参考图'
function serviceError(status, message, image) {
  const unsupported = [404, 405, 415, 501].includes(status)
    || ([400, 422].includes(status) && /(?:(?:unsupported|not support|does not support|not available|unknown|unrecognized).*(?:image|edit|model)|(?:image|edit|model).*(?:unsupported|not support|does not support|not available)|不支持.*(?:图|编辑|模型)|(?:图|编辑|模型).*不支持)/i.test(message))
  const error = new Error(image && unsupported ? UNSUPPORTED_REFERENCE : message)
  const blocked = /content policy|safety (?:policy|system)|moderation|内容审核|内容违规/i.test(message)
  error.fallbackable = !blocked && (unsupported || [401, 408, 429].includes(status) || status >= 500)
  return error
}

/**
 * 自定义接口这一次要发什么（纯函数，方便单独测）。
 * 返回 { url, method, headers, body }。
 */
export function customRequest (imageGen, prompt, image) {
  const cp = imageGen.custom || {}
  const method = String(cp.method || 'GET').toUpperCase() === 'GET' ? 'GET' : 'POST'
  const { width, height } = dimsOf(imageGen.size)
  const raw = { prompt, model: imageGen.model || '', size: imageGen.size || '', width, height, image: image ? image.toString('base64') : '' }
  const enc = { ...raw, prompt: encodeURIComponent(prompt), image: encodeURIComponent(raw.image) }
  const params = (Array.isArray(cp.params) ? cp.params : [])
    .map((p) => ({ key: String(p && p.key != null ? p.key : '').trim(), value: p ? p.value : '' }))
    .filter((p) => p.key)

  // URL 的 fragment 不会发给服务端；重复参数按最终实际发送的值判断。
  const sentParams = method === 'POST' ? Object.values(Object.fromEntries(params.map((p) => [p.key, p.value]))) : params.map((p) => p.value)
  if (image && ![String(cp.url || '').split('#')[0], ...sentParams].some((v) => String(v || '').includes('{image}'))) throw serviceError(415, UNSUPPORTED_REFERENCE, image)
  let url = fill(cp.url, enc)
  if (method === 'GET' && params.length) {
    const q = params.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(fill(p.value, raw))}`).join('&')
    url += (url.includes('?') ? '&' : '?') + q
  }

  const headers = {}
  if (imageGen.apiKey) headers.authorization = `Bearer ${imageGen.apiKey}`

  let body
  if (method === 'POST') {
    const obj = {}
    for (const p of params) obj[p.key] = fill(p.value, raw)
    if (cp.bodyType === 'form') {
      headers['content-type'] = 'application/x-www-form-urlencoded'
      body = new URLSearchParams(obj).toString()
    } else {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(obj)
    }
  }
  return { url, method, headers, body }
}

/** 接口返回的「图片地址 / base64」变成 Buffer。 */
async function valueToBuffer (v, signal) {
  if (typeof v !== 'string' || !v) throw new Error('生图接口没有返回图片')
  const b64 = /^data:image\/[^;]+;base64,(.+)$/i.exec(v)
  if (b64) {
    if (b64[1].length > 28 * 1024 * 1024) throw new Error('生图接口返回的图片太大')
    return Buffer.from(b64[1], 'base64')
  }
  if (/^https?:\/\//i.test(v)) return fetchImage(v, { maxBytes: 20 * 1024 * 1024, allowLocal: false, timeoutMs: 120000, signal })
  throw new Error('生图接口返回的既不是图片地址也不是图片')
}

const PROVIDER_PRESETS = {
  seedream: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedream-3-0-t2i-250415' },
  xai: { baseUrl: 'https://api.x.ai/v1', model: 'grok-2-image' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash-image' },
  sensenova: { baseUrl: 'https://api.sensenova.cn/v1', model: 'sensenova-u1' },
}
function withPreset(c) {
  const preset = PROVIDER_PRESETS[c.provider]
  return preset ? { ...c, baseUrl: c.baseUrl || preset.baseUrl, model: c.model || preset.model } : c
}

export function createImageGen({ getConfig, log, local, localImage, fetchImpl, codexAuth }) {
  const statusFile = dataDir('imagegen-last-error.json')
  const fetch = fetchImpl || ((...args) => globalThis.fetch(...args))
  const auth = codexAuth || createCodexAuth({ log, fetchImpl: fetch })
  const viaCodex = createCodexImage({ auth, fetchImpl: fetch, log })
  const localReady = () => {
    const c = getConfig().imageGen
    if (c.provider === 'local') return Boolean(c.enabled && localImage?.status().ready)
    return Boolean(local?.active('image'))
  }
  /**
   * extra：除了 image 以外的参考图（比如她的形象图的其余几张）。能一次收好几张的服务（gpt-image 系列）都给，别的只用 image 那一张
   */
  async function generateInner(prompt, { shape, image, size, extra = [], signal, redraw } = {}) {
    signal?.throwIfAborted()
    const config = getConfig().imageGen
    const requestedSize = size == null || size === '' ? '' : normalizeRequestedSize(size)
    if (size != null && size !== '' && !requestedSize) throw new Error('图片尺寸格式不对，应为 1024x1024 或 2048x2048 这类格式')
    const wantedSize = requestedSize || imageSizeFor(shape, config)
    const c = withPreset({ ...config, size: fitSizeForProvider(config.provider, wantedSize, config) })
    if (image != null && (!Buffer.isBuffer(image) || !String(mimeOf(image)).startsWith('image/'))) throw new Error('参考图不是可用的图片')
    if (image && c.img2img === false) throw new Error('参考图功能已关闭')
    const full = [c.stylePrompt, prompt].filter(Boolean).join('，')
    if (c.provider === 'local') {
      if (!c.enabled) throw new Error('生图还没开启')
      if (!localImage) throw new Error('内置本地生图不可用')
      return localImage.generate(full, { size: c.size, image, redraw, steps: c.localSteps, signal })
    }
    // 本地接口接管：用用户自己电脑上的画图服务
    if (local?.active('image')) {
      const { localImageBuffer } = await import('../local/local.js')
      const t = Date.now()
      const buf = await local.call('image', { prompt: full, size: c.size, ...(image ? { image: image.toString('base64') } : {}) }, { signal, readResult: localImageBuffer })
      signal?.throwIfAborted()
      log.info(`本地画好了一张图（${Math.round(buf.length / 1024)}KB，${Math.round((Date.now() - t) / 1000)}s）：${prompt.slice(0, 40)}`)
      return buf
    }
    if (!c.enabled) throw new Error('生图还没开启')
    const t = Date.now()
    const run = async (endpoint) => {
      const buf = endpoint.provider === 'codex'
        ? await viaCodex(endpoint, full, { shape, image, signal })
        : endpoint.provider === 'custom' ? await viaCustom(endpoint, full, image, signal)
          : endpoint.provider === 'gemini' ? await viaGemini(endpoint, full, image, signal)
            : endpoint.provider === 'comfyui' ? await viaComfy(endpoint, full, image, signal)
              : await viaOpenAI(endpoint, full, image, extra, signal)
      signal?.throwIfAborted()
      if (!buf?.length) throw serviceError(502, '生图接口没有返回图片', false)
      if (!String(mimeOf(buf)).startsWith('image/')) throw serviceError(502, '生图接口返回的不是图片', false)
      return buf
    }
    let failure
    let buf
    for (const [index, endpoint] of [c, ...fallbacks(c)].entries()) {
      signal?.throwIfAborted()
      try {
        buf = await run(endpoint)
        if (index) log.info('生图已用备用服务完成')
        break
      } catch (error) {
        signal?.throwIfAborted()
        failure = error
        if (!error.fallbackable) throw error
      }
    }
    if (!buf) throw failure
    log.info(`画好了一张图（${Math.round(buf.length / 1024)}KB，${Math.round((Date.now() - t) / 1000)}s）：${prompt.slice(0, 40)}`)
    return buf
  }

  async function generate(prompt, opts = {}) {
    try {
      const out = await generateInner(prompt, opts)
      try { unlinkSync(statusFile) } catch {}
      return out
    } catch (error) {
      try {
        const c = getConfig().imageGen || {}
        writeJson(statusFile, { at: Date.now(), provider: c.provider || '', model: c.model || '', message: String(error?.message || error).slice(0, 500) })
      } catch (saveError) { log?.debug?.('记生图失败原因失败：', saveError.message) }
      throw error
    }
  }

  function lastError() {
    const v = readJson(statusFile, null)
    return v && typeof v === 'object' ? v : null
  }

  function clearLastError() {
    try { unlinkSync(statusFile) } catch {}
    return { ok: true }
  }

  function fallbacks(c) {
    if (!c.fallbackEnabled) return []
    return (c.fallbacks || []).flatMap((item) => {
      if (!item.model) return []
      if (item.provider === 'codex') return auth.status().loggedIn && (c.provider !== 'codex' || item.model !== c.codex?.model)
        ? [{ ...c, provider: 'codex', codex: { ...c.codex, model: item.model } }] : []
      // ComfyUI 备用端点需要完整 workflow/节点配置，当前备用表单不完整，先不参与降级。
      if (item.provider === 'comfyui') return []
      try {
        const url = new URL(item.baseUrl)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return []
        if (c.provider === 'openai' && item.model === c.model && item.baseUrl === c.baseUrl) return []
        const endpoint = withPreset({ ...c, ...item })
        return [{ ...endpoint, provider: ['gemini', 'comfyui', 'xai'].includes(item.provider) ? item.provider : 'openai', isFallback: true }]
      } catch { return [] }
    })
  }

  async function request(url, options) {
    try { return await fetch(url, options) }
    catch (error) {
      throw Object.assign(new Error('生图服务连接失败或超时', { cause: error }), { fallbackable: true })
    }
  }

  /** xAI 编辑：官方要求 JSON（图片用 data URL），不能沿用 OpenAI 的 multipart。 */
  const { viaXaiEdit, viaOpenAI, viaComfy, viaGemini, viaCustom } = createProviders({ request, valueToBuffer, serviceError, customRequest, log })

  const enabled = () => {
    const c = getConfig().imageGen
    if (c.provider === 'local' || local?.active('image')) return localReady()
    if (!c.enabled) return false
    if (fallbacks(c).length) return true
    if (c.provider === 'codex') return auth.status().loggedIn
    if (c.provider === 'comfyui') return Boolean(c.comfy?.baseUrl && c.comfy?.workflow)
    return c.provider === 'custom' ? Boolean(c.custom && c.custom.url) : Boolean(withPreset(c).baseUrl && withPreset(c).model)
  }

  return { generate, lastError, clearLastError, enabled, localReady, codexAuth: auth, dispose: () => auth.dispose?.() }
}

/**
 * qq_draw_image 工具结果里那句话。
 * 看不了图、或者「让她画完自己看一眼」关着时，都要如实说，否则她会照着提示词编画面细节。
 * 这里只回一句话，不带文件路径；能不能把「已保存到本机：路径」告诉她，由调用方按
 * 「这张图有没有真的交出去」决定（能看图 + 开关开着 + 附件登记成功才给）。
 */
export function drawToolMessage ({ visual = false, seeOwn = true } = {}) {
  if (!visual) return '画好发出去了，但这次没能把图片交给你看；别描述画面里有什么'
  if (!seeOwn) return '画好发出去了。这次没把图给你看，别描述画面里有什么'
  return '画好发出去了'
}

/**
 * qq_draw_image 的工具结果怎么渲染：一行文字 +（有图时）image 块。
 * image 一般是 DSH 附件块（imageToolBlock() 登记过的），原样透传；没图就只回文字。
 */
export function drawResultBlocks (_args, value) {
  const text = value && value.ok === false ? '✗ ' + (value.message || '没成功') : (value && value.message) || '✓'
  const blocks = [{ type: 'text', text }]
  const img = value && value.image
  if (img && img.attachment) blocks.push({ ...img, type: 'image' })
  return blocks
}
