// 通用 HTTP 语音后端：地址/请求头/请求体由用户自己填，这里只负责三件事
//   1. 模板替换（{text} 转义、{text_raw} 不转义、{reqid} 每次一个随机 id）
//   2. 把响应认成音频：二进制直接用，JSON 就从常见字段里扒 base64
//   3. 边界校验（不是网页、不是错误页、不太短、不太大）
// 从 voice/tts.js 抽出来：这 80 行与「保存/零采样校验」无关，是纯 HTTP + 字符串模板，
// 用假 fetch 就能整段测；以前它埋在 417 行的合成器里，只能连着真实音频文件一起测。
// 保存与「零采样 WAV 判失败」仍在 tts.js，由调用方把 saveAudio 传进来。

import { randomUUID } from 'node:crypto'

/** 请求头文本 → 对象。一行一个「Key: Value」，空行和 # 开头的行忽略。 */
export function parseHeaderText(raw) {
  const out = {}
  for (const line of String(raw || '').split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const i = s.indexOf(':')
    if (i <= 0) continue
    const k = s.slice(0, i).trim()
    const v = s.slice(i + 1).trim()
    if (k && v) out[k] = v
  }
  return out
}

/** 云厂商把音频塞在 JSON 里（base64），这里把常见的几种字段扒出来。 */
export function pickAudioFromJson(obj) {
  if (!obj || typeof obj !== 'object') return ''
  const keys = ['data', 'audio', 'audio_base64', 'audioBase64', 'base64', 'voice', 'result']
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.length > 200) return v
    if (v && typeof v === 'object') {
      const inner = pickAudioFromJson(v)
      if (inner) return inner
    }
  }
  return ''
}

/**
 * 通用 HTTP 合成：
 * GET  —— 地址里带 {text}
 * POST —— 地址填接口地址，请求体里带 {text}（按 JSON 字符串转义），也可用 {text_raw} 不转义
 * 返回二进制音频，或者 JSON（自动从 data / audio 等字段取 base64 解开）。
 *
 * @param {string} text
 * @param {object} c 语音配置（urlTemplate / method / headers / body / sampleRate）
 * @param {object} deps { saveAudio: (buf, sampleRate) => string, fetchImpl?: Function, now?: () => number }
 * @returns {Promise<string>} 音频文件路径
 */
export async function httpSynth(text, c, { saveAudio, fetchImpl = globalThis.fetch, timeoutMs = 120000 } = {}) {
  if (typeof saveAudio !== 'function') throw new Error('httpSynth 需要 saveAudio 依赖')
  const url = String(c.urlTemplate || '').trim()
  if (!url) throw new Error('通用 TTS 没填地址')
  const method = String(c.method || 'GET').trim().toUpperCase()
  const headers = parseHeaderText(c.headers)
  const hasHeader = (name) => Object.keys(headers).some((k) => k.toLowerCase() === name)

  let target = url
  let body
  if (method === 'GET' || method === 'HEAD') {
    if (!url.includes('{text}')) throw new Error('GET 方式的地址里要有 {text}')
    target = url.split('{text}').join(encodeURIComponent(text))
  } else {
    const raw = String(c.body || '').trim()
    if (!raw) throw new Error(`${method} 方式要填请求体`)
    const escaped = JSON.stringify(text).slice(1, -1)
    body = raw.split('{text}').join(escaped).split('{text_raw}').join(text).split('{reqid}').join(randomUUID())
    if (!hasHeader('content-type')) headers['content-type'] = 'application/json'
  }

  const r = await fetchImpl(target, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) throw new Error(`HTTP ${r.status}：${(await r.text().catch(() => '')).slice(0, 160)}`)

  let buf = Buffer.from(await r.arrayBuffer())
  if (buf.length > 30 * 1024 * 1024) throw new Error('语音服务返回的音频太大')
  const ctype = String(r.headers.get('content-type') || '')
  if (/text\/html|text\/plain/i.test(ctype)) throw new Error('语音服务返回了网页而不是音频')
  const looksJson = ctype.includes('json') || buf[0] === 0x7b
  if (looksJson) {
    let parsed = null
    try { parsed = JSON.parse(buf.toString('utf8')) } catch {}
    if (!parsed) throw new Error('返回的是 JSON 但解析失败：' + buf.toString('utf8').slice(0, 160))
    const code = parsed.code ?? parsed.status ?? parsed.retcode
    const b64 = pickAudioFromJson(parsed)
    if (!b64) {
      throw new Error(`返回里没找到音频数据（code=${code}，message=${parsed.message || parsed.msg || parsed.err_msg || '-'}）`)
    }
    buf = Buffer.from(b64, 'base64')
  }
  if (buf.length < 400) throw new Error('返回的音频太短：' + buf.toString('utf8').slice(0, 160))
  return saveAudio(buf, c.sampleRate || 24000)
}
