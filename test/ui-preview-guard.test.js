import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// 回归：2026-11-28 审查 H1 —— 缺 React UMD 时预览照常起服务，/vendor/react.development.js 回一段注释，
// 浏览器端只看到「React is not defined」白页；CHANGELOG 却写着「直接报错退出」。这里把 fail-fast 钉住。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PREVIEW = join(ROOT, 'scripts/ui-preview.mjs')
const MISSING = '/tmp/aurabot-preview-guard-missing'

const run = (...args) => spawnSync(process.execPath, [PREVIEW, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 })

test('缺 React UMD 目录：直接失败，不起服务', () => {
  const r = run('--port', '0', '--react', MISSING)
  assert.equal(r.status, 2, '要非零退出，否则 CI 又只能看到白页')
  assert.match(r.stderr, /缺 React 18 UMD/)
  assert.match(r.stderr, /react@18/, '提示里要给出装法')
  assert.doesNotMatch(r.stdout, /面板预览：http/, '不能已经起好服务')
})

test('目录存在但没有 umd 文件：同样失败（只查目录不够）', () => {
  const r = run('--port', '0', '--react', join(ROOT, 'docs'))
  assert.equal(r.status, 2)
  assert.match(r.stderr, /react\.development\.js/)
})

test('给了能用的 React：正常起服务并真的吐出 React 源码', async () => {
  const dirs = [join(ROOT, 'node_modules'), '/tmp/pw/node_modules']
  let dir = ''
  for (const d of dirs) {
    try {
      const { existsSync } = await import('node:fs')
      if (existsSync(join(d, 'react/umd/react.development.js'))) { dir = d; break }
    } catch {}
  }
  if (!dir) return // 本机没装 React 时跳过（CI 的 ui-smoke 会真跑这一层）
  const child = spawn(process.execPath, [PREVIEW, '--port', '0', '--react', dir], { cwd: ROOT })
  const url = await new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('10 秒内没等到预览地址')), 10_000)
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk)
      const hit = buffer.match(/http:\/\/127\.0\.0\.1:\d+/)
      if (hit) { clearTimeout(timer); resolve(hit[0]) }
    })
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error('预览意外退出，code=' + code)) })
  })
  try {
    const res = await fetch(url + '/vendor/react.development.js')
    assert.equal(res.status, 200)
    const body = await res.text()
    assert.match(body, /react\.development|React|@license/, '必须是真 React 源码，不是占位注释')
    assert.doesNotMatch(body, /缺 React UMD/)
  } finally {
    child.kill()
  }
})
