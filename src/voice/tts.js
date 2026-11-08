// 文字 → 语音文件。
//   首选：edge-tts（微软在线朗读，音色好），装在插件自己的 Python 虚拟环境 ~/Aurabot/pyenv 里，不污染系统。
//   兜底：macOS 自带的中文语音（say，Tingting 等），什么都不装也能用。
// 管线：文字 → TTS → 文件路径。任何一步失败由调用方退回发文字。（RVC 音色目前用在翻唱上，见 src/song/）

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, statSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
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
export async function installEdge(log) {
  mkdirSync(PYENV_DIR, { recursive: true })
  if (!existsSync(pyExe())) {
    // 不用系统的 python3（那是 Xcode 命令行工具里的，没装时会弹窗要求安装）：用 uv 准备一个私有的 Python，版本和翻唱环境一样
    log?.info('用 uv 准备一个私有的 Python')
    const uv = await findOrFetchUv()
    if (!uv) return { ok: false, message: '准备 Python 失败：找不到 uv。先在「翻唱」页点一键安装（会把 uv 放进 ~/Aurabot/rvc/bin），或者自己装好 uv 再试' }
    const { MAC_STACK } = await import('../song/studio.js')
    const env = { UV_PYTHON_INSTALL_DIR: join(homedir(), 'Aurabot', 'rvc', 'python'), UV_PYTHON_PREFERENCE: 'only-managed', UV_PYTHON_INSTALL_MIRROR: 'https://registry.npmmirror.com/-/binary/python-build-standalone' }
    const r = await run(uv, ['venv', '-q', PYENV_DIR, '--python', MAC_STACK.python], { timeoutMs: 600000, env })
    if (r.code !== 0) return { ok: false, message: '准备 Python 失败：' + r.err.slice(-300) }
  }
  log?.info('正在安装 edge-tts …')
  let r = await run(pyExe(), ['-m', 'pip', 'install', '-q', 'edge-tts'], { timeoutMs: 300000 })
  if (r.code !== 0) {
    r = await run(pyExe(), ['-m', 'pip', 'install', '-q', '-i', 'https://mirrors.aliyun.com/pypi/simple', 'edge-tts'], { timeoutMs: 300000 })
  }
  // uv 建的环境里没有 pip：改用 uv 装
  if (r.code !== 0 && /No module named pip/.test(r.err)) {
    const uv = await findOrFetchUv()
    if (uv) {
      r = await run(uv, ['pip', 'install', '-q', '--python', pyExe(), 'edge-tts'], { timeoutMs: 300000 })
      if (r.code !== 0) r = await run(uv, ['pip', 'install', '-q', '--python', pyExe(), '--default-index', 'https://mirrors.aliyun.com/pypi/simple', 'edge-tts'], { timeoutMs: 300000 })
    }
  }
  if (r.code !== 0) return { ok: false, message: '安装 edge-tts 失败：' + r.err.slice(-300) }
  return { ok: true, message: '语音组件装好了' }
}

/** 找 uv：翻唱一键安装放在 ~/Aurabot/rvc/bin 的优先，其次是电脑上装好的（从程序坞打开的 DSH，PATH 里通常没有 Homebrew）。 */
async function findOrFetchUv() {
  if (process.env.AURABOT_UV) return process.env.AURABOT_UV
  const own = join(homedir(), 'Aurabot', 'rvc', 'bin', 'uv')
  if (existsSync(own)) return own
  if ((await run('uv', ['--version'], { timeoutMs: 15000 })).code === 0) return 'uv'
  return [join(homedir(), '.local', 'bin', 'uv'), join(homedir(), '.cargo', 'bin', 'uv'), '/opt/homebrew/bin/uv', '/usr/local/bin/uv'].find((p) => existsSync(p)) || ''
}

async function edgeSynth(text, voice, rate, pitch) {
  const file = join(outDir(), `${randomUUID()}.mp3`)
  // 文字走 stdin 的临时文件，避免命令行里的引号 / 编码问题
  const txt = join(outDir(), `${randomUUID()}.txt`)
  const { writeFileSync } = await import('node:fs')
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

/** macOS 自带语音：say 念成 AIFF，再用 afconvert 转成 24 kHz 16 位 WAV（两个都是系统自带命令）。 */
async function macSynth(text) {
  const id = randomUUID()
  const aiff = join(outDir(), `${id}.aiff`)
  const file = join(outDir(), `${id}.wav`)
  const voice = pickMacVoice((await run('say', ['-v', '?'], { timeoutMs: 15000 })).out)
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
  const local = { cosyvoice: cosyvoiceSynth, gptsovits: gptsovitsSynth, http: httpSynth }[opt.engine]
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
