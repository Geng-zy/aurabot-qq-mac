// 本地小模型一键安装：全部装在心智核心自己的目录里，不依赖翻唱环境；Python、快捷方式都不往别处放；
// 包版本固定；官方原版权重转完移到废纸篓。用假命令跑，不真的下载。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalInstaller, LOCAL_STACK } from '../src/mind-adapter/install.js'

function setup({ cn = false, failAt = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mind-install-'))
  process.env.AURABOT_PYTHON_ROOT = root // 共用的 Python 和 uv（平时就是心智核心目录 ~/Aurabot/mind）
  const trash = join(root, 'trash')
  const calls = []
  const runImpl = async (cmd, args, { env } = {}) => {
    calls.push({ cmd, args, env })
    if (failAt && args.includes(failAt)) throw new Error('网断了')
    if (args[0] === 'venv') { mkdirSync(join(root, 'env', 'bin'), { recursive: true }); writeFileSync(join(root, 'env', 'bin', 'python'), '') }
    if (args[0] === 'download') { mkdirSync(args[args.indexOf('--local-dir') + 1], { recursive: true }) }
    if (args.includes('convert')) { const out = args[args.indexOf('--mlx-path') + 1]; mkdirSync(out, { recursive: true }); writeFileSync(join(out, 'config.json'), '{}') }
    return ''
  }
  const inst = createLocalInstaller({ root, trashDir: trash, runImpl, ensureUv: async (bin) => join(bin, 'uv'), cnCheck: async () => cn })
  return { root, trash, calls, inst, done: () => rmSync(root, { recursive: true, force: true }) }
}

test('一键安装：五步都在心智核心目录里，用共用的 uv 和 Python，快捷方式也指进来，包版本固定，官方原版转完进废纸篓', async () => {
  const s = setup()
  try {
    const r = await s.inst.install()
    assert.equal(r.ok, true, r.message)
    const [venv, pip, dl, conv] = s.calls
    assert.deepEqual(venv.args.slice(0, 5), ['venv', '-q', join(s.root, 'env'), '--python', '3.13.18'])
    for (const c of [venv, pip]) {
      assert.equal(c.env.UV_PYTHON_INSTALL_DIR, join(s.root, 'python'))
      assert.equal(c.env.UV_PYTHON_BIN_DIR, join(s.root, 'python', 'bin'), '快捷方式不往 ~/.local/bin 放')
      assert.equal(c.env.UV_PYTHON_PREFERENCE, 'only-managed')
      assert.equal(c.env.UV_CACHE_DIR, join(s.root, 'uv-cache'))
    }
    assert.equal(venv.cmd, join(s.root, 'bin', 'uv'))
    assert.equal(pip.env.UV_PYTHON_DOWNLOADS, 'never')
    assert.ok(pip.args.includes(LOCAL_STACK.requirements))
    assert.match(readFileSync(LOCAL_STACK.requirements, 'utf8'), /^mlx==0\.32\.4$/m)
    assert.match(readFileSync(LOCAL_STACK.requirements, 'utf8'), /^mlx-lm==0\.32\.2$/m)
    assert.equal(dl.cmd, join(s.root, 'env', 'bin', 'hf'))
    assert.deepEqual(dl.args.slice(0, 2), ['download', 'Qwen/Qwen3.5-9B'])
    assert.equal(dl.env.HF_HOME, join(s.root, 'hf-home'))
    assert.deepEqual(conv.args.slice(0, 3), ['-m', 'mlx_lm', 'convert'])
    assert.ok(conv.args.includes('-q') && conv.args.includes('4'))
    assert.ok(existsSync(join(s.root, 'models', 'Qwen3.5-9B-mlx4', 'config.json')))
    assert.ok(!existsSync(join(s.root, 'downloads', 'Qwen3.5-9B-official')), '原版不留在安装目录')
    assert.ok(readdirSync(s.trash).some((f) => f.startsWith('Qwen3.5-9B-official')), '原版在废纸篓')
    assert.equal(s.inst.installed(), true)
    for (const c of s.calls) for (const v of Object.values(c.env || {})) assert.doesNotMatch(String(v), /rvc/, '不碰翻唱环境')
  } finally {
    s.done()
  }
})

test('国内网络：Python、PyPI、Hugging Face 都走镜像', async () => {
  const s = setup({ cn: true })
  try {
    await s.inst.install()
    const [venv, pip, dl] = s.calls
    assert.ok(venv.env.UV_PYTHON_INSTALL_MIRROR)
    assert.ok(pip.args.includes('--default-index'))
    assert.equal(dl.env.HF_ENDPOINT, 'https://hf-mirror.com')
  } finally {
    s.done()
  }
})

test('中途断了：说清楚没装成；再点一次，装好的步骤跳过', async () => {
  const s = setup({ failAt: 'download' })
  try {
    const r = await s.inst.install()
    assert.equal(r.ok, false)
    assert.match(r.message, /网断了/)
    assert.equal(s.inst.status().step, '下载官方模型')
    const s2 = createLocalInstaller({ root: s.root, trashDir: s.trash, runImpl: async (cmd, args) => { s.calls.push({ cmd, args, env: {} }); if (args.includes('convert')) { const out = args[args.indexOf('--mlx-path') + 1]; mkdirSync(out, { recursive: true }); writeFileSync(join(out, 'config.json'), '{}') } return '' }, ensureUv: async (bin) => join(bin, 'uv'), cnCheck: async () => false })
    const n = s.calls.length
    assert.equal((await s2.install()).ok, true)
    assert.ok(!s.calls.slice(n).some((c) => c.args[0] === 'venv'), 'Python 环境已经有了，跳过')
  } finally {
    s.done()
  }
})
