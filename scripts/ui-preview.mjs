// 面板预览：不起宿主、不连 QQ，直接用 client/client.js 的真实组件渲染工作台。
//
// 为什么要有它：Mini 上的界面只能在真机手动看；Air 上 DSH Desktop 的窗口又没法被 Playwright 驱动。
// 这个预览把「真组件 + 假数据 + 假宿主 primitives」拼起来，于是 28 个页面、加载/错误/空态、
// 深浅色、窄屏都能在 CI 里被截图和断言。
//
// 用法：
//   node scripts/ui-preview.mjs [--port 0] [--react <dir>]
// 依赖：React 18 UMD（npm i --no-save react@18 react-dom@18，或用 --react 指到已有目录）。
//
// 查询参数：
//   page=overview              页面 id（见 client/parts/navigation.js 的 TABS）
//   state=live|empty           数据：真机快照 / 空数据
//   mode=normal|loading|error  正常 / 强制骨架屏 / 强制错误块
//   theme=light|dark           主题（深色用 body[data-ds-dark-theme]）
//   w=1280                     视口宽度（窄屏走容器查询；由截图脚本设置视口）
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REACT_DIR = process.argv.includes('--react')
  ? process.argv[process.argv.indexOf('--react') + 1]
  : [join(ROOT, 'node_modules'), '/tmp/pw/node_modules'].find((d) => existsSync(join(d, 'react', 'umd')))

function fixtures() {
  try { return JSON.parse(readFileSync(join(ROOT, 'docs/ui-baseline/api-fixtures.json'), 'utf8')) } catch { return {} }
}

function snapshot() {
  try { return JSON.parse(readFileSync(join(ROOT, 'docs/ui-baseline/state.live.json'), 'utf8')) } catch { return null }
}

/**
 * 空数据：拿真机快照的**形状**，把列表与计数清零。
 * 直接手写一份假数据会缺字段（页面会崩），所以只做「同样的键、空的值」。
 */
function emptyState() {
  const live = snapshot()
  if (live) {
    const clone = JSON.parse(JSON.stringify(live))
    clone.channels = []
    clone.stats = {}
    clone.sessions = {}
    clone.onebot = { ...(clone.onebot || {}), state: 'idle', login: null, problem: '' }
    clone.voice = { ...(clone.voice || {}), edgeInstalled: false, custom: {} }
    if (clone.mind) clone.mind = { ...clone.mind, groups: [], diary: [], thoughts: [] }
    if (clone.voice) clone.voice = { ...clone.voice, edgeInstalled: false, custom: {} }
    if (clone.config) clone.config = { ...clone.config, enabled: false }
    return clone
  }
  return {
    ok: true, version: '0.0.0-preview', apiVersion: 1,
    config: { enabled: false, dryRun: true, debug: false, setupDone: true, platforms: {}, model: {}, imageGen: { provider: 'openai' }, voice: { engine: 'auto' }, stickers: {}, song: {}, diary: {}, group: {}, local: {}, browser: {}, security: {}, ext: {}, chatModels: {} },
    channels: [], modules: [], stats: {}, sessions: {}, onebot: { state: 'idle' }, voice: { edgeInstalled: false }, mind: { ready: true, groups: [] },
  }
}

const PAGE_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Aurabot 面板预览</title>
<style>html,body{margin:0;height:100%;background:var(--ab-bg,#fff)}#root{height:100%}</style>
<script src="/vendor/react.development.js"></script>
<script src="/vendor/react-dom.development.js"></script>
<script>
// 宿主 primitives：形状与真宿主一致（Button/Switch/Toast），可点、可被 Playwright 选中。
const primitives = {
  Button: ({ variant = 'ghost', disabled, onClick, children, ...rest }) =>
    React.createElement('button', { type: 'button', 'data-variant': variant, disabled, onClick, ...rest }, children),
  Switch: ({ checked, onChange, label, disabled }) =>
    React.createElement('button', { type: 'button', role: 'switch', 'aria-checked': String(!!checked), 'aria-label': label || '开关', disabled, onClick: () => onChange && onChange(!checked) }),
  Toast: ({ text, tone }) => React.createElement('div', { role: 'status', 'data-tone': tone || 'info', className: 'ab-toast' }, text),
  writeClipboard: async () => {},
  isDarwinDesktop: () => true,
}
// 模块加载器：客户端 bundle 只调 load({id, factory})，宿主负责把 react/primitives 传进 factory。
window.__ModuleLoader__ = {
  load: (def) => {
    window.__PANEL__ = def.factory((name) => {
      if (name === 'react') return React
      if (String(name).includes('primitives')) return primitives
      return {}
    })
  },
}
</script>
<script src="/client.js"></script>
</head><body><div id="root"></div>
<script>
const q = new URLSearchParams(location.search)
const page = q.get('page') || 'overview'
const state = q.get('state') || 'live'
const mode = q.get('mode') || 'normal'
if ((q.get('theme') || 'light') === 'dark') document.body.setAttribute('data-ds-dark-theme', '')

const JSON_OK = (v) => ({ ok: true, status: 200, json: async () => v, text: async () => JSON.stringify(v) })
window.__realFetch = window.fetch.bind(window)
window.fetch = async (url) => {
  const path = String(url).replace(/^.*\\/aurabot\\/api/, '')
  if (mode === 'loading') { await new Promise((r) => setTimeout(r, 3600000)); return JSON_OK({ ok: true }) }
  if (mode === 'error') return { ok: false, status: 500, json: async () => ({ ok: false, message: '预览：这一块故意失败（用来看错误态）' }), text: async () => '' }
  const live = window.__PREVIEW_STATE__ || {}
  const fixtures = window.__PREVIEW_FIXTURES__ || {}
  if (fixtures[path.split('?')[0]]) return JSON_OK(state === 'empty' ? window.__PREVIEW_EMPTY_API__[path.split('?')[0]] || fixtures[path.split('?')[0]] : fixtures[path.split('?')[0]])
  if (path.startsWith('/state')) return JSON_OK(live)
  if (path.startsWith('/usage')) {
    const z = { runs: 0, totalTokens: 0, cost: 0, cacheHitRate: 0 }
    return JSON_OK({ ok: true, ranges: { today: z, yesterday: z, 7: z, 30: z }, currency: '元' })
  }
  if (path.startsWith('/logs')) return JSON_OK({ ok: true, entries: state === 'empty' ? [] : [{ at: Date.now(), level: 'info', area: 'core', msg: '预览日志：插件已加载' }] })
  if (path.startsWith('/modules')) return JSON_OK({ ok: true, list: live.modules || [] })
  if (path.startsWith('/mind/settings')) return JSON_OK(state === 'empty' ? { ok: true, groups: [] } : { ok: true, groups: [] })
  if (path.startsWith('/image/gallery')) return JSON_OK({ ok: true, items: [], total: 0, dir: '' })
  return JSON_OK({ ok: true, list: [], entries: [], items: [] })
}

const renderPanel = () => {
  const mod = window.__PANEL__
  const { TABS } = mod.__panelTest
  const meta = TABS.find((t) => t.id === page) || TABS[0]
  document.title = 'Aurabot · ' + meta.label
  // 工作台按 localStorage 记住的页签打开；预览用它直接落到指定页
  try { localStorage.setItem('aurabot.tab', meta.id); localStorage.setItem('aurabot.persona-tab-v2', '1') } catch (e) {}
  const App = mod.AurabotPage || mod.default
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App))
}
const boot = async () => {
  window.__PREVIEW_STATE__ = await (await window.__realFetch('/state.json?state=' + state)).json()
  window.__PREVIEW_FIXTURES__ = await (await window.__realFetch('/fixtures.json')).json()
  window.__PREVIEW_EMPTY_API__ = { '/modules': { ok: true, list: [] }, '/mind/people': { ok: true, list: [], forgotten: [] }, '/mind/inner': { ok: true, diary: [], wants: [], actions: [] }, '/diary/history': { ok: true, list: [] }, '/logs': { ok: true, entries: [] } }
  renderPanel()
}
boot()
</script></body></html>`

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const send = (body, type) => { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body) }
  if (url.pathname.startsWith('/vendor/')) {
    const file = url.pathname.slice('/vendor/'.length)
    const full = join(REACT_DIR || '/nonexistent', 'react', 'umd', file)
    const fullDom = join(REACT_DIR || '/nonexistent', 'react-dom', 'umd', file)
    const p = existsSync(full) ? full : fullDom
    if (existsSync(p)) return send(readFileSync(p, 'utf8'), 'text/javascript; charset=utf-8')
    return send('/* 缺 React UMD：npm i --no-save react@18 react-dom@18，或用 --react <dir> */', 'text/javascript')
  }
  if (url.pathname === '/client.js') return send(readFileSync(join(ROOT, 'client/client.js'), 'utf8'), 'text/javascript; charset=utf-8')
  if (url.pathname === '/fixtures.json') return send(JSON.stringify(fixtures()), 'application/json; charset=utf-8')
  if (url.pathname === '/state.json') {
    const live = url.searchParams.get('state') === 'empty' ? emptyState() : (snapshot() || emptyState())
    return send(JSON.stringify(live), 'application/json; charset=utf-8')
  }
  return send(PAGE_HTML, 'text/html; charset=utf-8')
})

const portArg = process.argv.includes('--port') ? Number(process.argv[process.argv.indexOf('--port') + 1]) : 0
server.listen(portArg, '127.0.0.1', () => {
  console.log(`Aurabot 面板预览：http://127.0.0.1:${server.address().port}/?page=overview`)
})
