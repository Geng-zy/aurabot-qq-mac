import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// 回归：2026-11-28 审查 H3 —— `--pages=nosuchpage` 曾经跑 0 页、退出码 0、还打印「通过」，
// 于是 CI 的 ui-smoke 一旦拼错页名就变成空转但全绿。这里把参数校验钉住（不启动浏览器、不需要 Chromium）。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOT = join(ROOT, 'scripts/ui-shot.mjs')

const run = (...args) => spawnSync(process.execPath, [SHOT, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 })

test('未知页名当场失败，并列出可选页面', () => {
  const r = run('--pages=nosuchpage', '--states=0', '--out=/tmp/ui-shot-flags-test')
  assert.equal(r.status, 2, '必须非零退出，否则 CI 会把空转当通过')
  assert.match(r.stderr, /未知页面：nosuchpage/)
  assert.match(r.stderr, /可选页面/, '要告诉人有哪些页名可用')
  assert.match(r.stderr, /overview/, '列表里至少要有真实页名')
  assert.doesNotMatch(r.stdout, /通过/, '不能打印通过结论')
  assert.doesNotMatch(r.stderr, /playwright/, '校验要在加载浏览器之前完成')
})

test('--pages= 空值算写错，不是「跑全量」', () => {
  const r = run('--pages=', '--states=0', '--out=/tmp/ui-shot-flags-test')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /没有页名/)
})

test('--states 只接受 0 或 1', () => {
  const r = run('--pages=overview', '--states=2', '--out=/tmp/ui-shot-flags-test')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /--states 只接受 0 或 1/)
})

test('页名校验覆盖 PAGES 全集（新增页要同步进参数白名单）', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(SHOT, 'utf8')
  const pages = [...src.slice(src.indexOf('const PAGES = ['), src.indexOf(']', src.indexOf('const PAGES = ['))).matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
  assert.ok(pages.length >= 20, `PAGES 解析到 ${pages.length} 个页名，太少，说明截取逻辑失效`)
  // 抽查几个代表性页名确实在列表里，避免正则失效后静默通过
  for (const id of ['overview', 'persona', 'mindsettings', 'market']) assert.ok(pages.includes(id), `PAGES 里缺 ${id}`)
})
