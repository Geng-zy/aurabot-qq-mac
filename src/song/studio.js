// 翻唱：点歌 → 下载（网易云）→ 分离人声和伴奏 → RVC 换成她的声音 → 混音 → 截成语音条发回去。
// 推理引擎用 Applio（MIT，固定版本），人声分离用 audio-separator，都装在一个独立的 Python 环境里，不碰系统环境。

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, statfsSync, writeFileSync, readFileSync, rmSync, copyFileSync, renameSync, openSync, readSync, closeSync, chmodSync } from 'node:fs'
import { join, basename, dirname, isAbsolute, delimiter, resolve as resolvePath, sep, win32 as winPath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { dataDir, readJson, writeJson } from '../core/store.js'
import { searchSongs, songUrl, account } from './netease.js'
import { readZip } from './zip.js'
import { findLocalSong, MUSIC_DIR } from './local_music.js'
import { findFfmpeg } from '../core/img.js'
import { runPipeline, ENHANCE_DEFAULTS } from './pipeline.js'

export const APPLIO_REPO = 'https://github.com/IAHispano/Applio.git'
export const APPLIO_COMMIT = 'c817f1f83f689ef72e0dfeb1c17ae990b9248506'
// macOS 用 Applio 3.7.1 正式版（tag 3.7.1 的提交），并按 Applio 官方 Mac 安装方式给它建自己的环境（见 MAC_STACK）
export const APPLIO_COMMIT_MAC = '6f69726b140c615c8cc6831a7db8b7c5e48ba8af'
export const applioCommit = (platform = process.platform) => (platform === 'darwin' ? APPLIO_COMMIT_MAC : APPLIO_COMMIT)
/**
 * macOS 一键安装装的版本（2026-11-08 在 Apple 芯片 Mac 上实际跑通整套翻唱的组合）。两套环境：
 * - Applio/.venv：照 Applio 3.7.1 官方 run-install.sh 的 Mac 做法（uv venv + python-ffmpeg + requirements.txt，torch 2.11）
 * - env/：只装人声分离。audio-separator 0.48 在 Apple 芯片上要 torch ≥ 2.13，和 Applio 锁的 torch 2.11 装不到一起；
 *   硬装进一套会退到 audio-separator 0.45，实测 Leap Xe 等 Roformer 模型分离直接失败。
 */
export const MAC_STACK = {
  python: '3.12.16',
  applioExtras: ['python-ffmpeg==2.0.12'],
  separator: ['audio-separator[cpu]==0.48.0', 'librosa==0.11.0', 'imageio-ffmpeg==0.8.1'],
}
export const pythonVersion = (platform = process.platform) => (platform === 'darwin' ? MAC_STACK.python : '3.12')
const TORCH_INDEX = 'https://download.pytorch.org/whl/cu128'
// 国内镜像：PyPI 和 PyTorch 都用阿里云（PyTorch 那边是文件列表，用 --find-links；Applio 固定了 torch 版本，挑得到 cu128 的），Python 本体用 npmmirror
const CN_PYPI = 'https://mirrors.aliyun.com/pypi/simple'
const CN_TORCH = 'https://mirrors.aliyun.com/pytorch-wheels/cu128/'
const CN_PYTHON = 'https://registry.npmmirror.com/-/binary/python-build-standalone'

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
  const times = await Promise.all([probe('https://pypi.org/simple/pip/'), probe(TORCH_INDEX + '/torch/'), probe('https://github.com/')])
  return times.some((t) => t > 2500)
}
const LEGACY_ROOT = 'C:\\Aurabot\\rvc'

// RVC 推理要的预训练文件（Applio 放在 HuggingFace 上）：[远端相对路径, 本地相对 Applio 的路径]
const PREREQS = [
  ['predictors/rmvpe.pt', 'rvc/models/predictors/rmvpe.pt'],
  ['embedders/contentvec/config.json', 'rvc/models/embedders/contentvec/config.json'],
  ['embedders/contentvec/pytorch_model.bin', 'rvc/models/embedders/contentvec/pytorch_model.bin'],
]
// 国内直连 HuggingFace 常常很慢：先试镜像，太慢或卡住再换官方
const HF_HOSTS = ['https://hf-mirror.com', 'https://huggingface.co']

const FETCH_SCRIPT = fileURLToPath(new URL('./fetch_file.py', import.meta.url))

/**
 * 下载一个预训练文件：已经有了就跳过。用翻唱环境里的 Python 下（会走系统代理），
 * 断了从断点接着下，卡住 30 秒就换下一个源，几轮都不行才算失败。
 */
async function downloadWithMirror(python, rel, dest, note, log, onProgress) {
  return fetchFile(python, dest, HF_HOSTS.map((host) => `${host}/IAHispano/Applio/resolve/main/Resources/${rel}`), note, log, onProgress, rel)
}

// uv 的下载源：PyPI 上的 uv 安装包（Windows 固定 0.13.5 同原版；macOS 固定 0.13.7，是 Mac 上实际跑通的版本。wheel 就是 zip，里面带 uv 程序）走国内镜像，最后才试 GitHub。
// Windows / macOS（Apple 芯片、Intel）各一份，校验值取自 PyPI 官方。
const UV_WHEELS = {
  'win32-x64': ['packages/32/ea/771744a784b16aa21d195cb5d5d5a2878d72fa00fc26f11ea3f9646994fe/uv-0.13.5-py3-none-win_amd64.whl', '1fb29fc46ba12033e2ef95a95ac79d649e71bbb1358419bbbcbd19d86026ef2f', 'uv-x86_64-pc-windows-msvc.zip'],
  'darwin-arm64': ['packages/40/a5/8756c38ace102fa13fd4e653e8bc40e1f65924f1c0a0d23350339dac97e5/uv-0.13.7-py3-none-macosx_11_0_arm64.whl', 'f91a229093163eefca89ea1b220a221d64c3beade05d03519a6584d1797a5a5f', ''],
  'darwin-x64': ['packages/3d/5b/e0379e7b172659420b1ec99a8e8229830aa85ea59684847c80b1c959a056/uv-0.13.7-py3-none-macosx_10_12_x86_64.whl', 'fd04bf01ba5f2829f4f94ca8f0c24a743f21e73d75045613ed6fc2fd66fc7bda', ''],
}
/** 这台电脑能用的 uv 下载源（按顺序试）；没有对应的安装包时返回空数组。 */
export function uvSources(platform = process.platform, arch = process.arch) {
  const hit = UV_WHEELS[`${platform}-${arch}`] || (platform === 'win32' ? UV_WHEELS['win32-x64'] : null)
  if (!hit) return []
  const [wheel, sha256, ghZip] = hit
  return [
    { url: `https://mirrors.aliyun.com/pypi/${wheel}`, sha256 },
    { url: `https://files.pythonhosted.org/${wheel}`, sha256 },
    ...(ghZip ? [{ url: `https://github.com/astral-sh/uv/releases/latest/download/${ghZip}` }] : []),
  ]
}
export const UV_SOURCES = uvSources()

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
/** 可执行文件名：Windows 带 .exe，macOS / Linux 不带。 */
export const exeName = (name, platform = process.platform) => (platform === 'win32' ? name + '.exe' : name)

/**
 * 把 zip 解到目录里（不靠 PowerShell，各系统通用）。拒绝跳出目标目录的路径；
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
    if (!IS_WIN && (/(^|\/)(bin|scripts)\//i.test(f.name) || !/\.[a-z0-9]{1,5}$/i.test(basename(f.name)))) {
      try { chmodSync(dest, 0o755) } catch (error) {}
    }
  }
}

/** 在目录里（含子目录）找一个文件名。 */
function findFile(dir, name) {
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

/** 默认分离模型的文件都在不在。 */
export function separatorReady(dir, model) {
  const files = SEPARATOR_FILES[model]
  if (!files) return existsSync(join(dir, model))
  return files.every(([name]) => existsSync(join(dir, name)) && statSync(join(dir, name)).size > 0)
}

/** 下载一个文件：已经有了就跳过；地址按顺序轮流试，断了接着下，走系统代理。 */
async function fetchFile(python, dest, urls, note, log, onProgress, label = basename(dest), sha256 = '') {
  const rel = label
  if (existsSync(dest) && statSync(dest).size > 0) return
  // 上次没下完的（.download）会接着下
  const part = dest + '.download'
  note?.(existsSync(part) ? `接着下 ${rel}（上次下到 ${Math.round(statSync(part).size / 1048576)} MB）` : `下载 ${rel}`)
  let lastPct = -1
  await run(python, [FETCH_SCRIPT, ...(sha256 ? ['--sha256', sha256] : []), dest, ...urls], {
    log,
    env: { PYTHONIOENCODING: 'utf-8' },
    timeoutMs: 2 * 3600_000,
    onLine: (line) => {
      const m = line.match(/^progress (\d+) (\d+)/)
      if (m && Number(m[2])) {
        onProgress?.(Number(m[1]), Number(m[2]))
        const pct = Math.floor((Number(m[1]) / Number(m[2])) * 10) * 10
        if (pct !== lastPct) { lastPct = pct; note?.(`  ${rel}：${pct}%`) }
      } else if (/^retry /.test(line)) note?.('  ' + line.replace(/^retry /, '断了，换个源接着下：'))
    },
  })
}

/** 模型文件能不能读：刚下完/导入的大文件常被杀毒软件锁住几秒，等一等再试，还不行就报出是哪个文件。 */
export async function ensureReadable(files, tries = 4, waitMs = 3000) {
  for (const f of files) {
    if (!existsSync(f)) continue
    for (let i = 1; ; i++) {
      try {
        const fd = openSync(f, 'r')
        try { readSync(fd, Buffer.alloc(16), 0, 16, 0) } finally { closeSync(fd) }
        break
      } catch (error) {
        if (i >= tries || !/EACCES|EPERM|EBUSY/.test(error.code || '')) throw new Error(`Permission denied: '${f}'（${error.code || error.message}）`)
        await new Promise((r) => setTimeout(r, waitMs))
      }
    }
  }
}

/** 一个目录（含子目录）有多大，字节。目录不存在算 0。 */
export function dirSize(dir) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    let names
    try { names = readdirSync(d, { withFileTypes: true }) } catch (error) { continue }
    for (const e of names) {
      const full = join(d, e.name)
      if (e.isDirectory()) stack.push(full)
      else try { total += statSync(full).size } catch (error) {}
    }
  }
  return total
}

/** 翻唱环境的根目录：Windows 老安装沿用 C:\Aurabot\rvc，新安装放用户目录下（macOS 是 ~/Aurabot/rvc）。 */
export function defaultRoot() {
  return IS_WIN && existsSync(LEGACY_ROOT) ? LEGACY_ROOT : join(homedir(), 'Aurabot', 'rvc')
}

/**
 * 检查安装位置：要绝对路径；中文、空格可能让一些工具出问题，提醒一下；顺便看看那个盘还剩多少空间（装完约 8 GB）。
 * @returns {{ok: boolean, path: string, message: string, warn: string, freeGB: number|null}}
 */
/** 把安装时的报错翻译成人话，并告诉用户接下来怎么办。 */
export function explainInstallError(msg) {
  const m = String(msg || '')
  if (/ENOENT/.test(m)) return `找不到需要的程序（${(m.match(/spawn (\S+)/) || [])[1] || '?'}）。点「重新检查 / 修复安装」再试一次；还不行就把报错发给作者`
  if (/ENOSPC|No space|磁盘空间|not enough space/i.test(m)) return '磁盘空间不够了。换一个空间大的盘（上面「装到哪里」），保存后再装'
  if (/timed? ?out|超时|30 秒没进度|operation timed/i.test(m)) return '网络太慢、超时了。打开「用国内镜像下载」或者开着代理，再点安装（已下好的不会重下）'
  if (/connection|connect|reset|TLS|SSL|dns|resolve|Failed to fetch|Failed to download|error sending request|无法连接|网络/i.test(m)) return '网络连接断了。打开「用国内镜像下载」或者开着代理，再点安装（已下好的不会重下）'
  if (/CUDA|nvidia|GPU/i.test(m)) return '和显卡驱动有关，可能需要更新 NVIDIA 驱动。' + m.slice(0, 160)
  return m.slice(0, 300)
}

/**
 * 人声分离装哪个版本：Windows 用 [gpu]（NVIDIA 显卡加速）；macOS 没有 NVIDIA 显卡，[gpu] 依赖的 onnxruntime-gpu
 * 在 Mac 上根本装不了，用 [cpu]（PyTorch 在 Apple 芯片上仍会走 MPS 加速）。
 */
export const installExtras = (platform = process.platform) => (platform === 'darwin' ? [...MAC_STACK.separator] : ['audio-separator[gpu]'])

/** PyTorch 从哪下：CUDA 版只有 Windows / Linux 有；macOS 用 PyPI 上的官方版（自带 Apple 芯片加速）。 */
export const torchSource = (cn, platform = process.platform) =>
  platform === 'darwin' ? [] : cn ? ['--find-links', CN_TORCH] : ['--extra-index-url', TORCH_INDEX]

/** 安装的几步（面板按这个画步骤条）。 */
export const INSTALL_STEPS = ['创建 Python 环境', '下载 Applio（RVC 推理引擎）', '安装 PyTorch、RVC 和人声分离（最大的一步）', '准备 ffmpeg', '下载 RVC 需要的预训练文件（音高、音色特征）', '下载人声分离模型']

// 默认人声分离模型要的文件：[文件名, 下载地址（按顺序试）, sha256]。提前下好，免得第一次点歌时卡着不动。
// 模型 640 MB，GitHub 在国内经常下不动：先走 HuggingFace 镜像（有人转存了同一个文件，校验值一样），再试官方。
// 下完核对 sha256，哪个源给的文件不对就换下一个；配置文件很小，随插件带着（src/song/separator/）。
const GH_UVR = 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models'
const GH_AS = 'https://github.com/nomadkaraoke/python-audio-separator/releases/download/model-configs'
const HF_SEP = ['Politrees/UVR_resources/resolve/main/models/Roformer/BandSplit', 'datasets/SayanoAI/RVC-Studio/resolve/main/UVR']
const BS_ROFORMER = 'model_bs_roformer_ep_317_sdr_12.9755'
export const SEPARATOR_FILES = {
  [`${BS_ROFORMER}.ckpt`]: [
    [`${BS_ROFORMER}.ckpt`, [
      ...HF_SEP.map((p) => `https://hf-mirror.com/${p}/${BS_ROFORMER}.ckpt`),
      `${GH_UVR}/${BS_ROFORMER}.ckpt`,
      `https://huggingface.co/${HF_SEP[0]}/${BS_ROFORMER}.ckpt`,
      `${GH_AS}/${BS_ROFORMER}.ckpt`,
    ], '5b84f37e8d444c8cb30c79d77f613a41c05868ff9c9ac6c7049c00aefae115aa'],
    [`${BS_ROFORMER}.yaml`, [`${GH_AS}/${BS_ROFORMER}.yaml`], '2bfdd16c656bd9519aba757cc4f8834b7ede675eb1e00ec4772d74ae1c41af7f'],
  ],
}
const BUNDLED_SEP = fileURLToPath(new URL('./separator/', import.meta.url))
const SEPARATOR_RUN = fileURLToPath(new URL('./separator_run.py', import.meta.url))

/**
 * 安装目录 bin/ 里没有 ffmpeg 时，用系统里装好的（PATH、Homebrew 等常见位置，见 core/img.js）。
 * macOS 上很多人已经用 Homebrew 装了 ffmpeg，不必再复制一份。都找不到就保持原路径（面板显示「缺 ffmpeg」）。
 */
export function withSystemFfmpeg(p, { exists = existsSync, find = findFfmpeg } = {}) {
  if (exists(p.ffmpeg)) return p
  const sys = find()
  return sys ? { ...p, ffmpeg: sys } : p
}

/**
 * 怎么调人声分离：分离模型文件夹里有 extra-models.json（登记了清单外的模型，比如 Leap Xe）时，
 * 用环境里的 Python 跑插件自带的 separator_run.py，它先把这些模型补进 audio-separator 的清单；没有就直接调 audio-separator。
 * @returns {[string, string[]]} [程序, 参数]
 */
export function separatorCommand(p, args) {
  return existsSync(join(p.separatorModels, 'extra-models.json')) ? [p.python, [SEPARATOR_RUN, ...args]] : [p.separatorExe, args]
}

/** 手动下载用的地址（面板里给用户复制，用浏览器或下载工具下好再拖进来）。 */
export function separatorLinks(model) {
  return (SEPARATOR_FILES[model] || []).slice(0, 1).flatMap(([, urls]) => urls.slice(0, 3))
}

/**
 * 导入手动下好的分离模型：核对 sha256，对得上才放进去。
 * @returns {{ok:boolean, message:string}}
 */
export function importSeparator(dir, filename, buf) {
  const sha = createHash('sha256').update(buf).digest('hex')
  for (const files of Object.values(SEPARATOR_FILES)) {
    const hit = files.find(([, , want]) => want === sha)
    if (hit) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, hit[0]), buf)
      rmSync(join(dir, hit[0] + '.download'), { force: true })
      return { ok: true, message: `人声分离模型导入好了（${hit[0]}）` }
    }
  }
  return { ok: false, message: `「${filename}」不是插件要的人声分离模型（校验对不上），要下 ${BS_ROFORMER}.ckpt` }
}
// 分离工具每次运行都要的模型清单（缺了会去 raw.githubusercontent.com 拉，国内常常连不上）
const SEPARATOR_LIST = ['download_checks.json', ['https://raw.githubusercontent.com/TRvlvr/application_data/main/filelists/download_checks.json', 'https://cdn.jsdelivr.net/gh/TRvlvr/application_data@main/filelists/download_checks.json']]

/** 电脑上的盘和剩余空间，给面板「装到哪个盘」用：[{drive, root, freeGB, totalGB}] */
export function listDrives(platform = process.platform) {
  const out = []
  // 只有 Windows 有盘符；macOS / Linux 面板里直接填路径
  if (platform !== 'win32') return out
  for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const d = `${L}:\\`
    try {
      if (!existsSync(d)) continue
      const s = statfsSync(d)
      const gb = (n) => Math.round((Number(n) * Number(s.bsize)) / 1024 ** 3 * 10) / 10
      if (!s.blocks) continue
      out.push({ drive: `${L}:`, root: `${L}:\\Aurabot\\rvc`, freeGB: gb(s.bavail), totalGB: gb(s.blocks) })
    } catch (error) {}
  }
  return out
}

/** 面板里「装到哪里」的示例路径。 */
export const rootExample = (platform = process.platform) => (platform === 'win32' ? 'D:\\Aurabot\\rvc' : join(homedir(), 'Aurabot', 'rvc'))

export function checkRoot(path, platform = process.platform) {
  const p = String(path || '').trim()
  if (!p) return { ok: true, path: '', message: '', warn: '', freeGB: null }
  const absolute = platform === 'win32' ? winPath.isAbsolute(p) && /^[A-Za-z]:\\/.test(p.replace(/\//g, '\\')) : p.startsWith('/')
  if (!absolute) return { ok: false, path: p, message: `要写完整路径，比如 ${rootExample(platform)}`, warn: '', freeGB: null }
  const warn = /[^\x21-\x7e]/.test(p) ? '路径里有中文或空格，个别工具可能出问题，最好换成全英文、不带空格的路径' : ''
  let freeGB = null
  try {
    // 往上找到第一个存在的目录来量剩余空间
    let probe = p
    while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe)
    const s = statfsSync(probe)
    freeGB = Math.round((Number(s.bavail) * Number(s.bsize)) / 1024 ** 3 * 10) / 10
  } catch (error) {}
  return { ok: true, path: p, message: '', warn: warn || (freeGB !== null && freeGB < 10 ? `这个盘只剩 ${freeGB} GB，装完要 8 GB 左右，安装时还要临时多占几 GB` : ''), freeGB }
}

/** 翻唱环境里各个程序的位置。Windows 的虚拟环境放在 Scripts\，macOS / Linux 放在 bin/。 */
export function pathsOf(root, platform = process.platform) {
  const win = platform === 'win32'
  const envBin = join(root, 'env', win ? 'Scripts' : 'bin')
  return {
    root,
    python: join(envBin, exeName('python', platform)),
    separatorExe: join(envBin, exeName('audio-separator', platform)),
    applio: join(root, 'Applio'),
    models: join(root, 'models'),
    separatorModels: join(root, 'separator-models'),
    bin: join(root, 'bin'),
    ffmpeg: join(root, 'bin', exeName('ffmpeg', platform)),
    rmvpe: join(root, 'Applio', 'rvc', 'models', 'predictors', 'rmvpe.pt'),
    contentvec: join(root, 'Applio', 'rvc', 'models', 'embedders', 'contentvec', 'pytorch_model.bin'),
  }
}

/** models 目录里的音色：[{id, pth, index}]，同名 .index 可选。 */
export function listVoices(modelsDir) {
  let names = []
  try { names = readdirSync(modelsDir) } catch (error) { return [] }
  return names.filter((n) => n.toLowerCase().endsWith('.pth')).sort().map((n) => {
    const id = n.slice(0, -4)
    const idx = names.find((m) => m.toLowerCase().endsWith('.index') && m.toLowerCase().includes(id.toLowerCase()))
    // 音色档案（音域 + 音色参照，voice_profile.py 生成）：<音色>.profile.json，有它才自动定调、挪八度、校正音色
    const prof = join(modelsDir, id + '.profile.json')
    return { id, pth: join(modelsDir, n), index: idx ? join(modelsDir, idx) : '', profile: existsSync(prof) ? prof : '' }
  })
}

/**
 * 换声用哪个 Python：Applio 自己的环境（Applio 文件夹里的 .venv，按 Applio 官方安装脚本装的）优先，
 * 没有就用翻唱环境 env/（一键安装把 Applio 依赖和人声分离装在同一个环境里）。
 */
export function applioPython(p, { platform = process.platform, exists = existsSync } = {}) {
  const own = join(p.applio, '.venv', platform === 'win32' ? 'Scripts' : 'bin', exeName('python', platform))
  return exists(own) ? own : p.python
}

/** 找 rubberband（伴奏变调用）：翻唱环境 bin/、PATH、Homebrew 常见位置。找不到返回 ''（自动定调时只挪八度，整首不挪）。 */
export function findRubberband(p, { pathEnv = process.env.PATH || '', exists = existsSync, platform = process.platform } = {}) {
  const name = exeName('rubberband', platform)
  const cands = [join(p.bin, name), ...String(pathEnv).split(platform === 'win32' ? ';' : ':').filter(Boolean).map((d) => join(d, name)),
    ...(platform === 'win32' ? [] : ['/opt/homebrew/bin/rubberband', '/usr/local/bin/rubberband'])]
  return cands.find((c) => { try { return exists(c) } catch (error) { return false } }) || ''
}

/** 像不像 RVC 模型：PyTorch 存的 .pth 要么是 zip 格式（PK 开头），要么是老的 pickle（0x80 开头）。 */
export function looksLikePth(buf) {
  return buf.length > 1024 * 1024 && ((buf[0] === 0x50 && buf[1] === 0x4b) || buf[0] === 0x80)
}

const safeName = (n) => basename(String(n).replace(/\\/g, '/')).replace(/[<>:"|?*\x00-\x1f]/g, '_').trim()

/**
 * 导入音色：.pth / .index，或者装着它们的 zip。存进 models 目录。
 * zip 里只有一个音色时，index 自动改名成「音色名.index」配上。
 * @returns {{ok: boolean, added: string[], indexes: number, message: string}}
 */
export function importModels(modelsDir, filename, buf) {
  const name = safeName(filename)
  const lower = name.toLowerCase()
  let files
  if (lower.endsWith('.zip')) {
    files = readZip(buf, (n) => /\.(pth|index)$/i.test(n) && !n.includes('__MACOSX')).map((f) => ({ name: safeName(f.name), data: f.data }))
  } else if (lower.endsWith('.pth') || lower.endsWith('.index')) {
    files = [{ name, data: buf }]
  } else {
    return { ok: false, added: [], indexes: 0, message: '只支持 .zip、.pth、.index 文件' }
  }
  const pths = files.filter((f) => f.name.toLowerCase().endsWith('.pth'))
  const idxs = files.filter((f) => f.name.toLowerCase().endsWith('.index'))
  if (!pths.length && !idxs.length) return { ok: false, added: [], indexes: 0, message: '里面没找到 .pth 模型' }
  const bad = pths.filter((f) => !looksLikePth(f.data))
  if (bad.length) return { ok: false, added: [], indexes: 0, message: `「${bad[0].name}」看起来不是 RVC 模型` }
  mkdirSync(modelsDir, { recursive: true })
  for (const f of pths) writeFileSync(join(modelsDir, f.name), f.data)
  const solo = pths.length === 1 ? pths[0].name.slice(0, -4) : ''
  for (const f of idxs) writeFileSync(join(modelsDir, solo && idxs.length === 1 ? `${solo}.index` : f.name), f.data)
  const added = pths.map((f) => f.name.slice(0, -4))
  return {
    ok: true,
    added,
    indexes: idxs.length,
    message: added.length ? `导入了 ${added.length} 个音色：${added.join('、')}${idxs.length ? `（带 ${idxs.length} 个 index）` : ''}` : `导入了 ${idxs.length} 个 index`,
  }
}

/** 删掉一个音色（连同配套的 index）。 */
export function deleteVoice(modelsDir, id) {
  const v = listVoices(modelsDir).find((x) => x.id === id)
  if (!v) return { ok: false, message: '没有这个音色' }
  rmSync(v.pth, { force: true })
  if (v.index) rmSync(v.index, { force: true })
  return { ok: true, message: `删掉了「${id}」` }
}

/** 缓存目录只留最新的 keep 个文件。 */
export function pruneCache(dir, keep) {
  let files = []
  try { files = readdirSync(dir).map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs })) } catch (error) { return 0 }
  const old = files.sort((a, b) => b.t - a.t).slice(keep)
  for (const f of old) rmSync(join(dir, f.n), { force: true })
  return old.length
}

/** 截一段：歌比上限长时从「大约副歌」的位置开始（全曲 30% 处），否则从头。 */
/** 分出来的人声轨平均音量低于这个就当没有人声。正常人声在 -15 ~ -30 dB，纯音乐分出来是 -80 以下。 */
export const VOCAL_MIN_DB = -50

/** 混音的 ffmpeg 参数。没有 inst 就是清唱，只留她的人声。 */
export function mixArgs({ vocals, inst, vol, iv, out }) {
  const head = ['-y', '-hide_banner', '-loglevel', 'error', '-i', vocals]
  // 320k：发出去的是 QQ 语音条，QQ 还会再压一遍，源头码率高一点听着没那么「劣质」
  const tail = ['-ac', '2', '-ar', '44100', '-b:a', '320k', out]
  if (!inst) return [...head, '-af', `volume=${vol},alimiter=limit=0.95`, ...tail]
  return [...head, '-i', inst, '-filter_complex', `[0:a]volume=${vol}[v];[1:a]volume=${iv}[i];[v][i]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95`, ...tail]
}

const INSTRUMENTAL = /纯音乐|伴奏|钢琴|吉他|八音盒|音乐盒|古筝|琵琶|二胡|笛子|葫芦丝|小提琴|大提琴|口琴|萨克斯|instrumental|off ?vocal|karaoke|\binst\b|\bbgm\b|music box|piano/i

/** 搜索结果排序：标题像纯音乐（钢琴版、伴奏……）的放到最后，除非点歌时本来就这么说。其余保持网易云的顺序。 */
export function rankCandidates(list, query = '') {
  const want = INSTRUMENTAL.test(query)
  const bad = (s) => !want && INSTRUMENTAL.test(`${s.name} ${s.alias || ''}`)
  return [...list.filter((s) => !bad(s)), ...list.filter(bad)]
}

export function clipWindow(durationSec, maxSec, start = 'auto') {
  if (!(durationSec > maxSec)) return { start: 0, length: durationSec }
  if (start === 'head') return { start: 0, length: maxSec }
  const s = Math.max(0, Math.min(Math.round(durationSec * 0.3), Math.floor(durationSec - maxSec)))
  return { start: s, length: maxSec }
}

function run(cmd, args, { cwd, env, log, onLine, timeoutMs = 30 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, windowsHide: true })
    let tail = ''
    const feed = (buf) => {
      const s = String(buf)
      tail = (tail + s).slice(-4000)
      for (const line of s.split(/\r?\n|\r/)) if (line.trim()) onLine?.(line.trim())
    }
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    const timer = setTimeout(() => { try { child.kill() } catch (error) {} }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(tail)
      else {
        log?.debug(`${basename(cmd)} 失败（code ${code}）：${tail.slice(-800)}`)
        reject(new Error(`${basename(cmd)} 退出码 ${code}：${tail.trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 300)}`))
      }
    })
  })
}

/**
 * @param {object} deps
 * @param {() => object} deps.getConfig
 * @param {object} deps.log
 * @param {(chatId: string, file: string, note: string) => Promise<any>} deps.sendVoiceFile  把做好的语音发到聊天
 * @param {(chatId: string, text: string) => Promise<any>} [deps.sendText]
 */
/** 翻唱出错翻译成人话（给点歌的人看）。 */
export function explainSongError(message) {
  const m = String(message || '')
  if (/size mismatch|Error\(s\) in loading state_dict|unexpected key|Missing key|KeyError: '(weight|config|params)'/i.test(m)) return '这个音色模型和内置的 RVC 不兼容（可能是 so-vits-svc 之类训练的，或者不是完整的模型文件）。可以在面板「本地接口」里接你自己的推理'
  if (/CUDA out of memory|OutOfMemoryError|not enough memory/i.test(m)) return '显卡显存不够，关掉别的占显存的程序（游戏、别的 AI）再试'
  if (/No module named|ModuleNotFoundError/i.test(m)) return '翻唱环境不完整，在面板「翻唱」页点「重新检查 / 修复安装」'
  if (/Permission denied|Errno 13|EACCES|EPERM|EBUSY/i.test(m)) {
    const file = (m.match(/'([^']+\.(?:ckpt|pth|onnx|yaml|json))'/i) || [])[1]?.replace(/\\\\/g, '\\')
    return `${file ? `读不了「${file}」` : '有个模型文件读不了'}：多半是杀毒软件（360、火绒、Defender）正在扫描或拦住了它，或者文件是用管理员身份放进去的。把翻唱目录加进杀毒软件的信任区再试；还不行就删掉这个文件，在面板「翻唱」页重新下载`
  }
  return m
}

export function createSongStudio({ getConfig, log, sendVoiceFile, sendText, onSung, local }) {
  const cfg = () => getConfig().song
  const P = () => withSystemFfmpeg(pathsOf(cfg().root || defaultRoot()))
  const work = () => dataDir('songs')
  // 确认过没有人声的歌（网易云 id），下次直接跳过，不用再花几分钟分离一遍
  const noVocalFile = () => join(work(), 'no-vocals.json')
  const noVocals = () => readJson(noVocalFile(), () => [])
  const markNoVocals = (id) => { if (id && !noVocals().includes(String(id))) writeJson(noVocalFile(), [...noVocals(), String(id)].slice(-500)) }
  const queue = []
  let current = null // 正在做的翻唱
  let history = [] // 最近做过的 [{at, title, voice, ok, message, file}]
  let install = { running: false, step: '', log: [], ok: null, message: '' }
  let profileJob = null // 正在生成的音色档案 {id, folder, running, ok, message, at}

  function status() {
    const p = P()
    const voices = listVoices(p.models)
    const parts = {
      python: existsSync(p.python),
      applio: existsSync(join(p.applio, 'core.py')),
      separator: existsSync(p.separatorExe),
      ffmpeg: existsSync(p.ffmpeg),
      weights: existsSync(p.rmvpe) && existsSync(p.contentvec),
      separatorModel: separatorReady(p.separatorModels, cfg().separatorModel),
    }
    // 换声交给本地脚本时，不需要内置的 Applio / 预训练文件 / 音色模型（下载、分离、混音还是插件做）
    const localSong = Boolean(local?.active('song'))
    const ready = localSong ? ['python', 'separator', 'ffmpeg', 'separatorModel'].every((k) => parts[k]) : Object.values(parts).every(Boolean) && voices.length > 0
    return {
      enabled: cfg().enabled,
      ready,
      root: p.root,
      defaultRoot: defaultRoot(),
      rootCheck: checkRoot(p.root),
      pypiMirror: cfg().pypiMirror || 'auto',
      parts,
      voices: voices.map((v) => ({ id: v.id, hasIndex: Boolean(v.index), hasProfile: Boolean(v.profile) })),
      profileJob: profileJob ? { ...profileJob } : null,
      separatorLinks: parts.separatorModel ? [] : separatorLinks(cfg().separatorModel),
      voice: cfg().voice,
      install: { ...install, log: install.log.slice(-30) },
      current: current ? { ...current } : null,
      queue: queue.map((q) => ({ query: q.query, chatId: q.chatId })),
      history: history.slice(0, 10),
      message: !voices.length ? '还没有音色：在下面「音色模型」里导入你有权使用的 RVC 模型（.pth 或 zip）' : ready ? (cfg().enabled ? '可以点歌了' : '准备好了，打开开关就能用') : '还差一些组件，点「一键安装」',
    }
  }

  // ---------- 一键安装（几个 GB，要十几分钟）----------
  /** 这个 Python 能不能导入这些包（检查环境是不是完整，不装任何东西）。 */
  async function canImport(python, mods) {
    if (!existsSync(python)) return false
    try {
      await run(python, ['-c', 'import ' + mods.join(', ')], { log, timeoutMs: 120_000 })
      return true
    } catch (error) {
      return false
    }
  }

  async function runInstall() {
    if (install.running) return { ok: false, message: '已经在装了' }
    const p = P()
    install = { running: true, step: '', stepIndex: -1, steps: INSTALL_STEPS, stepHint: '', stepAt: 0, startedAt: Date.now(), progress: null, log: [], ok: null, message: '' }
    const note = (s) => { install.log.push(s); if (install.log.length > 200) install.log.shift() }
    const step = async (name, hint, fn) => {
      Object.assign(install, { step: name, stepIndex: INSTALL_STEPS.indexOf(name), stepHint: hint, stepAt: Date.now(), progress: null })
      note('▶ ' + name)
      log.info('翻唱安装：' + name)
      await fn()
    }
    // 这次安装的下载缓存放在安装目录里：一来能统计下载了多少（给面板看进度），二来装完删掉不占地方
    const cacheDir = join(p.root, 'uv-cache')
    const cn = await shouldUseCnMirror(cfg().pypiMirror)
    if (cn) note(cfg().pypiMirror === 'cn' ? '用国内镜像下载' : '官方源连得慢，自动改用国内镜像下载')
    const uvEnv = {
      UV_CACHE_DIR: cacheDir,
      UV_HTTP_TIMEOUT: '300',
      UV_HTTP_RETRIES: '6',
      UV_PYTHON_INSTALL_DIR: join(p.root, 'python'), // Python 也装在选的位置里，不偷偷占 C 盘
      ...(cn ? { UV_PYTHON_INSTALL_MIRROR: CN_PYTHON } : {}),
    }
    const mirror = cn ? ['--default-index', CN_PYPI] : []
    let uv = 'uv'
    try {
      mkdirSync(p.root, { recursive: true })
      mkdirSync(p.models, { recursive: true })
      await step('创建 Python 环境', '第一次要下载 Python 3.12（约 30 MB）和安装工具，一般 1~3 分钟', async () => {
        uv = await ensureUv(note)
        if (existsSync(p.python)) return note('  已经有了，跳过')
        const stop = watchDownload(join(p.root, 'python'))
        try {
          await run(uv, ['venv', '-q', join(p.root, 'env'), '--python', pythonVersion()], { log, onLine: note, env: uvEnv, timeoutMs: 30 * 60_000 })
        } finally {
          stop()
        }
      })
      await step('下载 Applio（RVC 推理引擎）', '要下载几十 MB，一般 1~3 分钟', async () => {
        if (existsSync(join(p.applio, 'core.py'))) return note('  已经有了，跳过')
        // 直接下代码压缩包（固定版本），不需要电脑上装 git
        const zip = join(p.root, 'downloads', 'applio.zip')
        // 用环境里的 Python 下（断了能接着下、走系统代理）；万一不行再用 PowerShell 下
        try {
          await fetchFile(p.python, zip, [`https://github.com/IAHispano/Applio/archive/${applioCommit()}.zip`, `https://codeload.github.com/IAHispano/Applio/zip/${applioCommit()}`], note, log, (done, total) => {
            install.progress = { kind: 'file', name: 'Applio', done, total }
          })
        } catch (error) {
          note('  换个方式再下一次')
          await fetchWithProgress(`https://github.com/IAHispano/Applio/archive/${applioCommit()}.zip`, zip)
        }
        const tmp = join(p.root, 'downloads', 'applio-src')
        rmSync(tmp, { recursive: true, force: true })
        await expandZip(zip, tmp)
        const inner = readdirSync(tmp).find((n) => existsSync(join(tmp, n, 'core.py')))
        if (!inner) throw new Error('下载的 Applio 压缩包不完整')
        rmSync(p.applio, { recursive: true, force: true })
        renameSync(join(tmp, inner), p.applio)
        rmSync(join(p.root, 'downloads'), { recursive: true, force: true })
      })
      await step('安装 PyTorch、RVC 和人声分离（最大的一步）', '要下载约 3~4 GB，看网速一般 10~40 分钟；下面的「已下载」在涨就说明没卡住', async () => {
        // 先检查：要用的包都能导入就跳过。「重新检查 / 修复安装」只修坏了的，不重装、不降级能用的环境
        const stop = watchDownload(cacheDir)
        try {
          if (IS_MAC) {
            // macOS：两套环境（见 MAC_STACK）。Applio/.venv 照 Applio 官方 Mac 安装方式建；env/ 只装人声分离
            const venv = join(p.applio, '.venv')
            const vpy = join(venv, 'bin', 'python')
            if (!(existsSync(vpy) && await canImport(vpy, ['torch', 'faiss', 'librosa', 'soundfile']))) {
              note('  建 Applio 自己的环境（Applio/.venv，和 Applio 官方 Mac 安装方式一样）')
              if (!existsSync(vpy)) await run(uv, ['venv', '-q', venv, '--python', pythonVersion()], { log, onLine: note, env: uvEnv, timeoutMs: 30 * 60_000 })
              await run(uv, ['pip', 'install', '--python', vpy, ...MAC_STACK.applioExtras, '-r', join(p.applio, 'requirements.txt'), ...mirror],
                { log, onLine: note, env: uvEnv, timeoutMs: 120 * 60_000 })
            } else note('  Applio 的环境已经能用，跳过')
            if (!(await canImport(p.python, ['audio_separator', 'imageio_ffmpeg']))) {
              note('  人声分离环境（env/）只装人声分离')
              await run(uv, ['pip', 'install', '--python', p.python, ...installExtras(), ...mirror], { log, onLine: note, env: uvEnv, timeoutMs: 120 * 60_000 })
            } else note('  人声分离的包都在，跳过')
            return
          }
          const engine = applioPython(p)
          const twoEnv = engine !== p.python
          const engineOk = await canImport(engine, ['torch', 'faiss', 'librosa', 'soundfile'])
          const sepOk = await canImport(p.python, ['audio_separator'])
          if (engineOk && sepOk) return note('  换声和人声分离要的包都在，跳过')
          if (twoEnv) {
            // Applio 有自己的环境（Applio/.venv，按 Applio 官方安装脚本装的）：换声用它，插件不往里装东西，
            // 也不往人声分离环境里装 Applio 的依赖（两边要的 torch 版本可能不一样，装到一起会把人声分离降级）
            if (!engineOk) throw new Error('Applio 自己的环境（Applio/.venv）缺包：请在 Applio 文件夹里重新运行 Applio 的官方安装脚本')
            note('  Applio 用它自己的环境；人声分离环境里只补装人声分离')
          }
          const pkgs = twoEnv ? [...installExtras(), 'imageio-ffmpeg'] : ['-r', join(p.applio, 'requirements-engine.txt'), ...installExtras(), 'imageio-ffmpeg']
          await run(uv, ['pip', 'install', '--python', p.python, ...pkgs,
            ...mirror, ...(twoEnv ? [] : torchSource(cn)), '--index-strategy', 'unsafe-best-match'], { log, onLine: note, env: uvEnv, timeoutMs: 120 * 60_000 })
        } finally {
          stop()
        }
      })
      await step('准备 ffmpeg', '几秒钟', async () => setupFfmpeg())
      await step('下载 RVC 需要的预训练文件（音高、音色特征）', '约 560 MB，看网速几分钟', async () => {
        for (const [rel, dest] of PREREQS) {
          await downloadWithMirror(p.python, rel, join(p.applio, dest), note, log, (done, total) => {
            install.progress = { kind: 'file', name: rel.split('/').pop(), done, total }
          })
        }
      })
      await step('下载人声分离模型', '约 640 MB，看网速几分钟；下好以后第一次点歌就不用再等', async () => {
        // 配置文件插件自带，先放进去
        mkdirSync(p.separatorModels, { recursive: true })
        const files = [...(SEPARATOR_FILES[cfg().separatorModel] || []), SEPARATOR_LIST]
        // 只放选中的模型要的配置文件（用别的模型时不往文件夹里塞默认模型的配置）
        const wanted = new Set(files.map(([n]) => n))
        for (const n of readdirSync(BUNDLED_SEP)) if (wanted.has(n) && !existsSync(join(p.separatorModels, n))) copyFileSync(join(BUNDLED_SEP, n), join(p.separatorModels, n))
        for (const [name, urls, sha] of files) {
          await fetchFile(p.python, join(p.separatorModels, name), urls, note, log, (done, total) => {
            install.progress = { kind: 'file', name, done, total }
          }, name, sha || '')
        }
      })
      // 下载缓存用完删掉（几个 GB）；环境里的文件是硬链接 / 复制过去的，删缓存不影响
      try { rmSync(cacheDir, { recursive: true, force: true }) } catch (error) {}
      install = { ...install, running: false, ok: true, step: '', progress: null, message: `装好了，用时 ${Math.round((Date.now() - install.startedAt) / 60000)} 分钟` }
      log.info('翻唱环境装好了')
    } catch (error) {
      install = { ...install, running: false, ok: false, progress: null, message: `「${install.step}」这步失败了：${explainInstallError(error.message)}`, error: String(error.message).slice(0, 2000) }
      log.warn('翻唱安装失败：', install.message)
    }
    return { ok: install.ok, message: install.message }
  }

  /**
   * 用 PowerShell 下载一个文件（会走系统代理，不依赖电脑上装了别的工具），下载中显示已下载多少、网速。
   */
  async function fetchWithProgress(url, dest, timeoutSec = 600) {
    mkdirSync(dirname(dest), { recursive: true })
    rmSync(dest, { force: true })
    const stop = watchDownload(dirname(dest))
    try {
      if (IS_WIN) {
        await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri $env:AB_URL -OutFile $env:AB_OUT -UseBasicParsing -TimeoutSec $env:AB_TIMEOUT"],
        { log, env: { AB_URL: url, AB_OUT: dest, AB_TIMEOUT: String(timeoutSec) }, timeoutMs: (timeoutSec + 60) * 1000 })
      } else {
        // macOS / Linux 自带 curl（同样走系统代理环境变量）
        await run('curl', ['-fL', '--retry', '3', '--max-time', String(timeoutSec), '-o', dest, url], { log, timeoutMs: (timeoutSec + 60) * 1000 })
      }
    } finally {
      stop()
    }
    if (!existsSync(dest) || !statSync(dest).size) throw new Error('下载失败：' + url)
  }

  /** 解压 zip：Windows 用自带的 Expand-Archive；macOS / Linux 用插件自带的解压（不依赖外部工具）。 */
  async function expandZip(zip, dir) {
    mkdirSync(dir, { recursive: true })
    if (!IS_WIN) return extractZip(readFileSync(zip), dir)
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:AB_ZIP -DestinationPath $env:AB_DIR -Force'],
      { log, env: { AB_ZIP: zip, AB_DIR: dir }, timeoutMs: 10 * 60_000 })
  }

  /**
   * 准备 uv（装 Python 和各种包的工具）：电脑上有就用，没有就下一个放进安装目录。
   * macOS 上 DSH 是从程序坞打开的，PATH 里通常没有 Homebrew，所以再看看几个常见位置。
   */
  async function ensureUv(note) {
    if (process.env.AURABOT_UV) return process.env.AURABOT_UV
    const p = P()
    const local = join(p.bin, exeName('uv'))
    if (existsSync(local)) return local
    const cands = ['uv', ...(IS_WIN ? [] : ['/opt/homebrew/bin/uv', '/usr/local/bin/uv', join(homedir(), '.local', 'bin', 'uv'), join(homedir(), '.cargo', 'bin', 'uv')])]
    for (const c of cands) {
      if (c !== 'uv' && !existsSync(c)) continue
      try {
        await run(c, ['--version'], { log, timeoutMs: 15_000 })
        return c
      } catch (error) {}
    }
    const sources = uvSources()
    if (!sources.length) throw new Error(`没有适合这台电脑（${process.platform}-${process.arch}）的 uv 安装包，请先自己装好 uv（https://docs.astral.sh/uv/）`)
    note('  电脑上没有 uv，下载一个放进安装目录')
    const zip = join(p.root, 'downloads', 'uv.zip')
    const tmp = join(p.root, 'downloads', 'uv')
    let lastError = null
    for (const src of sources) {
      try {
        await fetchWithProgress(src.url, zip, 5 * 60)
        if (src.sha256 && createHash('sha256').update(readFileSync(zip)).digest('hex') !== src.sha256) throw new Error('下载的文件校验对不上')
        rmSync(tmp, { recursive: true, force: true })
        await expandZip(zip, tmp)
        const exe = findFile(tmp, exeName('uv'))
        if (!exe) throw new Error(`里面没找到 ${exeName('uv')}`)
        mkdirSync(p.bin, { recursive: true })
        copyFileSync(exe, local)
        if (!IS_WIN) chmodSync(local, 0o755)
        rmSync(join(p.root, 'downloads'), { recursive: true, force: true })
        return local
      } catch (error) {
        lastError = error
        note(`  从 ${new URL(src.url).host} 下 uv 没成功（${error.message.slice(0, 80)}），换一个源`)
      }
    }
    throw new Error('uv 下载失败：' + (lastError?.message || ''))
  }

  /** 每 4 秒统计一次下载缓存有多大，算出已下载多少、网速多少，给面板看。返回停止函数。 */
  function watchDownload(dir) {
    let last = { at: Date.now(), bytes: dirSize(dir) }
    const base = last.bytes
    const t = setInterval(() => {
      const bytes = dirSize(dir)
      const now = Date.now()
      const speed = Math.max(0, (bytes - last.bytes) / ((now - last.at) / 1000))
      install.progress = { kind: 'download', done: bytes - base, speed }
      last = { at: now, bytes }
    }, 4000)
    t.unref?.()
    return () => clearInterval(t)
  }

  /** 把 imageio-ffmpeg 带的 ffmpeg 复制成 bin/ffmpeg(.exe)（人声分离要在 PATH 里找到 ffmpeg）。 */
  async function setupFfmpeg() {
    // 和原版一样总是放一份进安装目录的 bin/（看的是 bin/ 本身，不看系统里有没有）；
    // 系统 ffmpeg 只在复制不成时兜底（withSystemFfmpeg）
    const p = pathsOf(cfg().root || defaultRoot())
    if (existsSync(p.ffmpeg)) return
    try {
      const out = await run(p.python, ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { log })
      const src = out.trim().split(/\r?\n/).pop()
      mkdirSync(p.bin, { recursive: true })
      copyFileSync(src, p.ffmpeg)
      if (!IS_WIN) chmodSync(p.ffmpeg, 0o755)
    } catch (error) {
      if (P().ffmpeg === p.ffmpeg) throw error
      log.warn('没能把 imageio-ffmpeg 的 ffmpeg 放进安装目录，先用系统里的：', error.message)
    }
  }

  // ---------- 做一首 ----------
  // PATH 分隔符：Windows 是「;」，macOS / Linux 是「:」（用错了人声分离找不到 ffmpeg）
  const pyEnv = () => {
    const p = P()
    // ffmpeg 用的是系统里的（不在 bin/）时，把它所在的文件夹也放进 PATH，人声分离才找得到
    const dirs = [p.bin, ...(dirname(p.ffmpeg) !== p.bin ? [dirname(p.ffmpeg)] : [])]
    return { PATH: [...dirs, process.env.PATH].join(delimiter), PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  }

  async function ffprobeDuration(file) {
    // ffmpeg -i 会把时长打在 stderr 里，退出码是 1，这里自己接
    return new Promise((resolve) => {
      const c = spawn(P().ffmpeg, ['-hide_banner', '-i', file], { windowsHide: true })
      let s = ''
      c.stderr.on('data', (b) => { s += b })
      c.on('exit', () => {
        const m = s.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
        resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0)
      })
      c.on('error', () => resolve(0))
    })
  }

  /** 人声轨的平均音量（dB）；纯音乐分出来的人声几乎是静音。 */
  async function meanVolume(file) {
    return new Promise((resolve) => {
      const c = spawn(P().ffmpeg, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { windowsHide: true })
      let s = ''
      c.stderr.on('data', (b) => { s += b })
      c.on('exit', () => { const m = s.match(/mean_volume:\s*(-?[\d.]+|-inf)/); resolve(m ? (m[1] === '-inf' ? -200 : Number(m[1])) : 0) })
      c.on('error', () => resolve(0))
    })
  }

  async function download(job, dir) {
    const c = cfg()
    if (job.songId && noVocals().includes(String(job.songId))) throw new Error('这首没有人声（像是纯音乐或伴奏版），换一首吧')
    // 先在本地音乐文件夹里找原唱：找到就用本地文件（音质好、不用会员），找不到再去网易云
    if (!job.songId && c.localMusic !== false) {
      const hit = findLocalSong(job.query, { dir: c.localMusicDir || MUSIC_DIR, skip: job.skip || [] })
      if (hit) {
        job.title = hit.artists ? `${hit.title} - ${hit.artists}` : hit.title
        job.songKey = 'local:' + hit.path
        log.info(`翻唱：「${job.query}」用本地原唱 ${hit.path}${hit.artistHit ? '' : '（歌手没对上，按歌名用）'}`)
        return hit.path
      }
    }
    let pick = job.songId ? { id: job.songId, name: job.query, artists: '' } : null
    if (!pick) {
      const found = await searchSongs(job.query, { cookie: c.neteaseCookie, limit: 10 })
      if (!found.length) throw new Error(`网易云上没搜到「${job.query}」`)
      // 试过、确认没人声的跳过；看着像纯音乐的排到最后
      const known = noVocals()
      const list = rankCandidates(found, job.query).filter((s) => !(job.skip || []).includes(String(s.id)) && !known.includes(String(s.id)))
      if (!list.length) throw new Error(`搜到的「${job.query}」都是没有人声的版本`)
      // 按顺序找第一首拿得到完整音频的
      for (const s of list) {
        const u = await songUrl(s.id, { cookie: c.neteaseCookie })
        if (u.url && !u.trial) { pick = { ...s, url: u.url }; break }
      }
      if (!pick) throw new Error(`「${job.query}」要会员或者有版权限制，下载不了${c.neteaseCookie ? '' : '（在面板里填网易云 Cookie 后可以下会员歌）'}`)
    } else {
      const u = await songUrl(pick.id, { cookie: c.neteaseCookie })
      if (!u.url || u.trial) throw new Error('这首歌下载不了（要会员或者有版权限制）')
      pick.url = u.url
    }
    job.title = pick.artists ? `${pick.name} - ${pick.artists}` : pick.name
    job.songKey = String(pick.id)
    const r = await fetch(pick.url, { signal: AbortSignal.timeout(120_000) })
    if (!r.ok) throw new Error(`下载失败（HTTP ${r.status}）`)
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 60 * 1024 * 1024) throw new Error('歌太大了')
    const file = join(dir, 'song.mp3')
    writeFileSync(file, buf)
    return file
  }

  async function separate(input, dir) {
    const p = P()
    mkdirSync(p.separatorModels, { recursive: true })
    const model = cfg().separatorModel
    await ensureReadable((SEPARATOR_FILES[model] || [[model]]).map(([n]) => join(p.separatorModels, n)))
    const args = [input, '--model_filename', model, '--model_file_dir', p.separatorModels, '--output_dir', dir, '--output_format', 'WAV']
    const [cmd, argv] = separatorCommand(p, args)
    await run(cmd, argv, { log, env: pyEnv(), timeoutMs: 20 * 60_000 })
    const files = readdirSync(dir)
    const vocals = files.find((f) => /\(vocals\)/i.test(f))
    const inst = files.find((f) => /\(instrumental\)/i.test(f) || /\(other\)/i.test(f))
    if (!vocals || !inst) throw new Error('人声分离没产出文件')
    return { vocals: join(dir, vocals), inst: join(dir, inst) }
  }

  /**
   * 从数据集生成音色档案（models/<音色>.profile.json）：音域给自动定调 / 挪八度用，音色参照给音色校正用。
   * 要跑几分钟（逐个文件测音高），在后台做，面板看 status().profileJob。
   */
  function buildProfile(id, folder) {
    const p = P()
    const v = listVoices(p.models).find((x) => x.id === id)
    if (!v) return { ok: false, message: '没有这个音色' }
    const dir = String(folder || '').trim()
    if (!dir || !isAbsolute(dir) || !existsSync(dir)) return { ok: false, message: '数据集文件夹要填完整路径，并且要存在' }
    if (!existsSync(join(p.applio, 'core.py'))) return { ok: false, message: '要先装好 Applio（生成档案要用它的音高模型）' }
    if (profileJob?.running) return { ok: false, message: '上一个档案还在生成' }
    profileJob = { id, folder: dir, running: true, ok: null, message: '正在生成（几分钟）…', at: Date.now() }
    const out = join(p.models, id + '.profile.json')
    run(applioPython(p), [fileURLToPath(new URL('./pipeline/voice_profile.py', import.meta.url)), dir, out],
      { cwd: p.applio, log, env: { ...pyEnv(), AURABOT_APPLIO: p.applio }, timeoutMs: 60 * 60_000 })
      .then((tail) => { profileJob = { ...profileJob, running: false, ok: true, message: '音色档案生成好了 ' + (tail.trim().split('\n').pop() || '') } ; log.info(`音色「${id}」的档案生成好了：${out}`) })
      .catch((error) => { profileJob = { ...profileJob, running: false, ok: false, message: '生成失败：' + error.message.slice(0, 300) } ; log.warn('音色档案生成失败：', error.message) })
    return { ok: true, message: '开始生成音色档案，要几分钟' }
  }

  /** 换声参数：特征检索比例、音量包络、清辅音保护和增强流程开关（面板「翻唱」页可调）。 */
  function convertSettings() {
    const c = cfg()
    return { indexRate: c.indexRate, volumeEnvelope: c.volumeEnvelope, protect: c.protect, enhance: { ...ENHANCE_DEFAULTS, ...(c.enhance || {}) } }
  }

  /**
   * 人声 → 她的声音。本地接口接管时交给本地脚本；否则走内置的增强流程（pipeline.js）。
   * speech：语音条（说话），只换声，不去混响、不拆、不定调、不校正音色。
   */
  async function convert(vocals, dir, voice, pitch, duet = false, { speech = false } = {}) {
    const p = P()
    const out = join(dir, 'vocals_rvc.wav')
    if (local?.active('song')) {
      const { fileOf } = await import('../local/local.js')
      // duet：点歌时说了「对唱」，本地换声脚本可以先分男女声再换（脚本不认这个参数就忽略）
      const r = await local.call('song', { input: vocals, output: out, pitch, duet, voice: voice?.id || '', voiceFile: voice?.pth || '', indexFile: voice?.index || '' })
      const file = fileOf(r) || out
      if (!existsSync(file)) throw new Error('本地换声脚本没写出文件：' + file)
      return file
    }
    const settings = convertSettings()
    if (speech) settings.enhance = { ...settings.enhance, enabled: false }
    const env = {
      python: applioPython(p), applio: p.applio, separator: (args) => separatorCommand(p, args), separatorModels: p.separatorModels,
      ffmpeg: p.ffmpeg, rubberband: findRubberband(p), model: voice.pth, index: voice.index || '', profile: voice.profile || '',
    }
    const r = await runPipeline({
      input: vocals, output: out, pitch, duet, env, settings, log,
      run: (cmd, args, o = {}) => run(cmd, args, { cwd: o.cwd || p.applio, log, env: { ...pyEnv(), ...(o.env || {}) }, timeoutMs: 20 * 60_000 }),
    })
    const tag = r.shift ? (r.shift > 0 ? '+' : '') + r.shift : ''
    log.info(`换声完成（${speech ? '语音条，' : ''}${voice.id}，变调 ${pitch}${tag}${r.octave ? '，人声另挪 ' + r.octave : ''}）${r.notes.length ? ' ' + r.notes.join('；') : ''}`)
    return r.file
  }

  /**
   * 语音条变声（给「语音」模块用）：把一段 TTS 音频用翻唱里导入的 RVC 音色模型换成她的声音。
   * 内置 RVC 模式会先用 ffmpeg 把 TTS 输出（常见是 mp3）转成 44.1k 单声道 wav 再换声。
   * @param {string} input 输入音频文件
   * @param {{voice?: string, pitch?: number, outDir?: string}} [opts] voice = models 里的音色 id；pitch = 变调半音
   * @returns {Promise<string>} 变声后的 wav 文件
   */
  async function convertSpeech(input, { voice = '', pitch = 0, outDir = '' } = {}) {
    if (!existsSync(input)) throw new Error('要变声的音频不存在')
    const p = P()
    const voices = listVoices(p.models)
    if (!voices.length) throw new Error('翻唱里还没有导入音色模型：面板「翻唱」页导入 .pth / zip')
    const v = (voice ? voices.find((x) => x.id === voice) : voices.find((x) => x.id === cfg().voice)) || voices[0]
    const dir = outDir || join(work(), 'speech-rvc')
    mkdirSync(dir, { recursive: true })
    let source = input
    if (!local?.active('song')) {
      if (!existsSync(p.python) || !existsSync(join(p.applio, 'core.py')) || !existsSync(p.rmvpe) || !existsSync(p.contentvec)) {
        throw new Error('翻唱环境还没装好：面板「翻唱」页点「一键安装」，装好后再给语音条变声')
      }
      if (existsSync(p.ffmpeg)) {
        const wav = join(dir, 'speech-in.wav')
        await run(p.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-ar', '44100', '-ac', '1', wav], { log })
        if (existsSync(wav)) source = wav
      }
    }
    const n = Math.max(-24, Math.min(24, Math.round(Number(pitch) || 0)))
    return convert(source, dir, v, n, false, { speech: true })
  }

  async function mix(vocals, inst, dir) {
    const c = cfg()
    const full = join(dir, 'cover.mp3')
    const vol = Math.max(0.2, Math.min(2, Number(c.vocalVolume) || 1))
    const iv = Math.max(0.1, Math.min(2, Number(c.instVolume) || 0.8))
    await run(P().ffmpeg, mixArgs({ vocals, inst, vol, iv, out: full }), { log })
    return full
  }

  /** 先截出要发的那一段再处理：分离和换声都只算这一段，快一倍多。返回 {file, cut, length}。 */
  async function cutFirst(song, dir) {
    const c = cfg()
    const dur = await ffprobeDuration(song)
    const w = clipWindow(dur, Number(c.maxVoiceSec) || 120, c.clipStart)
    if (!dur || (w.start === 0 && w.length >= dur)) return { file: song, cut: false, length: dur }
    const out = join(dir, 'part.wav')
    await run(P().ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(w.start), '-t', String(w.length), '-i', song, '-ar', '44100', out], { log })
    return { file: out, cut: true, length: w.length }
  }

  /** 截过的段落首尾加淡入淡出，听起来不突兀。 */
  async function fade(mixed, dir, length) {
    const out = join(dir, 'voice.mp3')
    await run(P().ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', mixed,
      '-af', `afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, length - 3)}:d=3`, '-b:a', '320k', out], { log })
    return out
  }

  async function process1(job) {
    const c = cfg()
    const voice = listVoices(P().models).find((v) => v.id === (job.voice || c.voice)) || listVoices(P().models)[0]
    if (!voice && !local?.active('song')) throw new Error('还没有可用的音色模型')
    const pitch = Number.isFinite(Number(job.pitch)) ? Math.max(-24, Math.min(24, Math.round(Number(job.pitch)))) : Number(c.pitch) || 0
    const dir = join(work(), Date.now().toString(36))
    mkdirSync(dir, { recursive: true })
    current.stage = '下载歌曲'
    const song = job.file || (await download(job, dir))
    // 同一首歌、同一个音色、音高和截取方式做过的，直接复用
    // v2：0.6.2 起才检查有没有人声，之前缓存的可能是只有伴奏的成品，一律不用
    const key = createHash('md5').update(['v2', job.songKey || song, local?.active('song') ? 'local:' + (voice?.id || '') : voice.id, pitch, c.maxVoiceSec, c.clipStart, ...(job.acapella ? ['acapella'] : []), ...(job.duet ? ['duet'] : [])].join('|')).digest('hex').slice(0, 16)
    const cached = join(work(), 'cache', key + '.mp3')
    if (existsSync(cached)) {
      log.info(`翻唱：「${job.title}」做过了，直接用缓存`)
      return { file: cached, voice: voice.id, pitch, dir }
    }
    current.stage = '截取要唱的那一段'
    const part = await cutFirst(song, dir)
    current.stage = '分离人声和伴奏'
    const { vocals, inst } = await separate(part.file, dir)
    // 纯音乐 / 伴奏版分不出人声：换下一首候选重做，不然发出去只有伴奏
    const vol = await meanVolume(vocals)
    if (vol < VOCAL_MIN_DB) {
      log.info(`翻唱：「${job.title}」几乎没有人声（${vol.toFixed(0)} dB），像是纯音乐`)
      try { rmSync(dir, { recursive: true, force: true }) } catch (error) {}
      if (!job.file) markNoVocals(job.songKey)
      if (job.file || job.songId) throw new Error('这首没有人声（像是纯音乐或伴奏版），换一首吧')
      job.skip = [...(job.skip || []), job.songKey]
      if (job.skip.length >= 3) throw new Error(`搜到的几版「${job.query}」都没有人声，换个说法试试（比如带上歌手名）`)
      current.stage = '换一版重下'
      return process1(job)
    }
    current.stage = '换成她的声音'
    const converted = await convert(vocals, dir, voice, pitch, job.duet)
    current.stage = '混音'
    const mixed = await mix(converted, job.acapella ? null : inst, dir)
    const out = part.cut ? await fade(mixed, dir, part.length) : mixed
    mkdirSync(join(work(), 'cache'), { recursive: true })
    copyFileSync(out, cached)
    pruneCache(join(work(), 'cache'), 40)
    return { file: cached, voice: voice.id, pitch, dir }
  }

  async function pump() {
    if (current || !queue.length) return
    const job = queue.shift()
    current = { query: job.query, title: job.query, chatId: job.chatId, stage: '排队', startedAt: Date.now() }
    log.info(`翻唱开始：「${job.query}」→ ${job.chatId}`)
    try {
      const r = await process1(job)
      current.stage = '发送'
      await sendVoiceFile(job.chatId, r.file, `[${job.acapella ? '清唱' : '翻唱'}] ${job.title || job.query}`)
      history.unshift({ at: Date.now(), title: job.title || job.query, voice: r.voice, pitch: r.pitch, ok: true, message: `用时 ${Math.round((Date.now() - current.startedAt) / 1000)} 秒` })
      log.info(`翻唱完成：「${job.title || job.query}」`)
      onSung?.(job.title || job.query, job.chatId)
      if (!cfg().keepWork) try { rmSync(r.dir, { recursive: true, force: true }) } catch (error) {}
    } catch (error) {
      const why = explainSongError(error.message)
      history.unshift({ at: Date.now(), title: job.title || job.query, ok: false, message: why })
      log.warn(`翻唱失败：「${job.query}」：`, error.message)
      sendText?.(job.chatId, `唱不了「${job.title || job.query}」：${why}`).catch(() => {})
    } finally {
      history = history.slice(0, 20)
      current = null
      pump()
    }
  }

  /** 点一首：马上返回，做好了自己发到聊天里。 */
  function request({ song, songId, file, pitch, voice, chatId, acapella, duet }) {
    const c = cfg()
    if (!c.enabled) return { ok: false, message: '翻唱还没打开（面板「翻唱」标签里开）' }
    const st = status()
    if (!st.ready) return { ok: false, message: '翻唱环境还没装好：' + st.message }
    if (!song && !songId && !file) return { ok: false, message: '要说唱哪首歌' }
    if (queue.length >= 5) return { ok: false, message: '排队的歌太多了，等会儿再点' }
    queue.push({ query: song || basename(file || ''), songId, file, pitch, voice, chatId, acapella: Boolean(acapella), duet: Boolean(duet) })
    const ahead = queue.length - 1 + (current ? 1 : 0)
    pump()
    return { ok: true, message: `开始准备「${song || basename(file || '')}」，大概要两三分钟${ahead ? `（前面还有 ${ahead} 首）` : ''}，做好了会直接发语音` }
  }

  return {
    status,
    convertSpeech,
    install: () => { runInstall(); return { ok: true, message: '开始安装，要下载好几个 GB，可能要十几分钟' } },
    request,
    search: (q) => searchSongs(q, { cookie: cfg().neteaseCookie, limit: 8 }),
    account: () => account(cfg().neteaseCookie),
    voices: () => listVoices(P().models).map((v) => v.id),
    // .ckpt 是手动下好的人声分离模型，其余是音色
    importModels: (filename, buf) => (/\.ckpt$/i.test(filename) ? importSeparator(P().separatorModels, filename, buf) : importModels(P().models, filename, buf)),
    separatorLinks: () => separatorLinks(cfg().separatorModel),
    deleteVoice: (id) => deleteVoice(P().models, id),
    buildProfile,
  }
}
