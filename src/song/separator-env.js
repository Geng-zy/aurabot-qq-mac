// 分离器的模型与运行环境：模型清单（含 BS-RoFormer / Leap 这些可选模型）、下载（镜像 + 断点续传）、
// 路径与命令行、从系统里找 ffmpeg、导入手工下好的模型文件、以及「这个目录能不能用来安装」的判断。
// 从 song/studio.js 抽出来：那边是「安装 → 做歌 → 发语音」的编排，这一支是分离器自己的细节，测试也直接调它。

import { existsSync, mkdirSync, openSync, readSync, closeSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs'
import { join, basename, dirname, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { readJson, writeJson } from '../core/store.js'
import { findFfmpeg } from '../core/img.js'
import { run } from './run.js'
import { MAC_STACK } from './stack.js'

// 国内直连 HuggingFace 常常很慢：先试镜像，太慢或卡住再换官方
const HF_HOSTS = ['https://hf-mirror.com', 'https://huggingface.co']
const FETCH_SCRIPT = fileURLToPath(new URL('./fetch_file.py', import.meta.url))

export async function downloadWithMirror(python, rel, dest, note, log, onProgress) {
  return fetchFile(python, dest, HF_HOSTS.map((host) => `${host}/IAHispano/Applio/resolve/main/Resources/${rel}`), note, log, onProgress, rel)
}

/** 默认分离模型的文件都在不在。 */
export function separatorReady(dir, model) {
  const files = SEPARATOR_FILES[model]
  if (!files) return existsSync(join(dir, model))
  const extra = EXTRA_SEPARATORS[model]
  if (extra && !readJson(join(dir, 'extra-models.json'), () => ({}))[extra.key]) return false
  return files.every(([name]) => fileSize(join(dir, name)) > 0)
}

/** 下载一个文件：已经有了就跳过；地址按顺序轮流试，断了接着下，走系统代理。 */
export async function fetchFile(python, dest, urls, note, log, onProgress, label = basename(dest), sha256 = '') {
  const rel = label
  if (fileSize(dest) > 0) return
  // 上次没下完的（.download）会接着下
  const part = dest + '.download'
  note?.(fileSize(part) ? `接着下 ${rel}（上次下到 ${Math.round(fileSize(part) / 1048576)} MB）` : `下载 ${rel}`)
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
    try { names = readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of names) {
      const full = join(d, e.name)
      if (e.isDirectory()) stack.push(full)
      else try { total += statSync(full).size } catch {}
    }
  }
  return total
}

/** 翻唱环境的根目录：~/Aurabot/rvc。 */
export function defaultRoot() {
  return join(homedir(), 'Aurabot', 'rvc')
}

/**
 * 检查安装位置：要绝对路径；中文、空格可能让一些工具出问题，提醒一下；顺便看看那个磁盘还剩多少空间（装完约 5 GB）。
 * @returns {{ok: boolean, path: string, message: string, warn: string, freeGB: number|null}}
 */
/** 把安装时的报错翻译成人话，并告诉用户接下来怎么办。 */
export function explainInstallError(msg) {
  const m = String(msg || '')
  if (/ENOENT/.test(m)) return `找不到需要的程序（${(m.match(/spawn (\S+)/) || [])[1] || '?'}）。点「重新检查 / 修复安装」再试一次；还不行就把报错发给作者`
  if (/ENOSPC|No space|磁盘空间|not enough space/i.test(m)) return '磁盘空间不够了。换一个空间大的位置（上面「装到哪里」），或者先清出空间，保存后再装'
  if (/timed? ?out|超时|30 秒没进度|operation timed/i.test(m)) return '网络太慢、超时了。打开「用国内镜像下载」或者开着代理，再点安装（已下好的不会重下）'
  if (/connection|connect|reset|TLS|SSL|dns|resolve|Failed to fetch|Failed to download|error sending request|无法连接|网络/i.test(m)) return '网络连接断了。打开「用国内镜像下载」或者开着代理，再点安装（已下好的不会重下）'
  return m.slice(0, 300)
}

/** 人声分离环境装什么（[cpu] 版：Mac 没有 NVIDIA 显卡，PyTorch 在 Apple 芯片上仍会走 MPS 加速）。 */
export const installExtras = () => [...MAC_STACK.separator]

/** 安装的几步（面板按这个画步骤条）。 */
export const INSTALL_STEPS = ['创建 Python 环境', '下载 Applio（RVC 推理引擎）', '安装 PyTorch、RVC 和人声分离（最大的一步）',
  '准备 ffmpeg 和 rubberband', '下载 RVC 需要的预训练文件（音高、音色特征）', '下载人声分离模型']

// 默认人声分离模型要的文件：[文件名, 下载地址（按顺序试）, sha256]。提前下好，免得第一次点歌时卡着不动。
// 原版默认的 BS-Roformer 模型 640 MB，GitHub 在国内经常下不动：先走 HuggingFace 镜像（有人转存了同一个文件，校验值一样），再试官方。
// 下完核对 sha256，哪个源给的文件不对就换下一个；配置文件很小，随插件带着（src/song/separator/）。
const GH_UVR = 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models'
const GH_AS = 'https://github.com/nomadkaraoke/python-audio-separator/releases/download/model-configs'
const HF_SEP = ['Politrees/UVR_resources/resolve/main/models/Roformer/BandSplit', 'datasets/SayanoAI/RVC-Studio/resolve/main/UVR']
const BS_ROFORMER = 'model_bs_roformer_ep_317_sdr_12.9755'
// macOS 默认的主分离模型：unwa 的 BS-Roformer Leap Xe（不在 audio-separator 自带清单里，从作者的 Hugging Face 仓库按固定版本下，带校验）
export const LEAP_XE = 'bs_leap_xe_voc.ckpt'
const LEAP_REPO = 'pcunwa/BS-Roformer-Leap/resolve/4e47d6662ae82eaa8b4ac4329fe66099a843b48e/Xe'
const leapUrls = (name) => [`https://hf-mirror.com/${LEAP_REPO}/${name}`, `https://huggingface.co/${LEAP_REPO}/${name}`]
/** 清单外的分离模型：选中时插件把它登记进 separator-models/extra-models.json（separator_run.py 读这个文件补清单）。 */
export const EXTRA_SEPARATORS = {
  [LEAP_XE]: {
    key: 'Roformer Model: BS-Roformer Leap Xe Vocals by unwa',
    entry: { filename: LEAP_XE, config: 'leap_xe_config_voc.yaml', sha256: 'b739c1d2d87a81cd3dd3844ed9ad0bd678708c7a0a761a03a1aaff9af79a096d', source: 'https://huggingface.co/pcunwa/BS-Roformer-Leap' },
  },
}
/**
 * macOS 上翻唱增强流程要的工具：Rubber Band 官方的 macOS 命令行程序 4.0.0（苹果公证过，只依赖系统自带的库，
 * Apple 芯片 / Intel 通用）。伴奏跟着定调变调用。和 ffmpeg 一样放进安装目录的 bin/。
 */
export const RUBBERBAND_MAC = {
  url: 'https://breakfastquay.com/files/releases/rubberband-4.0.0-gpl-executable-macos.tar.bz2',
  sha256: '0dc91509a31a94c1144436cc20e6f1d165bdab39fe125f9be7d46139921b733f',
}
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
  [LEAP_XE]: [
    [LEAP_XE, leapUrls(LEAP_XE), 'b739c1d2d87a81cd3dd3844ed9ad0bd678708c7a0a761a03a1aaff9af79a096d'],
    ['leap_xe_config_voc.yaml', leapUrls('leap_xe_config_voc.yaml'), 'd3cb8c84be2e9bcbc64c1086e2256dc097ab5addebc5ce507818e90ff8cbdc25'],
  ],
}
const fileSize = (file) => { try { return statSync(file, { throwIfNoEntry: false })?.size || 0 } catch { return 0 } }

export const BUNDLED_SEP = fileURLToPath(new URL('./separator/', import.meta.url))
export const SEPARATOR_RUN = fileURLToPath(new URL('./separator_run.py', import.meta.url))

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

/**
 * 手动下载用的地址（面板里给用户复制，用浏览器或下载工具下好再拖进来）。
 * 给了分离模型文件夹时只列还缺的文件（Leap Xe 要模型本体和一个配置文件，缺哪个列哪个）。
 */
export function separatorLinks(model, dir = '') {
  return (SEPARATOR_FILES[model] || []).filter(([name]) => !dir || fileSize(join(dir, name)) === 0)
    .flatMap(([, urls]) => urls.slice(0, 3))
}

/** 清单外的分离模型（如 Leap Xe）登记进 extra-models.json；已登记或不是清单外的模型就什么也不做。 */
export function registerExtraSeparator(dir, model) {
  const extra = EXTRA_SEPARATORS[model]
  if (!extra) return false
  const file = join(dir, 'extra-models.json')
  const list = readJson(file, () => ({}))
  if (list[extra.key]) return false
  mkdirSync(dir, { recursive: true })
  writeJson(file, { ...list, [extra.key]: extra.entry })
  return true
}

/**
 * 导入手动下好的分离模型或它的配置文件（.ckpt / .yaml）：核对 sha256，对得上才放进去。
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
      registerExtraSeparator(dir, hit[0])
      return { ok: true, message: `人声分离模型导入好了（${hit[0]}）` }
    }
  }
  return { ok: false, message: `「${filename}」不是插件要的人声分离模型文件（校验对不上），要的是：${Object.values(SEPARATOR_FILES).flat().map(([n]) => n).join('、')}` }
}
// 分离工具每次运行都要的模型清单（缺了会去 raw.githubusercontent.com 拉，国内常常连不上）
export const SEPARATOR_LIST = ['download_checks.json', ['https://raw.githubusercontent.com/TRvlvr/application_data/main/filelists/download_checks.json', 'https://cdn.jsdelivr.net/gh/TRvlvr/application_data@main/filelists/download_checks.json']]

/** 面板里「装到哪里」的示例路径。 */
export const rootExample = () => join(homedir(), 'Aurabot', 'rvc')

export function checkRoot(path) {
  const p = String(path || '').trim()
  if (!p) return { ok: true, path: '', message: '', warn: '', freeGB: null }
  if (!p.startsWith('/')) return { ok: false, path: p, message: `要写完整路径，比如 ${rootExample()}`, warn: '', freeGB: null }
  const warn = /[^\x21-\x7e]/.test(p) ? '路径里有中文或空格，个别工具可能出问题，最好换成全英文、不带空格的路径' : ''
  let freeGB = null
  try {
    // 往上找到第一个存在的目录来量剩余空间
    let probe = p
    while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe)
    const s = statfsSync(probe)
    freeGB = Math.round((Number(s.bavail) * Number(s.bsize)) / 1024 ** 3 * 10) / 10
  } catch {}
  return { ok: true, path: p, message: '', warn: warn || (freeGB !== null && freeGB < 10 ? `这个磁盘只剩 ${freeGB} GB，装完要 5 GB 左右，安装时还要临时多占几 GB` : ''), freeGB }
}

/** 翻唱环境里各个程序的位置。 */
export function pathsOf(root) {
  const envBin = join(root, 'env', 'bin')
  return {
    root,
    python: join(envBin, 'python'),
    separatorExe: join(envBin, 'audio-separator'),
    applio: join(root, 'Applio'),
    models: join(root, 'models'),
    separatorModels: join(root, 'separator-models'),
    bin: join(root, 'bin'),
    ffmpeg: join(root, 'bin', 'ffmpeg'),
    rmvpe: join(root, 'Applio', 'rvc', 'models', 'predictors', 'rmvpe.pt'),
    contentvec: join(root, 'Applio', 'rvc', 'models', 'embedders', 'contentvec', 'pytorch_model.bin'),
  }
}

// 音色库的文件操作（列出/导入/删除/清缓存、python 与 rubberband 的位置）在 voice-library.js
export { applioPython, findRubberband, looksLikePth, listVoices, importModels, deleteVoice, pruneCache } from './voice-library.js'
import { applioPython, findRubberband, looksLikePth, listVoices, importModels, deleteVoice, pruneCache } from './voice-library.js'

/** 人声小于这个音量（dB）就当作没有唱：纯音乐不做翻唱。 */

/**
 * 做歌/安装时给子进程的环境：把安装目录的 bin 与 ffmpeg 所在目录放进 PATH，
 * MPLCONFIGDIR 放进安装目录（Applio 的音高模块会引 matplotlib，别往用户目录写缓存）。
 */
export function pyEnvOf(p) {
  const dirs = [p.bin, ...(dirname(p.ffmpeg) !== p.bin ? [dirname(p.ffmpeg)] : [])]
  return { PATH: [...dirs, process.env.PATH].join(delimiter), PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', MPLCONFIGDIR: join(p.root, 'cache', 'matplotlib') }
}
