// 文字 → 语音文件。
//   首选：edge-tts（微软在线朗读，音色好），装在插件自己的 Python 虚拟环境 ~/Aurabot/pyenv 里，不污染系统。
//   兜底：macOS 自带的中文语音（say，Tingting 等），什么都不装也能用。
// 管线：文字 → TTS → 文件路径。任何一步失败由调用方退回发文字。（RVC 音色目前用在翻唱上，见 src/song/）

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, statSync, readdirSync, unlinkSync, writeFileSync, rmSync } from 'node:fs'
import { buildWav } from './wav.js'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { dataDir } from '../core/store.js'

// edge-tts 的私有 Python 环境，「安装语音组件」时自动创建
export const PYENV_DIR = process.env.AURABOT_PYENV || join(homedir(), 'Aurabot', 'pyenv')
/** 兜底用的系统语音叫什么（写日志 / 提示用）。 */
const SYSTEM_VOICE = ' macOS 自带语音'
const pyExe = () => join(PYENV_DIR, 'bin', 'python')

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
  } catch (error) {}
  return d
}

export function edgeInstalled() {
  if (!existsSync(pyExe())) return false
  try {
    return readdirSync(join(PYENV_DIR, 'lib')).some((v) => v.startsWith('python') && existsSync(join(PYENV_DIR, 'lib', v, 'site-packages', 'edge_tts')))
  } catch (error) {
    return false
  }
}

/** 面板「安装语音组件」：建虚拟环境并 pip 安装 edge-tts（开源，LGPL）。 */
/**
 * 「安装语音组件」：在 ~/Aurabot/pyenv 建一个只给 edge-tts 用的 Python 环境，装固定版本的 edge-tts。
 * 全程用 uv（翻唱安装同一套做法）：
 * - uv 和 Python 都用所有功能共用的那份（心智核心目录 ~/Aurabot/mind 里，见 core/python.js），不碰系统的 python3
 *   （那是 Xcode 命令行工具里的，没装时会弹窗要求安装）
 * - 官方源慢时自动改用国内镜像（和翻唱安装同一个判断）
 * - uv 的下载缓存放在安装目录里、装完删掉，不往 ~/.cache/uv 留东西
 * @param {object} [log]
 * @param {{root?: string}} [o] root = 翻唱安装目录（面板里改过就传进来；留空 = ~/Aurabot/rvc）
 */
export async function installEdge(log, { root = '' } = {}) {
  const { defaultRoot, MAC_STACK } = await import('../song/studio.js')
  const { sharedUv, shouldUseCnMirror, uvBaseEnv, CN_PYPI, PY_VERSION } = await import('../core/python.js')
  const base = root || defaultRoot()
  let uv
  try {
    uv = await sharedUv({ note: (s) => log?.info(s.trim()), log })
  } catch (error) {
    return { ok: false, message: '准备安装工具 uv 失败：' + error.message }
  }
  const cn = await shouldUseCnMirror('auto')
  const cache = join(base, 'uv-cache-voice')
  const env = uvBaseEnv({ cache, cn })
  try {
    if (!existsSync(pyExe())) {
      log?.info(`用 uv 准备 Python ${PY_VERSION}`)
      const r = await run(uv, ['venv', '-q', PYENV_DIR, '--python', PY_VERSION], { timeoutMs: 600000, env })
      if (r.code !== 0) return { ok: false, message: '准备 Python 失败：' + r.err.slice(-300) }
    }
    log?.info(`正在安装 ${MAC_STACK.edgeTts} …`)
    const pip = (mirror) => run(uv, ['pip', 'install', '-q', '--python', pyExe(), MAC_STACK.edgeTts, ...(mirror ? ['--default-index', CN_PYPI] : [])], { timeoutMs: 300000, env })
    let r = await pip(cn)
    if (r.code !== 0 && !cn) r = await pip(true) // 官方源不行再试一次国内镜像
    if (r.code !== 0) return { ok: false, message: '安装 edge-tts 失败：' + r.err.slice(-300) }
    return { ok: true, message: '语音组件装好了' }
  } finally {
    try { rmSync(cache, { recursive: true, force: true }) } catch (error) {}
  }
}

async function edgeSynth(text, voice, rate, pitch) {
  const file = join(outDir(), `${randomUUID()}.mp3`)
  // 文字走 stdin 的临时文件，避免命令行里的引号 / 编码问题
  const txt = join(outDir(), `${randomUUID()}.txt`)
  writeFileSync(txt, text, 'utf8')
  const args = ['-I', '-m', 'edge_tts', '--voice', voice, '--file', txt, '--write-media', file]
  if (rate && rate !== '+0%') args.push(`--rate=${rate}`)
  if (pitch && pitch !== '+0Hz') args.push(`--pitch=${pitch}`)
  const r = await run(pyExe(), args, { timeoutMs: 60000 })
  try { unlinkSync(txt) } catch (error) {}
  if (r.code !== 0 || !existsSync(file) || statSync(file).size < 500) {
    throw new Error('edge-tts 失败：' + (r.err || r.out).slice(-200))
  }
  return file
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
  if (!existsSync(aiff)) throw new Error('macOS 语音失败：' + r.err.slice(-200))
  const c = await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@24000', aiff, file], { timeoutMs: 60000 })
  try { unlinkSync(aiff) } catch (error) {}
  if (!existsSync(file) || statSync(file).size < 1000) throw new Error('macOS 语音转换失败：' + (c.err || r.err).slice(-200))
  return file
}

// ---------- 本地 / 自建 TTS 服务（地址是主人自己填的，所以允许 127.0.0.1） ----------

async function fetchAudio(url, init, timeoutMs = 120000) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) throw new Error(`HTTP ${r.status}：${(await r.text().catch(() => '')).slice(0, 120)}`)
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length < 400) throw new Error('返回的音频太短：' + buf.toString('utf8').slice(0, 120))
  return buf
}

function saveAudio(buf, sampleRate) {
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

/** 请求头文本 → 对象。一行一个「Key: Value」，空行和 # 开头的行忽略。 */
function parseHeaderText(raw) {
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
function pickAudioFromJson(obj) {
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
 * 通用 HTTP：自己填地址、请求头、请求体。
 * GET  —— 地址里带 {text}
 * POST —— 地址填接口地址，请求体里带 {text}（按 JSON 字符串转义），也可用 {text_raw} 不转义
 * 返回二进制音频，或者 JSON（自动从 data / audio 等字段取 base64 解开）。
 */
export async function httpSynth(text, c) {
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

  const r = await fetch(target, { method, headers, body, signal: AbortSignal.timeout(120000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}：${(await r.text().catch(() => '')).slice(0, 160)}`)

  let buf = Buffer.from(await r.arrayBuffer())
  const ctype = String(r.headers.get('content-type') || '')
  const looksJson = ctype.includes('json') || buf[0] === 0x7b
  if (looksJson) {
    let parsed = null
    try { parsed = JSON.parse(buf.toString('utf8')) } catch (error) {}
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
      file = await local(clean, opt[opt.engine] || {})
      engine = opt.engine
    } catch (error) {
      log?.warn(`${opt.engine} 失败：${error.message} → 改用${SYSTEM_VOICE}`)
    }
  } else if (opt.engine !== 'system' && edgeInstalled()) {
    try {
      file = await edgeSynth(clean, opt.voice || 'zh-CN-XiaoyiNeural', opt.rate, opt.pitch)
      engine = 'edge'
    } catch (error) {
      log?.warn(error.message, '→ 改用' + SYSTEM_VOICE)
    }
  }
  if (!file) {
    // 系统自带语音兜底：macOS 的 say
    file = await macSynth(clean)
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
