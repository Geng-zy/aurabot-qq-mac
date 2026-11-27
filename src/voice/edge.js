// edge-tts：私有 Python 环境（uv + 固定版本）与调用。
// 从 voice/tts.js 抽出来：那边是「六后端 + 兜底 + 后处理」的编排，这边是 edge 这一个后端的环境与调用，
// 两者寿命不同（环境一次装好、调用天天用），混在一个文件里时改环境要读整份合成器。
//
// 跑进程（run）与输出目录（outDir）由调用方注入：macOS 的 say 后端也用它们。

import { existsSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// edge-tts 的私有 Python 环境，「安装语音组件」时自动创建
export const PYENV_DIR = process.env.AURABOT_PYENV || join(homedir(), 'Aurabot', 'pyenv')
const pyExe = () => join(PYENV_DIR, 'bin', 'python')


export function edgeInstalled() {
  if (!existsSync(pyExe())) return false
  try {
    return readdirSync(join(PYENV_DIR, 'lib')).some((v) => v.startsWith('python') && existsSync(join(PYENV_DIR, 'lib', v, 'site-packages', 'edge_tts')))
  } catch { 
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
export async function installEdge(log, { root = '', run } = {}) {
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
    try { rmSync(cache, { recursive: true, force: true }) } catch {}
  }
}

export async function edgeSynth(text, voice, rate, pitch, { run, outDir } = {}) {
  const file = join(outDir(), `${randomUUID()}.mp3`)
  // 文字走 stdin 的临时文件，避免命令行里的引号 / 编码问题
  const txt = join(outDir(), `${randomUUID()}.txt`)
  writeFileSync(txt, text, 'utf8')
  const args = ['-I', '-m', 'edge_tts', '--voice', voice, '--file', txt, '--write-media', file]
  if (rate && rate !== '+0%') args.push(`--rate=${rate}`)
  if (pitch && pitch !== '+0Hz') args.push(`--pitch=${pitch}`)
  const r = await run(pyExe(), args, { timeoutMs: 60000 })
  try { unlinkSync(txt) } catch {}
  if (r.code !== 0 || !existsSync(file) || statSync(file).size < 500) {
    throw new Error('edge-tts 失败：' + (r.err || r.out).slice(-200))
  }
  return file
}

