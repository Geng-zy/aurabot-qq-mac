// 模块内核：管理内置和用户功能的生命周期。用户模块放数据目录 modules/（升级不会动）。
//
// - 每个模块能单独开关；自己写的模块和内置的同名，就替换掉内置的
// - 模块之间用 api.use('模块id') 拿对方导出的东西，用的时候再拿（对方被关了、换了也不会拿到旧的）
// - 模块注册的工具、上下文、命令、定时任务、面板接口都记在模块名下，关掉 / 重新加载时一起撤掉
// - 一个模块出错只影响它自己：启动失败记下原因，其他照常跑
// - 自己写的模块保存就生效（按修改时间重新加载），不用重启 DSH
//
// 接口说明给写模块的人看：src/modules/API.md（每次启动复制到数据目录 modules/ 里）。

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dataDir } from './store.js'
import { defineTool } from '../tools/tools.js'
import { createModuleState } from './module-state.js'
import { createModulePanel } from './module-panel.js'
import { createModuleApi } from './module-api.js'
import { createModuleRegistry } from './module-registry.js'
import { createModuleLoader } from './module-loader.js'
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
  let isLoaderDisposed = () => false
  const panel = createModulePanel({
    state, isDisposed: (...args) => isLoaderDisposed(...args), note: (...args) => note(...args), log, getConfig,
    builtinDefs, exportsOf: (...args) => exportsOf(...args), status: (...args) => status(...args),
    ID_RE, BUILTIN_DIR,
  })
  const { emit, claim, filter, filterSync, buildTools, contextFor, rules, commands, dshTools, builtinOff, handle, panelSource, publicHandle } = panel

  const modCfg = (id) => getConfig().modules?.[id] || {}
  const isEnabled = (id) => modCfg(id).enabled !== false
  const isUserOn = () => !getConfig().safeMode
  // 接口挂在哪：内置模块沿用原来的根路径，社区/自己写的模块挂在自己的 /ext/<id>/ 下。
  // 面板里的 call('/x') 要用同一份判断决定基址（见 status().routesAtRoot），两边不能各算各的。
  const routesAtRoot = (id) => builtinDefs.has(id)

  const apiKit = createModuleApi({
    state, isDisposed: (...args) => isLoaderDisposed(...args), logger, getConfig, setConfig, version, API_VERSION,
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
  const platformAllowed = (def) => {
    const wanted = Array.isArray(def?.platforms) ? def.platforms.filter(Boolean) : []
    if (!wanted.length) return true
    // 没有 channel 注册表时保持旧行为（测试/工具型调用），有注册表才做平台门禁。
    if (!core?.channels?.get) return true
    return wanted.some((p) => Boolean(core.channels.get(p)))
  }
  const loader = createModuleLoader({
    state, builtinDefs, builtins, getConfig, setConfig, version, API_VERSION, SRC,
    makeApi, exportsOf, emit, cleanup, installDocs, status, publicHandle, log, modCfg,
    isEnabled, isUserOn, scanUser, checkDef, stampOf, filesOf, SNAP, loadLib, lib, platformAllowed,
    refreshBridge: () => core.bridge?.refresh(),
  })
  isLoaderDisposed = loader.isDisposed
  const { boot, sync, reload, stop, dispose } = loader

  // 卸载接口保持同步；模块自己的同步 / 异步收尾失败只记日志。
  function cleanup(fn) {
    const failed = (error) => log.warn('模块清理失败：', String(error?.message || error))
    try { Promise.resolve(fn()).catch(failed) } catch (error) { failed(error) }
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

