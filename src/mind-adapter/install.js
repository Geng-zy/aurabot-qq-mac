// 本地小模型一键安装：全部装在心智核心自己的目录 ~/Aurabot/mind 里，不依赖翻唱环境，也不往电脑别处放东西。
//
//   ~/Aurabot/mind/bin/uv              固定版本的 uv（和翻唱安装同一个来源、带校验）
//   ~/Aurabot/mind/python/             uv 装的 Python 3.13.18（UV_PYTHON_INSTALL_DIR / UV_PYTHON_BIN_DIR 都指这里）
//   ~/Aurabot/mind/env/                装了 mlx-lm 的环境，包版本按 local-requirements.txt 固定
//   ~/Aurabot/mind/models/Qwen3.5-9B-mlx4   从官方 Qwen/Qwen3.5-9B 下载后在本机转成 4 位
//
// 下载的官方原版权重（约 18 GB）转换完就移到废纸篓，不直接删。

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCAL_DEFAULT } from './index.js'
import { hasLocalModel } from '../mind/local/runner.js'
import { ensurePinnedUv, shouldUseCnMirror, CN_PYPI, uvBaseEnv, sharedUvDir, sharedPythonDir, PY_VERSION } from '../core/python.js'

export const LOCAL_STACK = {
  python: PY_VERSION,
  repo: 'Qwen/Qwen3.5-9B', // 官方仓库（Hugging Face）
  name: 'Qwen3.5-9B-mlx4',
  requirements: join(dirname(fileURLToPath(import.meta.url)), 'local-requirements.txt'),
}
export const LOCAL_STEPS = ['准备安装工具', '创建 Python 环境', '安装 MLX', '下载官方模型', '转成 4 位']

/** 跑一个命令，逐行回报输出。 */
function run(cmd, args, { env, onLine, timeoutMs = 60 * 60_000, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawnImpl(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    const take = (d) => {
      tail = (tail + d).slice(-4000)
      for (const line of String(d).split(/\r?\n/)) if (line.trim()) onLine?.(line.trim().slice(0, 200))
    }
    p.stdout?.on('data', take)
    p.stderr?.on('data', take)
    const timer = setTimeout(() => { try { p.kill('SIGTERM') } catch {} ; reject(new Error('超时')) }, timeoutMs)
    p.on('error', (e) => { clearTimeout(timer); reject(e) })
    p.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(tail) : reject(new Error(tail.trim().split('\n').slice(-3).join(' ') || '退出码 ' + code)) })
  })
}

/**
 * @param {{ root?: string, trashDir: string, mirror?: () => string, log?: any, runImpl?: typeof run, ensureUv?: typeof ensurePinnedUv, cnCheck?: (mode: string) => Promise<boolean> }} o
 */
export function createLocalInstaller(o) {
  const log = o.log || { info() {}, warn() {}, debug() {} }
  const root = o.root || LOCAL_DEFAULT.root()
  const runImpl = o.runImpl || run
  const ensureUv = o.ensureUv || ensurePinnedUv
  const cnCheck = o.cnCheck || shouldUseCnMirror
  let job = { running: false, step: '', stepIndex: -1, steps: LOCAL_STEPS, log: [], ok: null, message: '', startedAt: 0 }

  const paths = () => ({
    bin: sharedUvDir(),
    pyDir: sharedPythonDir(),
    env: join(root, 'env'),
    python: join(root, 'env', 'bin', 'python'),
    models: join(root, 'models'),
    model: join(root, 'models', LOCAL_STACK.name),
    official: join(root, 'downloads', LOCAL_STACK.name.replace('-mlx4', '-official')),
    cache: join(root, 'uv-cache'),
    hfHome: join(root, 'hf-home'),
  })

  /** 已经装好了没有。 */
  function installed() { return existsSync(paths().python) && hasLocalModel(paths().model) }

  const supported = process.platform === 'darwin' && process.arch === 'arm64'

  async function checkPython(python) {
    if (!existsSync(python)) return false
    try {
      await runImpl(python, ['-c', 'import mlx_lm'], { timeoutMs: 20_000 })
      return true
    } catch { return false }
  }

  async function install({ python, model } = {}) {
    if (job.running) return { ok: false, message: '已经在装了' }
    const p = paths()
    job = { running: true, step: '', stepIndex: -1, steps: LOCAL_STEPS, log: [], ok: null, message: '', startedAt: Date.now() }
    const note = (s) => { job.log.push(s); if (job.log.length > 200) job.log.shift() }
    const step = async (name, fn) => {
      Object.assign(job, { step: name, stepIndex: LOCAL_STEPS.indexOf(name) })
      note('▶ ' + name)
      log.info('本地小模型安装：' + name)
      await fn()
    }
    let reusedPython = ''
    try {
      const requestedPython = python || p.python
      const usablePython = await checkPython(requestedPython)
      if (usablePython) reusedPython = requestedPython
      else if (requestedPython !== p.python && await checkPython(p.python)) reusedPython = p.python
      const modelReady = hasLocalModel(model || p.model) || hasLocalModel(p.model)
      if (reusedPython && modelReady) {
        Object.assign(job, { running: false, ok: true, message: '现有模型和 Python 环境可以直接使用，无需下载。' })
        return { ok: true, message: job.message, python: reusedPython }
      }
      const cn = await cnCheck(o.mirror?.() || 'auto').catch(() => false)
      if (cn) note('官方源连得慢，改用国内镜像下载')
      const uvEnv = uvBaseEnv({ cache: p.cache, cn })
      const hfEnv = { HF_HOME: p.hfHome, HF_HUB_DISABLE_TELEMETRY: '1', ...(cn ? { HF_ENDPOINT: 'https://hf-mirror.com' } : {}) }
      let uv = 'uv'
      mkdirSync(p.models, { recursive: true })
      if (!reusedPython) {
        await step('准备安装工具', async () => { uv = await ensureUv(p.bin, { note, log }) })
        await step('创建 Python 环境', async () => {
          if (existsSync(p.python)) {
            try { await runImpl(p.python, ['-c', 'pass'], { timeoutMs: 10_000 }); return note('  复用现有 Python') } catch {}
          }
          await runImpl(uv, ['venv', '-q', p.env, '--python', LOCAL_STACK.python, ...(existsSync(p.env) ? ['--clear'] : [])], { env: { ...uvEnv, UV_PYTHON_DOWNLOADS: 'automatic' }, onLine: note })
        })
        await step('安装 MLX', async () => {
          await runImpl(uv, ['pip', 'install', '-q', '--python', p.python, '-r', LOCAL_STACK.requirements, ...(cn ? ['--default-index', CN_PYPI] : [])], { env: { ...uvEnv, UV_PYTHON_DOWNLOADS: 'never' }, onLine: note })
        })
      }
      await step('下载官方模型', async () => {
        if (modelReady) return note('  已有可复用的模型，跳过下载')
        note(`  从 Hugging Face 下载官方 ${LOCAL_STACK.repo}（约 18 GB，断了重新点安装会接着下）`)
        await runImpl(reusedPython || p.python, ['-c', 'from huggingface_hub import snapshot_download; import sys; snapshot_download(repo_id=sys.argv[1], local_dir=sys.argv[2])', LOCAL_STACK.repo, p.official], { env: hfEnv, onLine: note, timeoutMs: 12 * 60 * 60_000 })
      })
      await step('转成 4 位', async () => {
        if (modelReady) return note('  已有可复用的模型，跳过转换')
        await runImpl(reusedPython || p.python, ['-m', 'mlx_lm', 'convert', '--hf-path', p.official, '--mlx-path', p.model, '-q', '--q-bits', '4'], { env: hfEnv, onLine: note, timeoutMs: 2 * 60 * 60_000 })
        if (!hasLocalModel(p.model)) throw new Error('转换结束后没有找到模型权重')
        // 官方原版权重用完了：移到废纸篓（不直接删），约 18 GB
        if (existsSync(p.official) && o.trashDir) {
          mkdirSync(o.trashDir, { recursive: true })
          renameSync(p.official, join(o.trashDir, `${LOCAL_STACK.name.replace('-mlx4', '-official')}-${Date.now()}`))
          note('  官方原版权重已移到废纸篓（约 18 GB），确认能用后可以自己清空')
        }
      })
      if (!reusedPython && !await checkPython(p.python)) throw new Error('Python 环境未能加载 MLX，请重新安装')
      Object.assign(job, { running: false, ok: true, message: '装好了' })
    } catch (error) {
      log.warn('本地小模型安装失败：', error.message)
      Object.assign(job, { running: false, ok: false, message: '没装成：' + error.message.slice(0, 300) })
    }
    return { ok: job.ok, message: job.message, ...(job.ok ? { python: reusedPython || p.python } : {}) }
  }

  return { install, installed, supported, status: () => ({ ...job, installed: installed(), supported, root, paths: paths() }), paths, pinned: () => readFileSync(LOCAL_STACK.requirements, 'utf8') }
}
