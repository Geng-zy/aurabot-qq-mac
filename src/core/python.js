// 插件里所有用 Python 的功能（心智核心的本地小模型、翻唱、语音组件……）共用同一份 Python 和同一个 uv，
// 都放在心智核心的目录里：~/Aurabot/mind/python、~/Aurabot/mind/bin/uv。每个功能各自建自己的环境（互不影响）。
// 心智核心是核心，别的功能依赖它可以；反过来不行（翻唱卸了、重装了，心智核心照样能用）。
// 全程用 uv 官方做法：UV_PYTHON_INSTALL_DIR / UV_PYTHON_BIN_DIR 都指进来，只用 uv 自己装的 Python，
// 不往 ~/.local/share/uv、~/.local/bin、~/.cache/uv 放任何东西。

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync, rmSync, copyFileSync, chmodSync } from 'node:fs'
import { join, basename, dirname, resolve as resolvePath, sep } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { readZip } from './zip.js'

/** 共用的 Python 版本（2026-11-09 起翻唱、语音、本地小模型都在它上面实测过）。 */
export const PY_VERSION = '3.13.18'
/** 共用 Python 和 uv 所在的目录（心智核心的目录）。测试可以用 AURABOT_PYTHON_ROOT 改。 */
export const sharedRoot = () => process.env.AURABOT_PYTHON_ROOT || join(homedir(), 'Aurabot', 'mind')
export const sharedPythonDir = () => join(sharedRoot(), 'python')
export const sharedUvDir = () => join(sharedRoot(), 'bin')

/** 跑一个命令（给本文件里装 uv 用）。 */
function run(cmd, args, { env, log, timeoutMs = 30 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env } })
    let tail = ''
    const feed = (buf) => { tail = (tail + String(buf)).slice(-4000) }
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    const timer = setTimeout(() => { try { child.kill() } catch (error) {} }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(tail)
      else {
        log?.debug?.(`${basename(cmd)} 失败（code ${code}）：${tail.slice(-800)}`)
        reject(new Error(`${basename(cmd)} 退出码 ${code}：${tail.trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 300)}`))
      }
    })
  })
}

/**
 * 每个功能跑 uv 时都带上的环境变量：Python 装在共用目录、连快捷方式也不往 ~/.local/bin 放、只用 uv 自己装的 Python。
 * @param {{ cache: string, cn?: boolean, downloads?: 'automatic'|'manual'|'never' }} o  cache：这次的下载缓存放哪（各功能自己的目录里）
 */
export function uvBaseEnv({ cache, cn = false, downloads } = {}) {
  return {
    UV_CACHE_DIR: cache,
    UV_HTTP_TIMEOUT: '300',
    UV_HTTP_RETRIES: '6',
    UV_PYTHON_INSTALL_DIR: sharedPythonDir(),
    UV_PYTHON_BIN_DIR: join(sharedPythonDir(), 'bin'),
    UV_PYTHON_PREFERENCE: 'only-managed', // 不拿 Homebrew / 系统的 Python（那些一升级环境就坏）
    ...(downloads ? { UV_PYTHON_DOWNLOADS: downloads } : {}),
    ...(cn ? { UV_PYTHON_INSTALL_MIRROR: CN_PYTHON } : {}),
  }
}

/** 共用的 uv：没有就下载固定版本放进共用目录（带校验）。 */
export function sharedUv(o = {}) {
  return ensurePinnedUv(sharedUvDir(), o)
}

// 国内镜像：PyPI 用阿里云，Python 本体用 npmmirror
export const CN_PYPI = 'https://mirrors.aliyun.com/pypi/simple'
export const CN_PYTHON = 'https://registry.npmmirror.com/-/binary/python-build-standalone'

/** 自动模式下判断要不要用国内镜像：官方源 4 秒内连不上或者很慢就用。 */
export async function shouldUseCnMirror(mode, fetchImpl = fetch) {
  if (mode === 'cn' || mode === 'tuna') return true
  if (mode === 'off') return false
  const probe = async (url) => {
    const t = Date.now()
    try {
      const r = await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(4000) })
      return r.status < 500 ? Date.now() - t : Infinity
    } catch (error) {
      return Infinity
    }
  }
  const times = await Promise.all([probe('https://pypi.org/simple/pip/'), probe('https://huggingface.co/'), probe('https://github.com/')])
  return times.some((t) => t > 2500)
}

// uv 的下载源：PyPI 上的 uv 0.13.7 安装包（wheel 就是 zip，里面带 uv 程序），先走国内镜像。
// Apple 芯片 / Intel 各一份，校验值取自 PyPI 官方。
const UV_WHEELS = {
  arm64: ['packages/40/a5/8756c38ace102fa13fd4e653e8bc40e1f65924f1c0a0d23350339dac97e5/uv-0.13.7-py3-none-macosx_11_0_arm64.whl', 'f91a229093163eefca89ea1b220a221d64c3beade05d03519a6584d1797a5a5f'],
  x64: ['packages/3d/5b/e0379e7b172659420b1ec99a8e8229830aa85ea59684847c80b1c959a056/uv-0.13.7-py3-none-macosx_10_12_x86_64.whl', 'fd04bf01ba5f2829f4f94ca8f0c24a743f21e73d75045613ed6fc2fd66fc7bda'],
}
/** 这台 Mac 能用的 uv 下载源（按顺序试）；没有对应的安装包时返回空数组。 */
export function uvSources(arch = process.arch) {
  const hit = UV_WHEELS[arch]
  if (!hit) return []
  const [wheel, sha256] = hit
  return [{ url: `https://mirrors.aliyun.com/pypi/${wheel}`, sha256 }, { url: `https://files.pythonhosted.org/${wheel}`, sha256 }]
}
export const UV_SOURCES = uvSources()

/** 电脑上已经装好的 uv：PATH、Homebrew、官方安装脚本的位置（从程序坞打开的 DSH，PATH 里通常没有 Homebrew）。找不到返回 ''。 */
export async function findSystemUv({ log } = {}) {
  const cands = ['uv', '/opt/homebrew/bin/uv', '/usr/local/bin/uv', join(homedir(), '.local', 'bin', 'uv'), join(homedir(), '.cargo', 'bin', 'uv')]
  for (const c of cands) {
    if (c !== 'uv' && !existsSync(c)) continue
    try {
      await run(c, ['--version'], { log, timeoutMs: 15_000 })
      return c
    } catch (error) {}
  }
  return ''
}

/**
 * 准备 uv（装 Python 和各种包的工具），所有功能共用：
 * binDir/uv 已经有了就用它；没有就下载固定版本（uvSources，带校验）放进去，这样每台 Mac 装出来的都一样；
 * 下载不成才退回电脑上已经装好的 uv。都没有就抛错。
 * @param {string} binDir 放 uv 的文件夹（一般是 sharedUvDir()）
 * @param {object} [o]
 * @param {(s: string) => void} [o.note] 进度说明
 * @param {(url: string, dest: string) => Promise<void>} [o.download] 下载一个文件（默认用系统自带的 curl）
 */
export async function ensurePinnedUv(binDir, { note = () => {}, log, download } = {}) {
  if (process.env.AURABOT_UV) return process.env.AURABOT_UV
  const local = join(binDir, 'uv')
  if (existsSync(local)) return local
  const work = join(dirname(binDir), 'downloads-uv')
  const zip = join(work, 'uv.zip')
  const tmp = join(work, 'uv')
  const get = download || (async (url, dest) => {
    mkdirSync(dirname(dest), { recursive: true })
    rmSync(dest, { force: true })
    await run('curl', ['-fL', '--retry', '3', '--max-time', '300', '-o', dest, url], { log, timeoutMs: 360_000 })
  })
  let lastError = null
  const sources = uvSources()
  if (sources.length) note('  下载 uv（固定版本）')
  try {
    for (const src of sources) {
      try {
        await get(src.url, zip)
        if (!existsSync(zip) || !statSync(zip).size) throw new Error('没下载下来')
        if (createHash('sha256').update(readFileSync(zip)).digest('hex') !== src.sha256) throw new Error('下载的文件校验对不上')
        rmSync(tmp, { recursive: true, force: true })
        extractZip(readFileSync(zip), tmp)
        const exe = findFile(tmp, 'uv')
        if (!exe) throw new Error('里面没找到 uv')
        mkdirSync(binDir, { recursive: true })
        copyFileSync(exe, local)
        chmodSync(local, 0o755)
        return local
      } catch (error) {
        lastError = error
        note(`  从 ${new URL(src.url).host} 下 uv 没成功（${error.message.slice(0, 80)}），换一个源`)
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  const sys = await findSystemUv({ log })
  if (sys) { note(`  改用电脑上已经装好的 uv：${sys}`); return sys }
  if (!sources.length) throw new Error(`没有适合这台电脑（${process.platform}-${process.arch}）的 uv 安装包，请先自己装好 uv（https://docs.astral.sh/uv/）`)
  throw new Error('uv 下载失败：' + (lastError?.message || ''))
}
/**
 * 把 zip 解到目录里（不靠外部工具）。拒绝跳出目标目录的路径；
 * bin/ 里的文件和没有扩展名的程序（uv、ffmpeg 等）加上可执行权限。
 */
export function extractZip(buf, dir) {
  const root = resolvePath(dir)
  mkdirSync(root, { recursive: true })
  for (const f of readZip(buf)) {
    const dest = resolvePath(root, f.name.replace(/\\/g, '/'))
    if (dest !== root && !dest.startsWith(root + sep)) throw new Error(`压缩包里有越界路径：${f.name}`)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, f.data)
    if ((/(^|\/)(bin|scripts)\//i.test(f.name) || !/\.[a-z0-9]{1,5}$/i.test(basename(f.name)))) {
      try { chmodSync(dest, 0o755) } catch (error) {}
    }
  }
}

/** 在目录里（含子目录）找一个文件名。 */
export function findFile(dir, name) {
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    let names
    try { names = readdirSync(d, { withFileTypes: true }) } catch (error) { continue }
    for (const e of names) {
      const full = join(d, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.name.toLowerCase() === name) return full
    }
  }
  return ''
}

