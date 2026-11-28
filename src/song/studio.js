// 翻唱：点歌 → 下载（网易云）→ 分离人声和伴奏 → RVC 换成她的声音 → 混音 → 截成语音条发回去。
// 推理引擎用 Applio（MIT，固定版本），人声分离用 audio-separator，分别装在安装目录里的两套 Python 环境里（见 MAC_STACK），不碰系统环境。

import { fetchImage } from '../core/net.js'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, statfsSync, writeFileSync, readFileSync, rmSync, copyFileSync, renameSync, openSync, readSync, closeSync, chmodSync } from 'node:fs'
import { join, basename, dirname, isAbsolute, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { dataDir, readJson, writeJson } from '../core/store.js'
import { searchSongs, songUrl, account } from './netease.js'
import { readZip } from '../core/zip.js'
import { CN_PYPI, shouldUseCnMirror, ensurePinnedUv, extractZip, findFile, sharedUvDir, sharedPythonDir, uvBaseEnv, PY_VERSION } from '../core/python.js'
import { findLocalSong, MUSIC_DIR } from './local_music.js'
import { findFfmpeg } from '../core/img.js'
import { runPipeline, ENHANCE_DEFAULTS, PIPELINE_MODELS } from './pipeline.js'

// Applio 3.7.1 正式版（tag 3.7.1 的提交），按 Applio 官方 Mac 安装方式给它建自己的环境（见 MAC_STACK）
/**
 * macOS 一键安装装的版本（2026-11-08 在 Apple 芯片 Mac 上实际跑通整套翻唱的组合）。两套环境：
 * - Applio/.venv：照 Applio 3.7.1 官方 run-install.sh 的 Mac 做法（uv venv + python-ffmpeg + requirements.txt，torch 2.11），
 *   只是 Python 用 3.13（官方脚本写 3.12；实测分离结果逐样本相同，换声差异和同一环境连跑两次的随机差异一样）
 * - env/：只装人声分离。audio-separator 0.48 在 Apple 芯片上要 torch ≥ 2.13，和 Applio 锁的 torch 2.11 装不到一起；
 *   硬装进一套会退到 audio-separator 0.45，实测 Leap Xe 等 Roformer 模型分离直接失败。
 */
export { MAC_STACK } from './stack.js'
import { MAC_STACK } from './stack.js'
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
// 音色库的文件操作（列出/导入/删除/清缓存、python 与 rubberband 位置）在 voice-library.js
export { applioPython, findRubberband, looksLikePth, listVoices, importModels, deleteVoice, pruneCache } from './voice-library.js'
import { applioPython, findRubberband, looksLikePth, listVoices, importModels, deleteVoice, pruneCache } from './voice-library.js'

// 分离器模型清单、下载、路径与命令行在 separator-env.js；跑进程的封装在 run.js
export {
  separatorReady, dirSize, defaultRoot, explainInstallError, withSystemFfmpeg, separatorCommand, separatorLinks,
  registerExtraSeparator, importSeparator, checkRoot, pathsOf, SEPARATOR_FILES, EXTRA_SEPARATORS, LEAP_XE, RUBBERBAND_MAC,
  INSTALL_STEPS, installExtras, downloadWithMirror, ensureReadable, fetchFile, BUNDLED_SEP, SEPARATOR_RUN, SEPARATOR_LIST,
} from './separator-env.js'
import {
  separatorReady, dirSize, defaultRoot, explainInstallError, withSystemFfmpeg, separatorCommand, separatorLinks,
  registerExtraSeparator, importSeparator, checkRoot, pathsOf, SEPARATOR_FILES, EXTRA_SEPARATORS, LEAP_XE, RUBBERBAND_MAC,
  INSTALL_STEPS, installExtras, downloadWithMirror, ensureReadable, fetchFile, BUNDLED_SEP, SEPARATOR_RUN, SEPARATOR_LIST,
} from './separator-env.js'
import { run } from './run.js'
import { createInstaller } from './installer.js'
import { createSession } from './session.js'

export { APPLIO_REPO, APPLIO_COMMIT } from './repo.js'
import { APPLIO_COMMIT } from './repo.js'

// 做歌用的纯函数（混音参数 / 纯音乐判断 / 候选排序 / 截取窗口 / 错误翻译）在 song-utils.js
export { VOCAL_MIN_DB, mixArgs, rankCandidates, clipWindow, explainSongError } from './song-utils.js'
import { VOCAL_MIN_DB, mixArgs, rankCandidates, clipWindow, explainSongError } from './song-utils.js'

export function createSongStudio({ getConfig, log, sendVoiceFile, sendText, say, onSung, local }) {
  const cfg = () => getConfig().song
  const P = () => withSystemFfmpeg(pathsOf(cfg().root || defaultRoot()), { find: () => findFfmpeg(getConfig().local?.ffmpegPath || '') })
  const work = () => dataDir('songs')
  // 确认过没有人声的歌（网易云 id），下次直接跳过，不用再花几分钟分离一遍
  const noVocalFile = () => join(work(), 'no-vocals.json')
  const noVocals = () => readJson(noVocalFile(), () => [])
  const markNoVocals = (id) => { if (id && !noVocals().includes(String(id))) writeJson(noVocalFile(), [...noVocals(), String(id)].slice(-500)) }
  const queue = []
  let current = null // 正在做的翻唱
  let history = [] // 最近做过的 [{at, title, voice, ok, message, file}]
  let install = { running: false, step: '', log: [], ok: null, message: '' }
  // 失败提示的节流：同一个聊天 60 秒内只提示一次——连着点几首、同一原因反复失败时不刷屏
  const failNoticed = new Map() // chatId → { at, why }
  const FAIL_NOTICE_GAP = 60_000

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
      profileJob: session.profileJob(),
      separatorLinks: parts.separatorModel ? [] : separatorLinks(cfg().separatorModel, p.separatorModels),
      voice: cfg().voice,
      install: { ...install, log: install.log.slice(-30) },
      ...session.snapshot(),
      message: !voices.length ? '还没有音色：在下面「音色模型」里导入你有权使用的 RVC 模型（.pth 或 zip）' : ready ? (cfg().enabled ? '可以点歌了' : '准备好了，打开开关就能用') : '还差一些组件，点「一键安装」',
    }
  }

  // 一键安装在 installer.js（进度状态由这里的 install 对象持有，面板要边看边点）
  const installRef = { get value() { return install }, set value(v) { install = v } }
  const installer = createInstaller({ getConfig, log, installRef, findFfmpeg })
  const runInstall = installer.runInstall

  // 做歌流水线在 session.js（队列与失败提示节流也跟着搬过去了）
  const session = createSession({
    getConfig, log, local, say, sendText, onSung, sendVoiceFile,
    P: () => P(), cfg: () => cfg(), status: () => status(),
  })
  const { request, requestAutonomous, convertSpeech, buildProfile } = session

  return {
    status,
    convertSpeech,
    install: () => { runInstall(); return { ok: true, message: '开始安装，要下载好几个 GB，可能要十几分钟' } },
    request,
    requestAutonomous,
    search: (q) => searchSongs(q, { cookie: cfg().neteaseCookie, limit: 8 }),
    account: () => account(cfg().neteaseCookie),
    voices: () => listVoices(P().models).map((v) => v.id),
    // .ckpt / .yaml 是手动下好的人声分离模型和它的配置文件，其余是音色
    importModels: (filename, buf) => (/\.(ckpt|yaml)$/i.test(filename) ? importSeparator(P().separatorModels, filename, buf) : importModels(P().models, filename, buf)),
    separatorLinks: () => separatorLinks(cfg().separatorModel, P().separatorModels),
    deleteVoice: (id) => deleteVoice(P().models, id),
    buildProfile,
  }
}
