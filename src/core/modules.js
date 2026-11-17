// 模块内核：管理内置和用户功能的生命周期。用户模块放数据目录 modules/（升级不会动）。
//
// - 每个模块能单独开关；自己写的模块和内置的同名，就替换掉内置的
// - 模块之间用 api.use('模块id') 拿对方导出的东西，用的时候再拿（对方被关了、换了也不会拿到旧的）
// - 模块注册的工具、上下文、命令、定时任务、面板接口都记在模块名下，关掉 / 重新加载时一起撤掉
// - 一个模块出错只影响它自己：启动失败记下原因，其他照常跑
// - 自己写的模块保存就生效（按修改时间重新加载），不用重启 DSH
//
// 接口说明给写模块的人看：src/modules/API.md（每次启动复制到数据目录 modules/ 里）。

import { existsSync, readdirSync, statSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dataDir } from './store.js'
import { registerSecretField } from './config.js'
import { defineTool } from '../tools/tools.js'
import { createModuleState } from './module-state.js'
import { createModulePanel } from './module-panel.js'
import { createModuleApi } from './module-api.js'
import { createModuleRegistry } from './module-registry.js'
import { rewriteImports, scopeCoreForModule, lazyProxy, deepMerge } from './module-code.js'
export { rewriteImports, scopeCoreForModule, lazyProxy } from './module-code.js'

/** 扩展接口版本：只加不改。哪天不得不改已有的东西才升到 2，并在更新说明里写清楚怎么迁移。 */
export const API_VERSION = 1
export const MIN_API_VERSION = 1

const SRC = fileURLToPath(new URL('../', import.meta.url)) // 插件的 src/
const BUILTIN_DIR = join(SRC, 'modules')
/** 内置模块目录（社区安装时判断会不会替换内置用）。 */
export const builtinDir = () => BUILTIN_DIR
const ID_RE = /^[a-z][a-z0-9-]{1,39}$/
const ENTRY = ['index.mjs', 'index.js']
const DOC = 'API.md'
const TYPES = 'aurabot.d.ts'
// 从内置搬到社区库的模块：接口路径不变，面板页照常能用
const STABLE_ROUTES = new Set(['pet', 'douyin', 'heybox', 'group-admin'])

export const userDir = () => dataDir('modules')

/** 内部源码全部按「相对 src 的路径」开放出来：lib('features/memory.js') → 那个文件导出的全部东西。 */
const libCache = new Map()
export async function loadLib() {
  if (libCache.size) return libCache
  const files = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name)
      if (e.isDirectory()) { if (!['templates', 'separator', '_template'].includes(e.name)) walk(full) }
      else if (e.name.endsWith('.js')) files.push(full)
    }
  }
  walk(SRC)
  for (const f of files) {
    const key = relative(SRC, f).split(sep).join('/')
    try { libCache.set(key, await import(pathToFileURL(f).href)) } catch (error) {}
  }
  return libCache
}
export function lib(key) {
  const k = String(key || '').replace(/^\.?\/?(src\/)?/, '')
  const hit = libCache.get(k) || libCache.get(k + '.js')
  if (!hit) throw new Error(`没有 ${key} 这个内部文件（看 API.md 的「内部源码」一节）`)
  return hit
}
export const libKeys = () => [...libCache.keys()].sort()

// 加载自己写的模块时跳过的目录：依赖、加载快照、版本库
const SKIP_DIRS = new Set(['node_modules', '.aurabot-cache', '.git'])
const SNAP = '.aurabot-cache'

/** 模块文件夹里所有文件（含子目录，不含依赖和快照）。 */
function filesOf(dir, base = dir, out = []) {
  let list = []
  try { list = readdirSync(dir, { withFileTypes: true }) } catch (error) { return out }
  for (const e of list) {
    const full = join(dir, e.name)
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) filesOf(full, base, out) }
    else if (e.isFile()) out.push(relative(base, full))
  }
  return out
}

/** 模块的「版本戳」：任何文件改了、加了、删了都会变。 */
function stampOf(dir) {
  let t = 0
  const files = filesOf(dir)
  for (const f of files) { try { t = Math.max(t, statSync(join(dir, f)).mtimeMs) } catch (error) {} }
  return Math.round(t) + files.length / 1000
}
const entryOf = (dir) => ENTRY.map((n) => join(dir, n)).find((p) => existsSync(p)) || ''

/** 数据目录 modules/ 里有哪些模块（目录名以 _ 或 . 开头的跳过）：[{ id, dir, file }] */
export function scanUser() {
  const out = []
  let names = []
  try { names = readdirSync(userDir(), { withFileTypes: true }) } catch (error) { return out }
  for (const e of names) {
    if (!e.isDirectory() || /^[_.]/.test(e.name)) continue
    const dir = join(userDir(), e.name)
    const file = entryOf(dir)
    if (file) out.push({ id: e.name, dir, file })
  }
  return out
}

/** 检查模块定义，返回出错原因（没问题返回空串）。 */
export function checkDef(def, id) {
  if (!def || typeof def !== 'object') return '入口文件要 export default 一个对象（看 API.md）'
  if (typeof def.setup !== 'function') return '模块里没有 setup(api) 函数'
  if (!ID_RE.test(String(def.id || ''))) return `模块 id「${def.id ?? ''}」不对：小写字母开头，只能有小写字母、数字和 -，2~40 个字`
  if (id && def.id !== id) return `模块 id「${def.id}」要和文件夹名「${id}」一样`
  const want = Number(def.api ?? 1)
  if (want > API_VERSION) return `这个模块要扩展接口 v${want}，现在的插件只有 v${API_VERSION}，先更新插件`
  if (want < MIN_API_VERSION) return `这个模块是按扩展接口 v${want} 写的，现在最低支持 v${MIN_API_VERSION}，按更新说明改一下`
  return ''
}

/**
 * @param {object} o
 * @param {object} o.ctx        DSH 给插件的 ctx
 * @param {object} o.core       核心对象（hub、onebot、local……），模块通过 api.core 拿到
 * @param {Function} o.getConfig
 * @param {Function} o.setConfig
 * @param {object} o.logger
 * @param {string} o.version     插件版本
 * @param {object[]} o.builtins  内置模块定义（按启动顺序）
 */
export function createModules({ ctx, core, getConfig, setConfig, logger, version, builtins }) {
  const log = logger.child('modules')
  const builtinDefs = new Map(builtins.map((d) => [d.id, d]))
  const state = createModuleState()
  const { live, errors, routes, listeners, revisions, userSeen } = state
  let note = () => {}
  const panel = createModulePanel({
    state, isDisposed: () => disposed, note: (...args) => note(...args), log, getConfig,
    builtinDefs, exportsOf: (...args) => exportsOf(...args), status: (...args) => status(...args),
    ID_RE, BUILTIN_DIR,
  })
  const { emit, claim, filter, filterSync, buildTools, contextFor, rules, commands, dshTools, builtinOff, handle, panelSource, publicHandle } = panel
  let watching = null
  let disposed = false

  const modCfg = (id) => getConfig().modules?.[id] || {}
  const isEnabled = (id) => modCfg(id).enabled !== false
  const isUserOn = () => !getConfig().safeMode
  // 接口挂在哪：内置模块（以及从内置搬到社区库的那几个）沿用原来的根路径，别的模块挂在自己的 /ext/<id>/ 下。
  // 面板里的 call('/x') 要用同一份判断决定基址（见 status().routesAtRoot），两边不能各算各的。
  const routesAtRoot = (id) => builtinDefs.has(id) || STABLE_ROUTES.has(id)

  const apiKit = createModuleApi({
    state, isDisposed: () => disposed, logger, getConfig, setConfig, version, API_VERSION,
    BUILTIN_DIR, core, ctx, lib, defineTool, routesAtRoot, emit,
    cleanup: (...args) => cleanup(...args),
  })
  note = apiKit.note
  const { makeApi, exportsOf } = apiKit
  const registry = createModuleRegistry({
    state, builtinDefs, getConfig, setConfig, version, API_VERSION, ID_RE, BUILTIN_DIR, SRC,
    DOC, TYPES, userDir, libKeys, scanUser, routesAtRoot, modCfg,
  })
  const { capabilitiesOf, status, installDocs, create, fork, promptFor } = registry

  // 卸载接口保持同步；模块自己的同步 / 异步收尾失败只记日志。
  function cleanup(fn) {
    const failed = (error) => log.warn('模块清理失败：', String(error?.message || error))
    try { Promise.resolve(fn()).catch(failed) } catch (error) { failed(error) }
  }

  // ---------- 启动 / 停止 ----------
  async function start(def, source, extra = {}) {
    if (disposed) return null
    const id = def.id
    const rec = { id, def, source, exports: null, offs: [], tools: [], contexts: [], rules: [], commands: [], dshTools: [], errors: [], startedAt: Date.now(), ...extra }
    // 设置里的密码字段不回传给面板
    for (const f of def.settings || []) if (f && f.type === 'password' && f.key) registerSecretField(['ext', id, f.key])
    // 设置的默认值补进配置（面板表单直接有值可改；已经填过的不动）
    if (def.defaults && typeof def.defaults === 'object') {
      const cur = getConfig().ext?.[id] || {}
      const missing = Object.keys(def.defaults).filter((k) => !(k in cur))
      if (missing.length) setConfig({ ...getConfig(), ext: { ...getConfig().ext, [id]: { ...Object.fromEntries(missing.map((k) => [k, def.defaults[k]])), ...cur } } })
    }
    live.set(id, rec)
    errors.delete(id)
    state.generation++ // 新实例：会话里的工具要在下一轮重挂（issue #73）
    try {
      const api = makeApi(id, source, rec)
      const r = def.setup(api)
      const exports = (r && typeof r.then === 'function' ? await r : r) ?? {}
      if (disposed || rec.stopped || live.get(id) !== rec) {
        cleanup(() => exports?.dispose?.())
        return null
      }
      rec.exports = exports
      log.info(`模块「${def.name || id}」${source !== 'user' ? '' : existsSync(join(rec.dir, '.aurabot-source.json')) ? '（模块市场）' : '（自己写的）'}已启动`)
      emit('module/start', id)
    } catch (error) {
      if (disposed || rec.stopped || live.get(id) !== rec) return null
      stop(id, { quiet: true })
      errors.set(id, { message: String(error && error.message ? error.message : error).slice(0, 800), at: Date.now(), source })
      log.warn(`模块「${def.name || id}」启动失败：`, error.message)
    }
    return live.get(id)
  }

  /** 同步启动（内置模块的 setup 都是同步的，插件一加载就要能用）。 */
  function startSync(def) {
    if (disposed) return
    const id = def.id
    const rec = { id, def, source: 'builtin', exports: null, offs: [], tools: [], contexts: [], rules: [], commands: [], dshTools: [], errors: [], startedAt: Date.now() }
    live.set(id, rec)
    state.generation++ // 内置模块（重）启动也换代际：会话里的工具要在下一轮重挂
    if (errors.get(id)?.source !== 'user') errors.delete(id) // 替换版的报错留着给面板看
    try {
      const r = def.setup(makeApi(id, 'builtin', rec))
      if (r && typeof r.then === 'function') throw new Error('内置模块的 setup 要同步返回')
      rec.exports = r ?? {}
    } catch (error) {
      stop(id, { quiet: true })
      errors.set(id, { message: String(error.message || error).slice(0, 800), at: Date.now(), source: 'builtin' })
      log.error(`内置模块「${def.name || id}」启动失败：`, error.message)
    }
  }

  function stop(id, { quiet = false } = {}) {
    revisions.set(id, (revisions.get(id) || 0) + 1)
    const rec = live.get(id)
    if (!rec) return false
    live.delete(id)
    state.generation++ // 停止或替换也使会话工具缓存失效
    rec.stopped = true
    for (const off of rec.offs.splice(0).reverse()) cleanup(off)
    cleanup(() => rec.exports?.dispose?.())
    rec.exports = null
    // 路由和监听器由各自的 off 按实例撤销，清理期间可能已经启动了同名新实例。
    if (rec.dshTools.length) core.bridge?.refresh()
    if (!quiet) { log.info(`模块「${rec.def.name || id}」已停下`); emit('module/stop', id) }
    return true
  }

  /** 加载一个自己写的模块（按修改时间重新 import，改了就是新的）。 */
  /**
   * 加载自己写的模块：先把整个文件夹拍一份快照（modules/<id>/.aurabot-cache/<版本戳>/）再加载快照。
   * Node 会缓存加载过的文件，快照路径每次不同，所以改了模块里任何一个文件都会重新加载；
   * 快照在模块文件夹里面，模块自己 npm install 的依赖（modules/<id>/node_modules）照样找得到。
   */
  async function importUser(u) {
    const stamp = stampOf(u.dir)
    const root = join(u.dir, SNAP)
    const snap = join(root, String(stamp).replace('.', '-'))
    if (!existsSync(snap)) {
      for (const f of filesOf(u.dir)) {
        mkdirSync(dirname(join(snap, f)), { recursive: true })
        copyFileSync(join(u.dir, f), join(snap, f))
      }
    }
    // 旧快照删掉（加载过的代码已经在内存里，删文件不影响）
    try { for (const n of readdirSync(root)) if (join(root, n) !== snap) rmSync(join(root, n), { recursive: true, force: true }) } catch (error) {}
    const mod = await import(pathToFileURL(join(snap, relative(u.dir, u.file))).href)
    return { def: mod.default, stamp }
  }

  async function startUser(u) {
    if (disposed) return null
    const revision = revisions.get(u.id) || 0
    const stillWanted = () => {
      const users = isUserOn() ? scanUser() : []
      return wanted(u.id, users) === 'user' && users.some((item) => item.id === u.id && item.file === u.file)
    }
    let def
    let stamp = 0
    try {
      ({ def, stamp } = await importUser(u))
      if (disposed || (revisions.get(u.id) || 0) !== revision) return null
      if (!stillWanted()) { resyncRequested = true; return null }
      const why = checkDef(def, u.id)
      if (why) throw new Error(why)
    } catch (error) {
      if (disposed || (revisions.get(u.id) || 0) !== revision) return null
      if (!stillWanted()) { resyncRequested = true; return null }
      errors.set(u.id, { message: String(error.message || error).slice(0, 800), at: Date.now(), source: 'user', fallback: builtinDefs.has(u.id) })
      log.warn(`模块「${u.id}」加载失败：`, error.message)
      userSeen.set(u.id, { ...u, stamp: stampOf(u.dir) })
      return null
    }
    userSeen.set(u.id, { ...u, stamp })
    // 替换内置模块：记下替换时内置模块的版本，以后内置的更新了提醒一声
    const b = builtinDefs.get(u.id)
    const extra = { dir: u.dir }
    if (b) {
      extra.replaces = b.version
      const m = modCfg(u.id)
      if (!m.forkedFrom) setConfig({ ...getConfig(), modules: { ...getConfig().modules, [u.id]: { ...m, forkedFrom: b.version || version } } })
    }
    // setConfig 可能同步触发安全模式或关闭模块，再确认一次才执行 setup。
    if (disposed || (revisions.get(u.id) || 0) !== revision) return null
    if (!stillWanted()) { resyncRequested = true; return null }
    return start(def, 'user', extra)
  }

  /** 这个 id 现在该跑哪个版本：'user' | 'builtin' | null（关着）。 */
  function wanted(id, users) {
    if (!isEnabled(id)) return null
    const hasUser = isUserOn() && users.some((u) => u.id === id)
    if (hasUser && !(builtinDefs.has(id) && modCfg(id).useBuiltin)) return 'user'
    return builtinDefs.has(id) ? 'builtin' : null
  }

  /** 插件加载时：内置模块同步启动（被替换 / 关掉的跳过），自己写的随后异步加载。 */
  function boot() {
    if (disposed) return Promise.resolve()
    const users = isUserOn() ? scanUser() : []
    for (const def of builtins) if (wanted(def.id, users) === 'builtin') startSync(def)
    return (async () => {
      await loadLib()
      if (disposed) return
      globalThis.aurabot = { lib, src: pathToFileURL(SRC).href, version, apiVersion: API_VERSION, modules: publicHandle }
      installDocs()
      await sync()
      if (disposed) return
      watching = setInterval(() => { sync().catch((error) => log.warn('检查模块变化出错：', error.message)) }, 3000)
      watching.unref?.()
    })().catch((error) => log.error('加载自己写的模块出错：', error.message))
  }

  /** 按配置和文件夹的现状，把该开的开、该关的关、改过的重新加载。 */
  let syncing = null
  let resyncRequested = false
  async function syncPass() {
    const users = isUserOn() ? scanUser() : []
    const ids = new Set([...builtinDefs.keys(), ...users.map((u) => u.id), ...live.keys()])
    for (const id of ids) {
      if (disposed || resyncRequested) return
      const want = wanted(id, users)
      const rec = live.get(id)
      const u = users.find((x) => x.id === id)
      if (!want) { if (rec) stop(id); continue }
      if (want === 'builtin') {
        if (rec && rec.source === 'builtin') continue
        if (rec) stop(id)
        if (errors.get(id)?.source === 'builtin' && !rec) continue // 内置的启动失败过，别每 3 秒重试
        startSync(builtinDefs.get(id))
        continue
      }
      // 自己写的：没跑、换了文件、改过 → (重新)加载
      const seen = userSeen.get(id)
      const changed = !seen || seen.file !== u.file || seen.stamp !== stampOf(u.dir)
      if (rec && rec.source === 'user' && !changed) continue
      if (!changed && (!rec || rec.fallback)) continue // 上次加载失败、文件也没改：等改了再试
      if (rec) stop(id, { quiet: true })
      if (seen && changed) log.info(`模块「${id}」文件改了，重新加载`)
      const revision = revisions.get(id) || 0
      const ok = await startUser(u)
      if (disposed) return
      // import 期间被停止或改了配置时，由下一次检查决定是否启动。
      if ((revisions.get(id) || 0) !== revision || resyncRequested) continue
      // 替换版加载失败：先用回内置的，免得这项功能直接没了
      if (!ok && builtinDefs.has(id)) {
        startSync(builtinDefs.get(id))
        const back = live.get(id)
        if (back) { back.fallback = true; log.warn(`模块「${id}」：你的版本没加载成功，先用内置的`) }
      }
    }
    for (const id of [...userSeen.keys()]) if (!users.some((u) => u.id === id)) { userSeen.delete(id); if (errors.get(id)?.source === 'user') errors.delete(id) }
  }

  function sync() {
    if (disposed) return Promise.resolve()
    if (syncing) { resyncRequested = true; return syncing }
    syncing = (async () => {
      do {
        resyncRequested = false
        await syncPass()
      } while (resyncRequested && !disposed)
    })().finally(() => { syncing = null })
    return syncing
  }

  /** 强制重新加载一个模块（面板「重新加载」）。 */
  async function reload(id) {
    stop(id, { quiet: true })
    errors.delete(id)
    userSeen.delete(id)
    await sync()
    return status().find((m) => m.id === id) || null
  }

  function dispose() {
    if (disposed) return
    disposed = true
    clearInterval(watching)
    for (const id of [...live.keys()].reverse()) stop(id, { quiet: true })
    routes.clear()
    listeners.clear()
    if (globalThis.aurabot?.modules === publicHandle) delete globalThis.aurabot
  }

  return {
    boot, sync, reload, stop, dispose, status, create, fork, promptFor, panelSource,
    use: exportsOf, has: (id) => live.has(id), running: (id) => live.get(id)?.source || null, generation: () => state.generation,
    capabilitiesOf,
    emit, claim, filter, filterSync, buildTools,
    // 插件核心自己听事件（不属于任何模块，不会被撤掉）
    listen: (event, fn) => { const item = { id: '@core', fn }; listeners.set(event, [...(listeners.get(event) || []), item]); return () => listeners.set(event, (listeners.get(event) || []).filter((x) => x !== item)) }, contextFor, rules, commands, dshTools, builtinOff, handle,
    hasRoute: (path) => routes.has(path),
    routeAccess: (path) => routes.get(path)?.access || null,
    dir: userDir,
  }
}

