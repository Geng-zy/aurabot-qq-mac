import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const WORKFLOW = join(ROOT, '.github/workflows/pr-check.yml')
const yml = readFileSync(WORKFLOW, 'utf8')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const steps = [...yml.matchAll(/^\s+- name: (.+)$/gm)].map((m) => m[1].trim())
const runLines = [...yml.matchAll(/^\s+run: (.+)$/gm)].map((m) => m[1].trim())

test('CI 只服务 main、版本 tag 与 PR，不引入环境或部署', () => {
  assert.match(yml, /branches:\s*\n\s+- main/, '要有 main 触发')
  assert.match(yml, /tags:\s*\n\s+- 'v\*'/, '要有版本 tag 触发')
  assert.match(yml, /workflow_dispatch:/, '要能手动跑')
  assert.doesNotMatch(yml, /environment:|deploy|publish/i, 'CI 不做部署或发布动作（Release 由人确认后手动建）')
})

// npm 自己的子命令（不会去查 scripts）；注意不要把 test 放进来 —— `npm test` 就是 scripts.test
const NPM_BUILTIN = new Set([
  'install', 'i', 'ci', 'uninstall', 'pack', 'publish', 'exec', 'ls', 'view', 'version', 'init',
  'link', 'whoami', 'config', 'update', 'audit', 'dedupe', 'fund', 'help', 'search', 'outdated',
  'rebuild', 'prune', 'cache', 'login', 'logout', 'doctor', 'explain', 'repo', 'root', 'bin', 'prefix',
])

test('CI 引用的每个 npm 脚本都真实存在（含 npm test 这种省略 run 的写法）', () => {
  // 回归：审查 M2 —— 原来只匹配 `npm run x`，而工作流真正的测试入口是 `npm test`（第 62 行），
  // 把 scripts.test 改名后工作流照旧调 npm test，自测仍然全绿。
  const calls = [...yml.matchAll(/\bnpm (?:run )?([\w:@./-]+)/g)].map((m) => m[1])
  assert.ok(calls.length >= 3, `只解析到 ${calls.length} 处 npm 调用，解析逻辑可能失效`)
  const checked = []
  for (const name of calls) {
    if (NPM_BUILTIN.has(name)) continue
    checked.push(name)
    assert.ok(pkg.scripts[name], `CI 调了不存在的脚本：npm ${name}`)
  }
  assert.ok(checked.includes('test'), '工作流的 npm test 必须被纳入校验（否则改名不会被发现）')
  assert.ok(checked.includes('build:client'), '构建入口也要纳入校验')
})

test('CI 调用的脚本文件都在仓库里', () => {
  const files = [...runLines, ...steps].flatMap((line) => [...line.matchAll(/node (scripts\/[\w.-]+\.mjs)/g)].map((m) => m[1]))
  assert.ok(files.length >= 3, 'CI 至少要跑清单、语法和测试入口')
  for (const f of new Set(files)) assert.ok(existsSync(join(ROOT, f)), `CI 指向的脚本不存在：${f}`)
})

test('生成产物要在 CI 里核对，不能只生成不比对', () => {
  assert.match(yml, /node scripts\/repo-inventory\.mjs --write/, '清单要重新生成')
  assert.match(yml, /git diff --exit-code -- client\/client\.js/, 'client.js 要核对是否与源码一致')
  assert.match(yml, /tar -tzf/, '打出来的包要核对内容')
})

test('清单本身过期要让 CI 红（--write 只保证待审为 0）', () => {
  // 回归：审查 M1 —— 提交上来的 docs/REPO-INVENTORY.md 过期时，--write 会就地改写却仍然退出 0，
  // 于是过期清单能直接进发布包。工作流必须再比对一次。
  assert.match(yml, /git diff --exit-code -- docs\/REPO-INVENTORY\.md/, '要有一段比对清单产物')
  assert.match(yml, /npm run inventory/, '错误提示里要告诉人怎么重新生成')
})

test('UI 冒烟只跑代表页、产出不写回仓库基线', () => {
  const smoke = yml.slice(yml.indexOf('ui-smoke:'))
  assert.match(smoke, /scripts\/ui-shot\.mjs --pages=/, '要指定代表页，全量留给本地')
  assert.match(smoke, /--out=\/tmp\//, '冒烟产出要写到 /tmp，不能污染 docs/ui-baseline')
  assert.match(smoke, /UI_SHOT_CHANNEL: chromium/, 'CI 里没有本机 Chrome，要用 chromium')
})

test('tag 上要校验 Release 资产的摘要', () => {
  const rel = yml.slice(yml.indexOf('release-check:'))
  assert.match(rel, /startsWith\(github\.ref, 'refs\/tags\/v'\)/, '只在版本 tag 上跑')
  assert.match(rel, /node scripts\/verify-release\.mjs/, '要跑发布校验入口')
  assert.match(rel, /GH_TOKEN/, '校验要读 Release，需要 token')
  assert.match(rel, /steps\.rel\.outputs\.exists == 'true'/, 'Release 还没建时要跳过，不能因为时序变红')
})

test('官方 action 用会跑的版本（v4 跑在已弃用的 Node 20 上）', () => {
  assert.doesNotMatch(yml, /actions\/checkout@v[0-4]\b/, 'checkout 要 >= v5')
  assert.doesNotMatch(yml, /actions\/setup-node@v[0-4]\b/, 'setup-node 要 >= v5')
})

test('工作流里没有失效的 beta 引用', () => {
  assert.doesNotMatch(yml, /beta/i, 'CI 里不该留 beta 版本/分支引用')
  assert.doesNotMatch(yml, /node-version: '1[0-8]'/, 'Node 版本要跟本机一致（24）')
})
