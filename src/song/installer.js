// 一键安装：建两套 Python 环境（Applio 推理 / audio-separator 分离）、下预训练与分离模型、备好 ffmpeg 与 rubberband。
// 从 song/studio.js 抽出来：那边是「状态 → 安装 → 做歌 → 面板」的编排，这一支只负责「把环境装上」，
// 进度状态由外部持有（installRef），因为面板要一边看进度一边点。
//
// 依赖全部注入，因此可以喂假 run/fetch 测「装到哪一步失败、错误怎么翻译成人话」。

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { CN_PYPI, shouldUseCnMirror, ensurePinnedUv, extractZip, findFile, sharedUvDir, sharedPythonDir, uvBaseEnv, PY_VERSION } from '../core/python.js'
import { PIPELINE_MODELS } from './pipeline.js'
import { MAC_STACK } from './stack.js'
import { run } from './run.js'
import { APPLIO_COMMIT } from './repo.js'
import {
  defaultRoot, dirSize, explainInstallError, pathsOf, separatorCommand, registerExtraSeparator,
  downloadWithMirror, fetchFile, SEPARATOR_FILES, SEPARATOR_LIST, RUBBERBAND_MAC, INSTALL_STEPS,
  BUNDLED_SEP, installExtras, pyEnvOf, withSystemFfmpeg,
} from './separator-env.js'

/** 安装要的预训练文件（Applio 放在 HuggingFace 上）：[远端相对路径, 本地相对 Applio 的路径] */
const PREREQS = [
  ['predictors/rmvpe.pt', 'rvc/models/predictors/rmvpe.pt'],
  ['embedders/contentvec/config.json', 'rvc/models/embedders/contentvec/config.json'],
  ['embedders/contentvec/pytorch_model.bin', 'rvc/models/embedders/contentvec/pytorch_model.bin'],
]

export function createInstaller({ getConfig, log, installRef, findFfmpeg }) {
  const cfg = () => getConfig().song || {}
  const getInstall = () => installRef.value
  const setInstall = (v) => { installRef.value = v }
  const P = () => withSystemFfmpeg(pathsOf(cfg().root || defaultRoot()), { find: () => findFfmpeg(getConfig().local?.ffmpegPath || '') })
  const pyEnv = () => pyEnvOf(P())

  /** 这个 Python 能不能导入这些包（检查环境是不是完整，不装任何东西）。 */
  async function canImport(python, mods) {
    if (!existsSync(python)) return false
    try {
      await run(python, ['-c', 'import ' + mods.join(', ')], { log, timeoutMs: 120_000 })
      return true
    } catch { 
      return false
     }
  }

  async function runInstall() {
    if (getInstall().running) return { ok: false, message: '已经在装了' }
    const p = P()
    setInstall({ running: true, step: '', stepIndex: -1, steps: INSTALL_STEPS, stepHint: '', stepAt: 0, startedAt: Date.now(), progress: null, log: [], ok: null, message: '' })
    const note = (s) => { getInstall().log.push(s); if (getInstall().log.length > 200) getInstall().log.shift() }
    const step = async (name, hint, fn) => {
      Object.assign(getInstall(), { step: name, stepIndex: INSTALL_STEPS.indexOf(name), stepHint: hint, stepAt: Date.now(), progress: null })
      note('▶ ' + name)
      log.info('翻唱安装：' + name)
      await fn()
    }
    // 这次安装的下载缓存放在安装目录里：一来能统计下载了多少（给面板看进度），二来装完删掉不占地方
    const cacheDir = join(p.root, 'uv-cache')
    const cn = await shouldUseCnMirror(cfg().pypiMirror)
    if (cn) note(cfg().pypiMirror === 'cn' ? '用国内镜像下载' : '官方源连得慢，自动改用国内镜像下载')
    // Python 用共用的那份（心智核心目录里），环境建在翻唱安装目录里
    const uvEnv = uvBaseEnv({ cache: cacheDir, cn })
    const mirror = cn ? ['--default-index', CN_PYPI] : []
    let uv = 'uv'
    try {
      mkdirSync(p.root, { recursive: true })
      mkdirSync(p.models, { recursive: true })
      await step('创建 Python 环境', `第一次要下载 Python ${PY_VERSION}（约 30 MB）和安装工具，一般 1~3 分钟`, async () => {
        uv = await ensureUv(note)
        if (existsSync(p.python)) return note('  已经有了，跳过')
        const stop = watchDownload(sharedPythonDir())
        try {
          await run(uv, ['venv', '-q', join(p.root, 'env'), '--python', PY_VERSION], { log, onLine: note, env: uvEnv, timeoutMs: 30 * 60_000 })
        } finally {
          stop()
        }
      })
      await step('下载 Applio（RVC 推理引擎）', '要下载几十 MB，一般 1~3 分钟', async () => {
        if (existsSync(join(p.applio, 'core.py'))) return note('  已经有了，跳过')
        // 直接下代码压缩包（固定版本），不需要电脑上装 git
        const zip = join(p.root, 'downloads', 'applio.zip')
        // 用环境里的 Python 下（断了能接着下、走系统代理）；万一不行再用 curl 下
        try {
          await fetchFile(p.python, zip, [`https://github.com/IAHispano/Applio/archive/${APPLIO_COMMIT}.zip`, `https://codeload.github.com/IAHispano/Applio/zip/${APPLIO_COMMIT}`], note, log, (done, total) => {
            getInstall().progress = { kind: 'file', name: 'Applio', done, total }
          })
        } catch (error) {
          note('  换个方式再下一次')
          await fetchWithProgress(`https://github.com/IAHispano/Applio/archive/${APPLIO_COMMIT}.zip`, zip)
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
      await step('安装 PyTorch、RVC 和人声分离（最大的一步）', '两套环境装好后共约 2.5 GB，看网速一般几分钟到二十分钟；下面的「已下载」在涨就说明没卡住', async () => {
        // 先检查：要用的包都能导入就跳过。「重新检查 / 修复安装」只修坏了的，不重装、不降级能用的环境
        const stop = watchDownload(cacheDir)
        try {
          // macOS：两套环境（见 MAC_STACK）。Applio/.venv 照 Applio 官方 Mac 安装方式建；env/ 只装人声分离
          const venv = join(p.applio, '.venv')
          const vpy = join(venv, 'bin', 'python')
          if (!(existsSync(vpy) && await canImport(vpy, ['torch', 'faiss', 'librosa', 'soundfile']))) {
            note('  建 Applio 自己的环境（Applio/.venv，和 Applio 官方 Mac 安装方式一样）')
            if (!existsSync(vpy)) await run(uv, ['venv', '-q', venv, '--python', PY_VERSION], { log, onLine: note, env: uvEnv, timeoutMs: 30 * 60_000 })
            await run(uv, ['pip', 'install', '--python', vpy, ...MAC_STACK.applioExtras, '-r', join(p.applio, 'requirements.txt'), ...mirror],
              { log, onLine: note, env: uvEnv, timeoutMs: 120 * 60_000 })
          } else note('  Applio 的环境已经能用，跳过')
          if (!(await canImport(p.python, ['audio_separator', 'imageio_ffmpeg']))) {
            note('  人声分离环境（env/）只装人声分离')
            await run(uv, ['pip', 'install', '--python', p.python, ...installExtras(), ...mirror], { log, onLine: note, env: uvEnv, timeoutMs: 120 * 60_000 })
          } else note('  人声分离的包都在，跳过')
        } finally {
          stop()
        }
      })
      await step(INSTALL_STEPS[3], '几秒钟（rubberband 约 1.5 MB）', async () => {
        await setupFfmpeg()
        await setupRubberband(note)
      })
      await step('下载 RVC 需要的预训练文件（音高、音色特征）', '约 560 MB，看网速几分钟', async () => {
        for (const [rel, dest] of PREREQS) {
          await downloadWithMirror(p.python, rel, join(p.applio, dest), note, log, (done, total) => {
            getInstall().progress = { kind: 'file', name: rel.split('/').pop(), done, total }
          })
        }
      })
      await step('下载人声分离模型', '主分离加翻唱增强要的 3 个模型，共约 1.9 GB，看网速十几分钟；下好以后第一次点歌就不用再等', async () => {
        // 配置文件插件自带，先放进去
        mkdirSync(p.separatorModels, { recursive: true })
        const files = [...(SEPARATOR_FILES[cfg().separatorModel] || []), SEPARATOR_LIST]
        // 只放选中的模型要的配置文件（用别的模型时不往文件夹里塞默认模型的配置）
        const wanted = new Set(files.map(([n]) => n))
        for (const n of readdirSync(BUNDLED_SEP)) if (wanted.has(n) && !existsSync(join(p.separatorModels, n))) copyFileSync(join(BUNDLED_SEP, n), join(p.separatorModels, n))
        for (const [name, urls, sha] of files) {
          await fetchFile(p.python, join(p.separatorModels, name), urls, note, log, (done, total) => {
            getInstall().progress = { kind: 'file', name, done, total }
          }, name, sha || '')
        }
        // 清单外的模型（Leap Xe）：登记进 extra-models.json，separator_run.py 才认得
        registerExtraSeparator(p.separatorModels, cfg().separatorModel)
        // 翻唱增强流程（去混响、拆主唱伴唱、分男女声）的模型也先下好，都在 audio-separator 自带清单里，用它自己的下载
        for (const m of Object.values(PIPELINE_MODELS)) {
          if (existsSync(join(p.separatorModels, m))) continue
          note(`  下载翻唱增强模型 ${m}`)
          const stop = watchDownload(p.separatorModels)
          try {
            const [cmd, args] = separatorCommand(p, ['--model_filename', m, '--model_file_dir', p.separatorModels, '--download_model_only'])
            await run(cmd, args, { log, onLine: note, env: pyEnv(), timeoutMs: 2 * 3600_000 })
          } catch (error) {
            // 增强模型是可选的：主模型和 RVC 已经能用时，不让一个增强模型下载失败把整套安装判死。
            note(`  跳过翻唱增强模型 ${m}：${String(error.message || error).slice(0, 160)}`)
            log.warn(`翻唱增强模型下载失败，跳过 ${m}：`, error.message)
          } finally {
            stop()
          }
        }
      })
      // 下载缓存用完删掉（几个 GB）；环境里的文件是硬链接 / 复制过去的，删缓存不影响
      try { rmSync(cacheDir, { recursive: true, force: true }) } catch {}
      setInstall({ ...getInstall(), running: false, ok: true, step: '', progress: null, message: `装好了，用时 ${Math.round((Date.now() - getInstall().startedAt) / 60000)} 分钟` })
      log.info('翻唱环境装好了')
    } catch (error) {
      setInstall({ ...getInstall(), running: false, ok: false, progress: null, message: `「${getInstall().step}」这步失败了：${explainInstallError(error.message)}`, error: String(error.message).slice(0, 2000) })
      log.warn('翻唱安装失败：', getInstall().message)
    }
    return { ok: getInstall().ok, message: getInstall().message }
  }

  /** 用系统自带的 curl 下载一个文件（走系统代理环境变量），下载中显示已下载多少、网速。 */
  async function fetchWithProgress(url, dest, timeoutSec = 600) {
    mkdirSync(dirname(dest), { recursive: true })
    rmSync(dest, { force: true })
    const stop = watchDownload(dirname(dest))
    try {
      await run('curl', ['-fL', '--retry', '3', '--max-time', String(timeoutSec), '-o', dest, url], { log, timeoutMs: (timeoutSec + 60) * 1000 })
    } finally {
      stop()
    }
    if (!existsSync(dest) || !statSync(dest).size) throw new Error('下载失败：' + url)
  }

  /** 解压 zip：用插件自带的解压（不依赖外部工具）。 */
  async function expandZip(zip, dir) {
    mkdirSync(dir, { recursive: true })
    return extractZip(readFileSync(zip), dir)
  }

  /** 准备 uv：见 ensurePinnedUv（下载时在面板上显示进度）。 */
  async function ensureUv(note) {
    // uv 和 Python 都用心智核心目录里共用的那份（见 core/python.js）；翻唱只建自己的环境
    return ensurePinnedUv(sharedUvDir(), { note, log, download: (url, dest) => fetchWithProgress(url, dest, 5 * 60) })
  }

  /** 每 4 秒统计一次下载缓存有多大，算出已下载多少、网速多少，给面板看。返回停止函数。 */
  function watchDownload(dir) {
    let last = { at: Date.now(), bytes: dirSize(dir) }
    const base = last.bytes
    const t = setInterval(() => {
      const bytes = dirSize(dir)
      const now = Date.now()
      const speed = Math.max(0, (bytes - last.bytes) / ((now - last.at) / 1000))
      getInstall().progress = { kind: 'download', done: bytes - base, speed }
      last = { at: now, bytes }
    }, 4000)
    t.unref?.()
    return () => clearInterval(t)
  }

  /**
   * macOS：把 Rubber Band 官方的命令行程序放进安装目录的 bin/（看 bin/ 本身，和 ffmpeg 一样；系统里有也照放，翻唱只用这一份）。
   * 下载有固定校验值；解压用系统自带的 tar。
   */
  async function setupRubberband(note) {
    const p = pathsOf(cfg().root || defaultRoot())
    const dest = join(p.bin, 'rubberband')
    if (existsSync(dest)) return
    const tmp = join(p.root, 'downloads', 'rubberband')
    const tarball = join(tmp, 'rubberband.tar.bz2')
    mkdirSync(tmp, { recursive: true })
    await fetchFile(p.python, tarball, [RUBBERBAND_MAC.url], note, log, (done, total) => {
      getInstall().progress = { kind: 'file', name: 'rubberband', done, total }
    }, 'rubberband', RUBBERBAND_MAC.sha256)
    await run('tar', ['-xjf', tarball, '-C', tmp], { log, timeoutMs: 60_000 })
    const exe = findFile(tmp, 'rubberband')
    if (!exe) throw new Error('rubberband 压缩包里没找到程序')
    mkdirSync(p.bin, { recursive: true })
    copyFileSync(exe, dest)
    chmodSync(dest, 0o755)
    rmSync(join(p.root, 'downloads'), { recursive: true, force: true })
  }

  /** 把 imageio-ffmpeg 带的 ffmpeg 复制成 bin/ffmpeg（人声分离要在 PATH 里找到 ffmpeg）。 */
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
      chmodSync(p.ffmpeg, 0o755)
    } catch (error) {
      if (P().ffmpeg === p.ffmpeg) throw error
      log.warn('没能把 imageio-ffmpeg 的 ffmpeg 放进安装目录，先用系统里的：', error.message)
    }
  }


  return { canImport, runInstall }
}
