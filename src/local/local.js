// 本地接口：数据目录 local/ 里放脚本，接管语音合成、生图、翻唱换声、语音识别，换成用户自己电脑上的模型或服务。
// 插件升级不会动这个文件夹；脚本改完保存就生效（按修改时间重新加载），不用重启。
// 面板里每项单独开关；文件不存在、开关关着或者出错，调用方退回内置方式。

import { existsSync, mkdirSync, copyFileSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dataDir } from '../core/store.js'
import { withTimeoutSignal } from '../core/net.js'
import { mimeOf } from '../core/image-info.js'

const TEMPLATES = fileURLToPath(new URL('./templates/', import.meta.url))
const README = 'README-本地接口.md'
const silentLog = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} })

export const SLOTS = {
  tts: { file: 'tts.mjs', title: '语音合成', timeoutMs: 60_000, example: 'GPT-SoVITS（http://127.0.0.1:9880，参考音频在 D:/voices/ref.wav）' },
  image: { file: 'image.mjs', title: '生图', timeoutMs: 300_000, example: 'SD WebUI（http://127.0.0.1:7860）或 ComfyUI（http://127.0.0.1:8188）' },
  song: { file: 'song-convert.mjs', title: '翻唱换声', timeoutMs: 20 * 60_000, example: '我自己训练的 so-vits-svc 模型（项目在 D:/so-vits-svc，模型 logs/44k/G_10000.pth）' },
  asr: { file: 'asr.mjs', title: '语音识别', timeoutMs: 60_000, example: 'FunASR / faster-whisper 的本地服务（http://127.0.0.1:8000）' },
  video: { file: 'video.mjs', title: '生视频', timeoutMs: 20 * 60_000, example: 'ComfyUI（http://127.0.0.1:8188）跑的视频工作流' },
}

/** 生图脚本的各种返回值统一成 Buffer。 */
export async function toImageBuffer(r, { signal, allowUrl = true } = {}) {
  signal?.throwIfAborted()
  const max = 20 * 1024 * 1024
  const check = (buf) => { if (buf.length > max) throw new Error('图片太大了（最多 20MB）'); return buf }
  const readFileCapped = (file) => {
    const st = statSync(file, { throwIfNoEntry: false })
    if (!st?.isFile()) throw new Error('图片文件不存在')
    if (st.size > max) throw new Error('图片太大了（最多 20MB）')
    return check(readFileSync(file))
  }
  if (Buffer.isBuffer(r)) return check(r)
  if (r?.buffer && Buffer.isBuffer(r.buffer)) return check(r.buffer)
  if (r?.base64) {
    const raw = String(r.base64).replace(/^data:[^,]+,/, '')
    if (raw.length > Math.ceil(max * 4 / 3) + 8) throw new Error('图片太大了（最多 20MB）')
    return check(Buffer.from(raw, 'base64'))
  }
  if (r?.file) return readFileCapped(r.file)
  if (allowUrl && r?.url) {
    const res = await fetch(r.url, { signal: withTimeoutSignal(60000, signal) })
    if (!res.ok) throw new Error(`下载图片失败（HTTP ${res.status}）`)
    const buf = Buffer.from(await res.arrayBuffer())
    return check(buf)
  }
  if (typeof r === 'string' && existsSync(r)) return readFileCapped(r)
  throw new Error('生图脚本没返回图片（要返回 Buffer，或 {buffer|file|base64|url}）')
}

/** 返回值里取文件路径（tts / 翻唱）。 */
export const fileOf = (r) => (typeof r === 'string' ? r : r?.file || r?.output || '')

export function localAudioFile(result) {
  const file = fileOf(result)
  if (!file || !statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error('脚本没返回可读的音频文件')
  return file
}

export async function localImageBuffer(result, signal) {
  const bytes = await toImageBuffer(result, { signal })
  if (!String(mimeOf(bytes)).startsWith('image/')) throw new Error('脚本没返回有效图片')
  return bytes
}

export function createLocal({ getConfig, log }) {
  const dir = () => dataDir('local')
  const outDir = () => dataDir('local', 'out')
  const pathOf = (slot) => join(dir(), SLOTS[slot].file)
  const last = {} // slot → { ok, at, message }

  function hashOf(slot) {
    try { return createHash('sha256').update(readFileSync(pathOf(slot))).digest('hex') } catch (error) { return '' }
  }
  function sidecar() { return join(dir(), '.trusted.json') }
  function storedHashes() {
    try { const v = JSON.parse(readFileSync(sidecar(), 'utf8')); return v && typeof v === 'object' ? v : {} } catch { return {} }
  }
  function approved(slot) {
    const hash = hashOf(slot)
    if (!hash) return false
    const configured = getConfig().local?.hashes?.[slot]
    if (typeof configured === 'string') return configured === hash
    // 首次使用（TOFU）：记住当前脚本；之后改了脚本必须重新确认，不能静默执行。
    const stored = storedHashes()
    if (!stored[slot]) {
      try { writeFileSync(sidecar(), JSON.stringify({ ...stored, [slot]: hash }), { encoding: 'utf8', mode: 0o600 }) } catch {}
      return true
    }
    return stored[slot] === hash
  }
  /** 这一项现在由本地脚本接管吗：开关、文件、脚本哈希都要对得上。 */
  function active(slot) {
    return Boolean(getConfig().local?.[slot]) && existsSync(pathOf(slot)) && approved(slot)
  }

  async function call(slot, args, { signal, outDir: output = outDir(), sensitive = false, onLateFinish, readResult } = {}) {
    const spec = SLOTS[slot]
    const file = pathOf(slot)
    if (!approved(slot)) throw new Error('本地脚本还没确认：先在面板「本地接口」里点「确认这个脚本」')
    const t = Date.now()
    // 生视频比别的慢得多，超时可以在面板单独调
    const timeoutMs = slot === 'video' ? (Number(getConfig().local?.videoTimeoutMin) || 20) * 60_000 : spec.timeoutMs
    const deadline = new AbortController()
    const activeSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal
    let timer, onAbort
    try {
      activeSignal.throwIfAborted()
      // 带上修改时间：脚本改了就重新加载
      const mod = await import(pathToFileURL(file).href + '?v=' + statSync(file).mtimeMs)
      activeSignal.throwIfAborted()
      if (slot === 'image' && args?.image && mod.supportsImage !== true) throw new Error('这个生图服务不支持参考图')
      const fn = mod.default || mod.run
      if (typeof fn !== 'function') throw new Error(`${spec.file} 里没有 export default 的函数`)
      mkdirSync(output, { recursive: true })
      const child = sensitive ? silentLog : log.child ? log.child('local') : log
      const interrupted = new Promise((_, reject) => {
        onAbort = () => reject(activeSignal.reason)
        activeSignal.addEventListener('abort', onAbort, { once: true })
      })
      timer = setTimeout(() => deadline.abort(new Error(`超过 ${Math.round(timeoutMs / 1000)} 秒没完成`)), timeoutMs)
      const work = Promise.resolve().then(() => {
        activeSignal.throwIfAborted()
        return fn({ ...args, outDir: output, log: child, signal: activeSignal })
      }).then((result) => readResult ? readResult(result, activeSignal) : result).finally(() => {
        if (activeSignal.aborted) return onLateFinish?.()
      })
      const result = await Promise.race([interrupted, work])
      if (!sensitive) last[slot] = { ok: true, at: Date.now(), message: `用时 ${((Date.now() - t) / 1000).toFixed(1)} 秒` }
      return result
    } catch (error) {
      if (sensitive) throw error
      last[slot] = { ok: false, at: Date.now(), message: String(error.message || error).slice(0, 300) }
      // 传进来的可能是根 logger（只有 child，没有 warn），直接调会把真实错误盖成 TypeError
      const say = typeof log.warn === 'function' ? log : log.child('local')
      say.warn(`本地接口「${spec.title}」出错：`, last[slot].message)
      throw error
    } finally {
      clearTimeout(timer)
      if (onAbort) activeSignal.removeEventListener('abort', onAbort)
    }
  }

  /** 把模板和说明放进 local/（已有的不覆盖）。 */
  function template(slot) {
    mkdirSync(dir(), { recursive: true })
    if (!existsSync(join(dir(), README))) copyFileSync(join(TEMPLATES, README), join(dir(), README))
    const dest = pathOf(slot)
    if (existsSync(dest)) return { ok: true, created: false, path: dest, message: '文件已经有了，没覆盖' }
    copyFileSync(join(TEMPLATES, SLOTS[slot].file), dest)
    return { ok: true, created: true, path: dest, message: '模板放好了，照里面的注释改，或者让 DSH 帮你改' }
  }

  /** 复制给 DSH：让它读说明、改脚本。 */
  function promptFor(slot) {
    const s = SLOTS[slot]
    return `帮我修改 Aurabot（大肥鱼 QQ 插件）的本地接口脚本：${pathOf(slot)}\n`
      + `先读同一个文件夹里的「${README}」了解参数和返回值的约定，再把这个脚本改成调用我电脑上的${s.title}：\n`
      + `【这里写你用的是什么、地址、模型和关键参数，例如：${s.example}】\n`
      + '只改这一个脚本，不要动插件本身的代码；改完告诉我怎么测试。'
  }

  function status() {
    return Object.entries(SLOTS).map(([slot, s]) => ({
      slot, title: s.title, file: s.file, path: pathOf(slot),
      exists: existsSync(pathOf(slot)), enabled: Boolean(getConfig().local?.[slot]), active: active(slot),
      hash: hashOf(slot), approved: approved(slot),
      last: last[slot] || null, prompt: promptFor(slot),
    }))
  }

  function trust(slot) { if (!SLOTS[slot]) return { ok: false, message: '没有这一项' }; const hash = hashOf(slot); return hash ? { ok: true, slot, hash } : { ok: false, message: '脚本不存在' } }

  return { active, call, template, status, dir, pathOf, trust }
}
