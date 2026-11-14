// AuraBot 管理的 MLX 生图。旧 Qwen Studio 留下的模型和 Python 可分别复用。
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, release, tmpdir, totalmem } from 'node:os'
import { join } from 'node:path'
import { randomInt } from 'node:crypto'
import { CN_PYPI, PY_VERSION, sharedUv, shouldUseCnMirror, uvBaseEnv } from '../core/python.js'
import { mimeOf } from '../core/image-info.js'

const MODEL = 'qwen-image-2.1'
const REPO = 'OsaurusAI/Qwen-Image-2.1-mflux-4bit'
const REVISION = '235fd28de40d745382e9d7a33f008c7735ec21c2'
const MFLUX = '0.22.0'
const ENTRY = 'from mflux.models.qwen21.cli.qwen21_edit_generate import main; main()'
const FILES = {
  LICENSE: 7831,
  NOTICE: 331,
  'model_index.json': 447,
  'processor/chat_template.jinja': 5292,
  'processor/preprocessor_config.json': 507,
  'processor/tokenizer.json': 11422650,
  'processor/tokenizer_config.json': 733,
  'scheduler/scheduler_config.json': 485,
  'text_encoder/config.json': 1516,
  'text_encoder/model.safetensors.index.json': 95963,
  'text_encoder/0.safetensors': 2138745628,
  'text_encoder/1.safetensors': 2145597770,
  'text_encoder/2.safetensors': 843423144,
  'transformer/config.json': 369,
  'transformer/model.safetensors.index.json': 48913,
  'transformer/0.safetensors': 2123573843,
  'transformer/1.safetensors': 2024999541,
  'vae/config.json': 2078,
  'vae/model.safetensors.index.json': 15902,
  'vae/0.safetensors': 1350988935,
}
const modelFiles = Object.entries(FILES)
const modelBytes = modelFiles.reduce((sum, [, size]) => sum + size, 0)
const supportedMac = process.platform === 'darwin' && process.arch === 'arm64' && Number(release().split('.')[0]) >= 25
const supportMessage = '内置本地生图需要 Apple 芯片和 macOS 26 或更新版本。'
const needsInstall = '请先在「生图 → 本地部署」安装或修复环境。'

function presentBytes(dir) {
  return modelFiles.reduce((sum, [file, size]) => {
    const st = statSync(join(dir, file), { throwIfNoEntry: false })
    return sum + (st?.isFile() && st.size === size ? size : 0)
  }, 0)
}

function run(command, args, { env, signal, timeout = 20 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env: { ...process.env, ...env }, signal, timeout, maxBuffer: 2 * 1024 * 1024, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      if (signal?.aborted) return reject(signal.reason)
      if (err) return reject(new Error(stderr.trim().split(/\r?\n/).slice(-3).join(' ').slice(-400) || String(err.code || err.signal || '进程失败')))
      resolve(stdout)
    })
  })
}

export function createLocalImage({
  root = join(homedir(), 'Aurabot', 'imagegen'), legacy = join(homedir(), '.dsh', 'qwen-studio'),
  supported = supportedMac, log, runImpl = run, uv = sharedUv, mirror = () => 'auto',
} = {}) {
  const envDir = join(root, 'env')
  const modelDir = join(root, 'models', MODEL)
  const legacyModel = join(legacy, 'models', MODEL)
  const managedPython = join(envDir, 'bin', 'python')
  const legacyPython = join(legacy, 'venv', 'bin', 'python')
  const managedMark = join(envDir, 'bin', 'mflux-generate-qwen-2.1-edit')
  const legacyMark = join(legacy, 'venv', 'bin', 'mflux-generate-qwen-2.1-edit')
  const hfEnv = { HF_HOME: join(root, 'hf-home'), HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1' }
  const offline = { ...hfEnv, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' }
  const lifetime = new AbortController()
  let job = { running: false, step: '', message: '', ok: null }
  let queue = Promise.resolve()
  let pending = 0
  const invalidPython = new Set()

  function status() {
    const localBytes = presentBytes(modelDir)
    const model = localBytes === modelBytes ? modelDir : presentBytes(legacyModel) === modelBytes ? legacyModel : ''
    const python = [[managedPython, managedMark], [legacyPython, legacyMark]]
      .find(([path, mark]) => !invalidPython.has(path) && existsSync(path) && existsSync(mark))?.[0] || ''
    return { supported, ready: Boolean(supported && model && python), running: job.running, step: job.step, message: job.message, ok: job.ok,
      model, python, reusedModel: model === legacyModel, reusedPython: python === legacyPython,
      modelBytes, remainingBytes: model ? 0 : modelBytes - localBytes, memoryGiB: Math.round(totalmem() / 1024 ** 3), pending }
  }

  async function install() {
    if (!supported) return { ok: false, message: supportMessage }
    if (job.running || pending) return { ok: false, message: '正在部署或生图，请等当前任务完成。' }
    job = { running: true, step: '检查已有环境', message: '', ok: null }
    const signal = lifetime.signal
    const probe = async (python) => {
      if (!existsSync(python)) return false
      try {
        const code = `from importlib.metadata import version; assert version('mflux') == '${MFLUX}'; ${ENTRY}`
        await runImpl(python, ['-c', code, '--help'], { env: offline, signal, timeout: 45_000 })
        invalidPython.delete(python)
        return true
      } catch {
        signal.throwIfAborted()
        invalidPython.add(python)
        return false
      }
    }
    try {
      const found = status()
      let python = managedPython
      if (!(await probe(python))) {
        if (await probe(legacyPython)) python = legacyPython
        else {
          job.step = '安装 Python、MLX 和 MFLUX'
          await mkdir(root, { recursive: true })
          const tool = await uv({ log })
          signal.throwIfAborted()
          const cn = await shouldUseCnMirror(mirror())
          const prepare = async (useMirror) => {
            const env = uvBaseEnv({ cache: join(root, 'uv-cache'), cn: useMirror })
            const index = useMirror ? ['--default-index', CN_PYPI] : []
            if (!existsSync(python)) await runImpl(tool, ['venv', '--allow-existing', '--python', PY_VERSION, envDir], { env, signal })
            await runImpl(tool, ['pip', 'install', '--python', python, `mflux==${MFLUX}`, 'Pillow==12.3.0', 'mlx==0.32.4', ...index], { env, signal, timeout: 45 * 60_000 })
          }
          try { await prepare(cn) } catch (error) {
            if (!cn || signal.aborted) throw error
            job.step = '镜像安装失败，改用官方源'
            await prepare(false)
          }
          if (!(await probe(python))) throw new Error('MFLUX 安装完成，但无法运行，请查看日志。')
        }
      }
      if (!found.model) {
        job.step = '下载 Qwen Image 2.1 权重'
        await mkdir(modelDir, { recursive: true })
        const missing = modelFiles.filter(([file, size]) => statSync(join(modelDir, file), { throwIfNoEntry: false })?.size !== size)
        const code = 'import sys; from huggingface_hub import snapshot_download; snapshot_download(repo_id=sys.argv[1], revision=sys.argv[2], local_dir=sys.argv[3], allow_patterns=sys.argv[4:], max_workers=2, token=False)'
        await runImpl(python, ['-c', code, REPO, REVISION, modelDir, ...missing.map(([file]) => file)], {
          env: { ...hfEnv, HF_HUB_OFFLINE: '0', HF_HUB_ETAG_TIMEOUT: '30', HF_HUB_DOWNLOAD_TIMEOUT: '120', HF_HUB_DISABLE_XET: '1' },
          signal, timeout: 12 * 60 * 60_000,
        })
        if (presentBytes(modelDir) !== modelBytes) throw new Error('权重未下载完整，重新部署会补齐缺少的文件。')
      }
      job.ok = true
      job.message = found.ready ? '已有环境和模型检查通过，无需重新下载。' : '本地生图已就绪，可以试画。'
    } catch (error) {
      job.ok = false
      job.message = `部署失败：${error.message}`
      if (!signal.aborted) log?.warn?.(job.message)
    } finally {
      job.running = false
      job.step = ''
    }
    return { ok: job.ok, message: job.message }
  }

  function generate(prompt, { size = '1024x1024', image, steps = 20, signal } = {}) {
    const cancel = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal
    if (job.running) return Promise.reject(new Error('本地生图正在部署，请等部署完成。'))
    if (pending >= 4) return Promise.reject(new Error('本地生图队列已满，请稍后再试。'))
    pending++
    const next = queue.then(async () => {
      cancel.throwIfAborted()
      const { ready, model, python } = status()
      if (!ready) throw new Error(supported ? needsInstall : supportMessage)
      const [w, h] = size.split('x').map(Number)
      const factor = 1024 / Math.max(1024, w, h)
      const fit = (n) => Math.max(256, Math.round(n * factor / 32) * 32)
      const dir = await mkdtemp(join(tmpdir(), 'aurabot-local-image-'))
      try {
        const output = join(dir, 'result.png')
        const args = ['-c', ENTRY, '--model', model, `--prompt=${prompt}`, '--width', String(fit(w)), '--height', String(fit(h)),
          '--steps', String(steps), '--seed', String(randomInt(2 ** 31)), '--low-ram', '--mlx-cache-limit-gb', '4', '--output', output]
        if (image) {
          const ref = join(dir, 'reference')
          await writeFile(ref, image)
          args.push('--image-paths', ref)
        }
        cancel.throwIfAborted()
        await runImpl(python, args, { env: offline, signal: cancel })
        cancel.throwIfAborted()
        const buf = await readFile(output)
        if (mimeOf(buf) !== 'image/png') throw new Error('本地模型没有返回有效的 PNG。')
        return buf
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }).finally(() => { pending-- })
    queue = next.catch(() => {})
    return next
  }

  return { status, install, generate, dispose: () => lifetime.abort() }
}
