// 文字 → 语音文件。
//   首选：edge-tts（微软在线朗读，音色好），装在插件自己的 Python 虚拟环境 ~/Aurabot/pyenv 里，不污染系统。
//   兜底：macOS 自带的中文语音（say，Tingting 等），什么都不装也能用。
// 管线：文字 → TTS → 文件路径。任何一步失败由调用方退回发文字。（RVC 音色目前用在翻唱上，见 src/song/）

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, statSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { buildWav } from './wav.js'
import { isZeroSampleWav } from './duration.js'
import { httpSynth as httpSynthImpl, parseHeaderText, pickAudioFromJson } from './http-synth.js'
import { edgeInstalled, edgeSynth, installEdge as installEdgeImpl } from './edge.js'

// edge 后端的环境与安装入口在 voice/edge.js；对外导出面保持不变。
/** 兜底用的系统语音叫什么（写日志 / 提示用）。 */
const SYSTEM_VOICE = ' macOS 自带语音'

export { PYENV_DIR, edgeInstalled } from './edge.js'

/** 「安装语音组件」：注入 spawn 封装后调用 edge.js 的安装流程（对外签名不变）。 */
export function installEdge(log, o = {}) { return installEdgeImpl(log, { ...o, run }) }

export { parseHeaderText, pickAudioFromJson }

/** 通用 HTTP 后端：模板与响应解析在 http-synth.js，这里只把「保存音频」这一步接上。 */
export function httpSynth(text, c) { return httpSynthImpl(text, c, { saveAudio }) }
import { dataDir } from '../core/store.js'

function run(cmd, args, { timeoutMs = 60000, input, env } = {}) {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let child
    try {
      child = spawn(cmd, args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...(env || {}) } })
    } catch (error) {
      resolve({ code: -1, out, err: error.message })
      return
    }
    const t = setTimeout(() => {
      try { child.kill() } catch (e) {}
      err += '\n超时'
    }, timeoutMs)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => { err += e.message })
    child.on('close', (code) => {
      clearTimeout(t)
      resolve({ code, out, err })
    })
    if (input !== undefined) {
      child.stdin.end(input, 'utf8')
    }
  })
}

function outDir() {
  const d = dataDir('voice-cache')
  mkdirSync(d, { recursive: true })
  // 顺手清掉一天前的旧文件
  try {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (Date.now() - statSync(p).mtimeMs > 86400_000) unlinkSync(p)
    }
  } catch {}
  return d
}

/** 从 `say -v '?'` 的输出里挑一个中文（中国大陆）声音：优先 Tingting（女声），再按列表顺序。没有返回 ''。 */
export function pickMacVoice(list) {
  const zh = String(list || '').split('\n').filter((l) => /\bzh_CN\b/.test(l)).map((l) => l.split(/\s{2,}|\s+zh_/)[0].trim()).filter(Boolean)
  return zh.find((v) => /^Tingting\b/i.test(v)) || zh[0] || ''
}

let macVoice = null

/** macOS 自带语音：say 念成 AIFF，再用 afconvert 转成 24 kHz 16 位 WAV（两个都是系统自带命令）。 */
async function macSynth(text) {
  const id = randomUUID()
  const aiff = join(outDir(), `${id}.aiff`)
  const file = join(outDir(), `${id}.wav`)
  // 系统装了哪些声音只查一次（每次都跑 say -v ? 要多等几百毫秒）
  if (macVoice === null) macVoice = pickMacVoice((await run('say', ['-v', '?'], { timeoutMs: 15000 })).out)
  const voice = macVoice
  const r = await run('say', [...(voice ? ['-v', voice] : []), '-o', aiff, '-f', '-'], { timeoutMs: 60000, input: text })
  // say 失败时照样会留下一个只有文件头的 AIFF，只查 existsSync 会漏掉，必须看退出码
  if (r.code !== 0) throw new Error('macOS 语音失败（退出码 ' + r.code + '）：' + r.err.slice(-200))
  if (!existsSync(aiff)) throw new Error('macOS 语音失败：' + r.err.slice(-200))
  const c = await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@24000', aiff, file], { timeoutMs: 60000 })
  try { unlinkSync(aiff) } catch {}
  if (c.code !== 0) throw new Error('macOS 语音转换失败（退出码 ' + c.code + '）：' + (c.err || r.err).slice(-200))
  if (!existsSync(file) || statSync(file).size < 1000) throw new Error('macOS 语音转换失败：' + (c.err || r.err).slice(-200))
  return file
}

// ---------- 本地 / 自建 TTS 服务（地址是管理员自己填的，所以允许 127.0.0.1） ----------

async function fetchAudio(url, init, timeoutMs = 120000) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) throw new Error(`HTTP ${r.status}：${(await r.text().catch(() => '')).slice(0, 120)}`)
  const ctype = String(r.headers.get('content-type') || '')
  if (/text\/html|text\/plain/i.test(ctype)) throw new Error('语音服务返回了网页而不是音频')
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length > 30 * 1024 * 1024) throw new Error('语音服务返回的音频太大')
  if (buf.length < 400) throw new Error('返回的音频太短：' + buf.toString('utf8').slice(0, 120))
  return buf
}

function saveAudio(buf, sampleRate) {
  const sniff = buf.subarray(0, 512).toString('utf8').trim().toLowerCase()
  if (/^<(?:!doctype|html|head|body)/.test(sniff)) throw new Error('语音服务返回了网页而不是音频')
  const isWav = buf.toString('ascii', 0, 4) === 'RIFF'
  const isMp3 = buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
  const isOgg = buf.toString('ascii', 0, 4) === 'OggS'
  let out = buf
  let ext = isWav ? 'wav' : isMp3 ? 'mp3' : isOgg ? 'ogg' : 'wav'
  // 裸 PCM16（CosyVoice 官方 FastAPI 就是这样流式返回的）：包一个 WAV 头
  if (!isWav && !isMp3 && !isOgg) out = buildWav(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2)), sampleRate)
  const file = join(outDir(), `${randomUUID()}.${ext}`)
  writeFileSync(file, out)
  return file
}

/** CosyVoice 官方 runtime/python/fastapi：/inference_sft（tts_text, spk_id）、/inference_instruct（再加 instruct_text）。 */
async function cosyvoiceSynth(text, c) {
  const base = String(c.url || '').replace(/\/+$/, '')
  if (!base) throw new Error('没填 CosyVoice 地址')
  const instruct = c.mode === 'instruct' && c.instruct
  const form = new URLSearchParams({ tts_text: text, spk_id: c.spkId || '中文女' })
  if (instruct) form.set('instruct_text', c.instruct)
  const buf = await fetchAudio(`${base}/${instruct ? 'inference_instruct' : 'inference_sft'}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form })
  return saveAudio(buf, c.sampleRate || 22050)
}

/** GPT-SoVITS api_v2：GET /tts?text=…&text_lang=zh&ref_audio_path=…&prompt_text=…&prompt_lang=zh */
async function gptsovitsSynth(text, c) {
  const base = String(c.url || '').replace(/\/+$/, '')
  if (!base) throw new Error('没填 GPT-SoVITS 地址')
  const q = new URLSearchParams({ text, text_lang: c.textLang || 'zh', ref_audio_path: c.refAudio || '', prompt_text: c.promptText || '', prompt_lang: c.promptLang || 'zh', media_type: 'wav' })
  return saveAudio(await fetchAudio(`${base}/tts?${q}`, { method: 'GET' }), 32000)
}

/**
 * Breeze 语音（BreezeBlue / 本机自建）。两种模式：
 *   cloud（默认）：`POST {url}/v1/text-to-speech/{音色id}?output_format=…&delivery=sync`
 *                   带 `xi-api-key`，body `{ text, model_id, language_code?, instructions?, voice_settings? }`
 *   local        ：`POST {url}/v1/audio/speech`（say-model/breeze_infer 那套）multipart 表单：
 *                   text / instruction / cfg_scale / seed，返回音频字节
 */
export async function breezeSynth(text, c = {}) {
  const base = String(c.url || 'https://api.breeze.blue').replace(/\/+$/, '')
  if (c.mode === 'local') return breezeLocal(text, c, base)
  const key = String(c.key || '').trim()
  const voiceId = String(c.voiceId || '').trim()
  if (!key) throw new Error('Breeze 没填 API Key（brz_ 开头）')
  if (!voiceId) throw new Error('Breeze 没填音色 id（voc_ 开头）')
  const format = String(c.outputFormat || 'mp3_24000_128')
  const url = `${base}/v1/text-to-speech/${encodeURIComponent(voiceId)}`
    + `?output_format=${encodeURIComponent(format)}&delivery=sync`
  // 云端只用「硬音色 id」：不发 instructions、也不发 voice_settings。
  // 理由：描述一开就是按描述生成，音色会往描述漂（官方还规定 guidance>1 时 speaker boost 被忽略）。
  // 想要别的音色就去 breezeblue.ai 做好、把新的 voc_ id 填进来，比在本地写描述稳得多。
  // 语气/描述只在本地自建（breeze_infer 的 voice design）里用。
  const body = { text, model_id: String(c.model || 'breeze-tts-2') }
  if (c.languageCode) body.language_code = String(c.languageCode)
  const timeout = Number(c.timeoutMs) || 60000
  let r
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': key, accept: 'application/json, audio/*', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    })
  } catch (error) {
    throw new Error(`Breeze 连不上（${base}）：${error.message}`)
  }
  if (!r.ok) {
    const detail = (await r.text().catch(() => '')).slice(0, 160)
    const hint = r.status === 401 ? '：Key 不对或已撤销' : r.status === 402 ? '：额度不够' : r.status === 429 ? '：撞频率限制了' : ''
    throw new Error(`Breeze HTTP ${r.status}${hint}：${detail}`)
  }
  const type = r.headers.get('content-type') || ''
  if (!/^audio\//i.test(type)) {
    const detail = (await r.text().catch(() => '')).slice(0, 160)
    throw new Error(`Breeze 没返回音频（content-type=${type || '空'}）：${detail}`)
  }
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length < 400) throw new Error('Breeze 返回的音频太短：' + buf.length + ' 字节')
  // mp3_24000_128 / mp3_44100_128 这种格式名里带采样率
  const rate = Number((/mp3_(\d+)/.exec(format) || [])[1]) || 24000
  return saveAudio(buf, rate)
}

/** 本机 breeze_infer 那套：multipart 表单（text / instruction / cfg_scale / seed），返回音频字节。 */
async function breezeLocal(text, c, base) {
  if (!base) throw new Error('没填 Breeze 本地服务地址')
  const form = new FormData()
  form.set('text', text)
  if (c.instructions) form.set('instruction', String(c.instructions))
  const cfgScale = Number(c.guidanceScale)
  if (Number.isFinite(cfgScale) && cfgScale > 0) form.set('cfg_scale', String(cfgScale))
  const timeout = Number(c.timeoutMs) || 60000
  let r
  try {
    r = await fetch(`${base}/v1/audio/speech`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeout) })
  } catch (error) {
    throw new Error(`Breeze 本地服务连不上（${base}）：${error.message}`)
  }
  if (!r.ok) {
    const detail = (await r.text().catch(() => '')).slice(0, 160)
    // 本地服务一次只跑一个请求，撞上就有 409
    const hint = r.status === 409 ? '：本地正在合成上一句，等它说完再试' : ''
    throw new Error(`Breeze 本地 HTTP ${r.status}${hint}：${detail}`)
  }
  const type = r.headers.get('content-type') || ''
  if (type && !/^(audio\/|application\/octet-stream)/i.test(type)) {
    const detail = (await r.text().catch(() => '')).slice(0, 160)
    throw new Error(`Breeze 本地没返回音频（content-type=${type}）：${detail}`)
  }
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length < 400) throw new Error('Breeze 本地返回的音频太短：' + buf.length + ' 字节')
  const rate = Number(c.sampleRate) || 24000
  return saveAudio(buf, rate)
}

/**
 * 合成结果必须真有音频。
 * `say` 失败时照样会留下只有文件头的 AIFF，转出来的 WAV 是 0 采样（正好 4096 字节），
 * 光看文件大小过得去，发到 QQ 却是一条没声音的语音条。这里直接判失败，交给调用方改发文字。
 * @returns {string} 原样返回 file，方便链式写
 */
export function ensureAudible(file) {
  if (!isZeroSampleWav(file)) return file
  try { unlinkSync(file) } catch {}
  throw new Error('合成的语音是空的（say 只写了个文件头，没有采样）')
}

/** 说话语音的后处理：目前原样返回（RVC 换音色只用在翻唱上，语音条直接用 TTS 的声音）。 */
export const voiceConverters = []

/**
 * @returns {Promise<{file:string, engine:string}>}
 */
export async function textToSpeech(text, opt = {}, log) {
  const clean = String(text || '').trim()
  if (!clean) throw new Error('没有要念的文字')
  let file = ''
  let engine = ''
  const local = { cosyvoice: cosyvoiceSynth, gptsovits: gptsovitsSynth, http: httpSynth, breeze: breezeSynth }[opt.engine]
  if (local) {
    try {
      file = ensureAudible(await local(clean, opt[opt.engine] || {}))
      engine = opt.engine
    } catch (error) {
      log?.warn(`${opt.engine} 失败：${error.message} → 改用${SYSTEM_VOICE}`)
    }
  } else if (opt.engine !== 'system' && edgeInstalled()) {
    try {
      file = ensureAudible(await edgeSynth(clean, opt.voice || 'zh-CN-XiaoyiNeural', opt.rate, opt.pitch, { run, outDir }))
      engine = 'edge'
    } catch (error) {
      log?.warn(error.message, '→ 改用' + SYSTEM_VOICE)
    }
  }
  if (!file) {
    // 系统自带语音兜底：macOS 的 say
    file = ensureAudible(await macSynth(clean))
    engine = 'system'
  }
  for (const conv of voiceConverters) {
    try {
      file = await conv(file)
    } catch (error) {
      log?.warn('变声失败，用原声：', error.message)
    }
  }
  return { file, engine }
}
