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

export { APPLIO_REPO, APPLIO_COMMIT } from './repo.js'
import { APPLIO_COMMIT } from './repo.js'

export const VOCAL_MIN_DB = -50

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

/** 翻唱出错翻译成人话（给点歌的人看）。 */
export function explainSongError(message) {
  const m = String(message || '')
  if (/size mismatch|Error\(s\) in loading state_dict|unexpected key|Missing key|KeyError: '(weight|config|params)'/i.test(m)) return '这个音色模型和内置的 RVC 不兼容（可能是 so-vits-svc 之类训练的，或者不是完整的模型文件）。可以在面板「本地接口」里接你自己的推理'
  if (/MPS backend out of memory|CUDA out of memory|OutOfMemoryError|not enough memory/i.test(m)) return '内存不够了（Apple 芯片的显卡和系统共用内存），关掉别的占内存的程序（别的 AI、大型软件）再试'
  if (/No module named|ModuleNotFoundError/i.test(m)) return '翻唱环境不完整，在面板「翻唱」页点「重新检查 / 修复安装」'
  if (/Permission denied|Errno 13|EACCES|EPERM|EBUSY/i.test(m)) {
    const file = (m.match(/'([^']+\.(?:ckpt|pth|onnx|yaml|json))'/i) || [])[1]?.replace(/\\\\/g, '\\')
    return `${file ? `读不了「${file}」` : '有个模型文件读不了'}：多半是文件权限不对（比如用 sudo 放进去的，属于 root），或者安全软件拦住了它。在终端里用 ls -l 看看文件属于谁；还不行就把这个文件移到废纸篓，在面板「翻唱」页重新下载`
  }
  return m
}

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
      profileJob: profileJob ? { ...profileJob } : null,
      separatorLinks: parts.separatorModel ? [] : separatorLinks(cfg().separatorModel, p.separatorModels),
      voice: cfg().voice,
      install: { ...install, log: install.log.slice(-30) },
      current: current ? { ...current } : null,
      queue: queue.map((q) => ({ query: q.query, chatId: q.chatId })),
      history: history.slice(0, 10),
      message: !voices.length ? '还没有音色：在下面「音色模型」里导入你有权使用的 RVC 模型（.pth 或 zip）' : ready ? (cfg().enabled ? '可以点歌了' : '准备好了，打开开关就能用') : '还差一些组件，点「一键安装」',
    }
  }

  // 一键安装在 installer.js（进度状态由这里的 install 对象持有，面板要边看边点）
  const installRef = { get value() { return install }, set value(v) { install = v } }
  const installer = createInstaller({ getConfig, log, installRef, findFfmpeg })
  const runInstall = installer.runInstall

  // ---------- 做一首 ----------
  const pyEnv = () => {
    const p = P()
    // ffmpeg 用的是系统里的（不在 bin/）时，把它所在的文件夹也放进 PATH，人声分离才找得到
    const dirs = [p.bin, ...(dirname(p.ffmpeg) !== p.bin ? [dirname(p.ffmpeg)] : [])]
    // MPLCONFIGDIR：Applio 的音高模块会引用 matplotlib，它默认往 ~/.matplotlib 写字体缓存；放进安装目录，不在用户目录留东西
    return { PATH: [...dirs, process.env.PATH].join(delimiter), PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', MPLCONFIGDIR: join(p.root, 'cache', 'matplotlib') }
  }

  async function ffprobeDuration(file, signal) {
    // ffmpeg -i 只探测输入时会输出信息并返回 1。
    try {
      const out = await run(P().ffmpeg, ['-hide_banner', '-i', file], { signal, acceptedExitCodes: [0, 1] })
      const m = out.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
      return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0
    } catch { signal?.throwIfAborted(); return 0 }
  }

  /** 人声轨的平均音量（dB）；纯音乐分出来的人声几乎是静音。 */
  async function meanVolume(file, signal) {
    try {
      const out = await run(P().ffmpeg, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { signal })
      const m = out.match(/mean_volume:\s*(-?[\d.]+|-inf)/)
      return m ? (m[1] === '-inf' ? -200 : Number(m[1])) : 0
    } catch { signal?.throwIfAborted(); return 0 }
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
      const found = await searchSongs(job.query, { cookie: c.neteaseCookie, limit: 10, signal: job.signal })
      if (!found.length) throw new Error(`网易云上没搜到「${job.query}」`)
      // 试过、确认没人声的跳过；看着像纯音乐的排到最后
      const known = noVocals()
      const list = rankCandidates(found, job.query).filter((s) => !(job.skip || []).includes(String(s.id)) && !known.includes(String(s.id)))
      if (!list.length) throw new Error(`搜到的「${job.query}」都是没有人声的版本`)
      // 按顺序找第一首拿得到完整音频的
      for (const s of list) {
        const u = await songUrl(s.id, { cookie: c.neteaseCookie, signal: job.signal })
        if (u.url && !u.trial) { pick = { ...s, url: u.url }; break }
      }
      if (!pick) throw new Error(`「${job.query}」要会员或者有版权限制，下载不了${c.neteaseCookie ? '' : '（在面板里填网易云 Cookie 后可以下会员歌）'}`)
    } else {
      const u = await songUrl(pick.id, { cookie: c.neteaseCookie, signal: job.signal })
      if (!u.url || u.trial) throw new Error('这首歌下载不了（要会员或者有版权限制）')
      pick.url = u.url
    }
    job.title = pick.artists ? `${pick.name} - ${pick.artists}` : pick.name
    job.songKey = String(pick.id)
    const timeout = AbortSignal.timeout(120_000)
    const buf = await fetchImage(pick.url, { maxBytes: 60 * 1024 * 1024, allowLocal: false, timeoutMs: 120000, signal: job.signal ? AbortSignal.any([job.signal, timeout]) : timeout })
    const file = join(dir, 'song.mp3')
    writeFileSync(file, buf)
    return file
  }

  async function separate(input, dir, signal) {
    const p = P()
    mkdirSync(p.separatorModels, { recursive: true })
    const model = cfg().separatorModel
    await ensureReadable((SEPARATOR_FILES[model] || [[model]]).map(([n]) => join(p.separatorModels, n)))
    const args = [input, '--model_filename', model, '--model_file_dir', p.separatorModels, '--output_dir', dir, '--output_format', 'WAV']
    const [cmd, argv] = separatorCommand(p, args)
    await run(cmd, argv, { log, env: pyEnv(), timeoutMs: 20 * 60_000, signal })
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
  async function convert(vocals, dir, voice, pitch, duet = false, { speech = false, signal } = {}) {
    const p = P()
    const out = join(dir, 'vocals_rvc.wav')
    if (local?.active('song')) {
      const { fileOf } = await import('../local/local.js')
      // duet：点歌时说了「对唱」，本地换声脚本可以先分男女声再换（脚本不认这个参数就忽略）
      const r = await local.call('song', { input: vocals, output: out, pitch, duet, voice: voice?.id || '', voiceFile: voice?.pth || '', indexFile: voice?.index || '' }, { signal })
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
      run: (cmd, args, o = {}) => run(cmd, args, { cwd: o.cwd || p.applio, log, env: { ...pyEnv(), ...(o.env || {}) }, timeoutMs: 20 * 60_000, signal }),
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
    const root = outDir || join(work(), 'speech-rvc')
    mkdirSync(root, { recursive: true })
    const expired = Date.now() - 86400_000
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^speech-[\w-]{6}$/.test(entry.name)) continue
      const path = join(root, entry.name)
      try { if (statSync(path).mtimeMs < expired) rmSync(path, { recursive: true, force: true }) } catch {}
    }
    const dir = mkdtempSync(join(root, 'speech-'))
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

  async function mix(vocals, inst, dir, signal) {
    const c = cfg()
    const full = join(dir, 'cover.mp3')
    const vol = Math.max(0.2, Math.min(2, Number(c.vocalVolume) || 1))
    const iv = Math.max(0.1, Math.min(2, Number(c.instVolume) || 0.8))
    await run(P().ffmpeg, mixArgs({ vocals, inst, vol, iv, out: full }), { log, signal })
    return full
  }

  /** 先截出要发的那一段再处理：分离和换声都只算这一段，快一倍多。返回 {file, cut, length}。 */
  async function cutFirst(song, dir, signal) {
    const c = cfg()
    const dur = await ffprobeDuration(song, signal)
    const w = clipWindow(dur, Number(c.maxVoiceSec) || 120, c.clipStart)
    if (!dur || (w.start === 0 && w.length >= dur)) return { file: song, cut: false, length: dur }
    const out = join(dir, 'part.wav')
    await run(P().ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(w.start), '-t', String(w.length), '-i', song, '-ar', '44100', out], { log, signal })
    return { file: out, cut: true, length: w.length }
  }

  /** 截过的段落首尾加淡入淡出，听起来不突兀。 */
  async function fade(mixed, dir, length, signal) {
    const out = join(dir, 'voice.mp3')
    await run(P().ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', mixed,
      '-af', `afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, length - 3)}:d=3`, '-b:a', '320k', out], { log, signal })
    return out
  }

  async function process1(job) {
    const { signal } = job
    signal?.throwIfAborted()
    await job.checkpoint?.()
    const c = cfg()
    const voice = listVoices(P().models).find((v) => v.id === (job.voice || c.voice)) || listVoices(P().models)[0]
    if (!voice && !local?.active('song')) throw new Error('还没有可用的音色模型')
    const pitch = Number.isFinite(Number(job.pitch)) ? Math.max(-24, Math.min(24, Math.round(Number(job.pitch)))) : Number(c.pitch) || 0
    const dir = join(work(), Date.now().toString(36))
    mkdirSync(dir, { recursive: true })
    job.workDir = dir
    const stage = (value) => { current.stage = value; job.progress?.(value) }
    stage('下载歌曲')
    const song = job.file || (await download(job, dir))
    // 同一首歌、同一个音色、同样的设置做过的，直接复用
    // v2：0.6.2 起才检查有没有人声，之前缓存的可能是只有伴奏的成品，一律不用
    // v3：面板里改了换声参数、增强流程、分离模型、音量，或者重新生成了音色档案，都要重做（以前只看音色和音高，改了设置还发旧的）
    const profileAt = voice?.profile ? (() => { try { return statSync(voice.profile).mtimeMs } catch { return 0 } })() : 0
    const stamp = (f) => { try { const st = statSync(f); return `${st.mtimeMs}:${st.size}` } catch { return '' } }
    const sourceStamp = stamp(song)
    const weightStamp = [voice?.pth, voice?.index].filter(Boolean).map(stamp).join('|')
    const knobs = JSON.stringify([convertSettings(), c.separatorModel, c.vocalVolume, c.instVolume, profileAt])
    const key = createHash('md5').update(['v4', job.songKey || song, sourceStamp, weightStamp, local?.active('song') ? 'local:' + (voice?.id || '') : voice.id, pitch, c.maxVoiceSec, c.clipStart, knobs, ...(job.acapella ? ['acapella'] : []), ...(job.duet ? ['duet'] : [])].join('|')).digest('hex').slice(0, 16)
    const cached = join(work(), 'cache', key + '.mp3')
    if (existsSync(cached)) {
      log.info(`翻唱：「${job.title}」做过了，直接用缓存`)
      return { file: cached, voice: voice?.id, pitch, dir }
    }
    stage('截取要唱的那一段')
    await job.checkpoint?.()
    const part = await cutFirst(song, dir, signal)
    stage('分离人声和伴奏')
    const { vocals, inst } = await separate(part.file, dir, signal)
    // 纯音乐 / 伴奏版分不出人声：换下一首候选重做，不然发出去只有伴奏
    const vol = await meanVolume(vocals, signal)
    if (vol < VOCAL_MIN_DB) {
      log.info(`翻唱：「${job.title}」几乎没有人声（${vol.toFixed(0)} dB），像是纯音乐`)
      try { rmSync(dir, { recursive: true, force: true }) } catch {}
      if (!job.file) markNoVocals(job.songKey)
      if (job.file || job.songId) throw new Error('这首没有人声（像是纯音乐或伴奏版），换一首吧')
      job.skip = [...(job.skip || []), job.songKey]
      if (job.skip.length >= 3) throw new Error(`搜到的几版「${job.query}」都没有人声，换个说法试试（比如带上歌手名）`)
      stage('换一版重下')
      return process1(job)
    }
    stage('换成她的声音')
    await job.checkpoint?.()
    const converted = await convert(vocals, dir, voice, pitch, job.duet, { signal })
    stage('混音')
    const mixed = await mix(converted, job.acapella ? null : inst, dir, signal)
    const out = part.cut ? await fade(mixed, dir, part.length, signal) : mixed
    signal?.throwIfAborted()
    mkdirSync(join(work(), 'cache'), { recursive: true })
    copyFileSync(out, cached)
    pruneCache(join(work(), 'cache'), 40)
    return { file: cached, voice: voice?.id, pitch, dir }
  }

  /** 翻唱失败：让她自己说一句（say 由模块层接模型生成），同一聊天 60 秒内只提示一次。 */
  function noticeFail(job, error, why, generated = false) {
    const title = job.title || job.query
    const now = Date.now()
    const last = failNoticed.get(job.chatId)
    if (last && now - last.at < FAIL_NOTICE_GAP) {
      log.info(`翻唱失败提示刚发过（${Math.round((now - last.at) / 1000)} 秒前），这次不重复：「${title}」`)
      return
    }
    failNoticed.set(job.chatId, { at: now, why })
    // 模型那边彻底挂了也得让人听到一句，不能一声不吭；这句只是兜底，不是原来的模板
    const plain = `「${title}」${generated ? why : '这次没唱成，回头再试试？'}`
    if (!say) {
      Promise.resolve(sendText?.(job.chatId, plain)).catch(() => {})
      return
    }
    Promise.resolve()
      .then(() => say({ chatId: job.chatId, title, query: job.query, why, generated, error: String(error?.message || '') }))
      .catch((e) => {
        log.warn('翻唱失败提示没说出来，退回一句短的：', e?.message || e)
        Promise.resolve(sendText?.(job.chatId, plain)).catch(() => {})
      })
  }

  async function pump() {
    if (current || !queue.length) return
    const job = queue.shift()
    job.signal?.removeEventListener('abort', job.cancelQueued)
    current = { query: job.query, title: job.query, chatId: job.chatId, stage: '排队', startedAt: Date.now() }
    log.info(`翻唱开始：「${job.query}」→ ${job.chatId}`)
    let generated = false
    try {
      const r = await process1(job)
      job.signal?.throwIfAborted()
      await job.checkpoint?.()
      current.stage = '发送'
      generated = true
      const simulated = Boolean(job.delivery && getConfig().dryRun && !getConfig().debug)
      if (!simulated) job.delivery?.beginDelivery?.()
      const sent = simulated ? null : await sendVoiceFile(job.chatId, r.file, `[${job.acapella ? '清唱' : '翻唱'}] ${job.title || job.query}`, job.delivery ? { isCurrent: job.delivery.isCurrent, allowQueue: false } : undefined)
      const delivered = Boolean(sent && !sent.queued && !sent.simulated)
      const message = delivered ? `用时 ${Math.round((Date.now() - current.startedAt) / 1000)} 秒` : sent?.queued ? '已做好，正在等待发送' : '已做好，未确认送达'
      history.unshift({ at: Date.now(), title: job.title || job.query, voice: r.voice, pitch: r.pitch, ok: delivered, message })
      log.info(`翻唱完成：「${job.title || job.query}」`)
      if (delivered) onSung?.(job.title || job.query, job.chatId)
      job.onResult?.({ ok: delivered, generated, ...(simulated ? { simulated } : {}), summary: message, outcome: 0.8 })
      if (!job.onResult && !delivered && !sent?.queued && !getConfig().dryRun && !getConfig().debug) noticeFail(job, null, message, generated)
      if (!cfg().keepWork) try { rmSync(r.dir, { recursive: true, force: true }) } catch {}
    } catch (error) {
      if (job.workDir && !cfg().keepWork) try { rmSync(job.workDir, { recursive: true, force: true }) } catch {}
      if (job.signal?.aborted) {
        job.onResult?.({ ok: false, cancelled: true, summary: '翻唱已取消' })
        return
      }
      const why = generated ? '已做好，未确认送达' : explainSongError(error.message)
      history.unshift({ at: Date.now(), title: job.title || job.query, ok: false, message: why })
      log.warn(`翻唱失败：「${job.query}」：`, error.message)
      // 说什么由她自己定：原来那句固定文案对谁、什么原因都一样，听着不像她说的
      if (job.onResult) job.onResult({ ok: false, generated, summary: why })
      else noticeFail(job, error, why, generated)
    } finally {
      history = history.slice(0, 20)
      current = null
      pump()
    }
  }

  /** 点一首：马上返回，做好了自己发到聊天里。 */
  function request({ song, songId, file, pitch, voice, chatId, acapella, duet, checkpoint, progress, delivery, signal, onResult }) {
    const c = cfg()
    if (!c.enabled) return { ok: false, message: '翻唱还没打开（面板「翻唱」标签里开）' }
    const st = status()
    if (!st.ready) return { ok: false, message: '翻唱环境还没装好：' + st.message }
    if (!song && !songId && !file) return { ok: false, message: '要说唱哪首歌' }
    if (signal?.aborted) return { ok: false, message: '翻唱已取消' }
    if (queue.length >= 5) return { ok: false, message: '排队的歌太多了，等会儿再点' }
    const job = { query: song || basename(file || ''), songId, file, pitch, voice, chatId, acapella: Boolean(acapella), duet: Boolean(duet), checkpoint, progress, delivery, signal, onResult }
    job.cancelQueued = () => {
      const index = queue.indexOf(job)
      if (index === -1) return
      queue.splice(index, 1)
      onResult?.({ ok: false, cancelled: true, summary: '翻唱已取消' })
    }
    signal?.addEventListener('abort', job.cancelQueued, { once: true })
    queue.push(job)
    const ahead = queue.length - 1 + (current ? 1 : 0)
    pump()
    return { ok: true, message: `开始准备「${song || basename(file || '')}」，大概要两三分钟${ahead ? `（前面还有 ${ahead} 首）` : ''}，做好了会直接发语音` }
  }

  function requestAutonomous(options) {
    return new Promise((resolve) => {
      const queued = request({ ...options, onResult: resolve })
      if (!queued.ok) resolve({ ok: false, summary: queued.message })
    })
  }

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
