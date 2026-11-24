// 模块生命周期：启动、停止、热重载、同步和卸载。
// 只依赖 state 与组合根传进来的依赖，不直接碰面板/注册表实现。
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerSecretField } from './config.js'

export function createModuleLoader({ state, builtinDefs, builtins, getConfig, setConfig, version, API_VERSION, SRC, makeApi, exportsOf, emit, cleanup, installDocs, status, publicHandle, log, modCfg, isEnabled, isUserOn, scanUser, checkDef, stampOf, filesOf, SNAP, loadLib, lib, platformAllowed = () => true, refreshBridge }) {
  const { live, errors, routes, listeners, revisions, userSeen } = state
  let watching = null
  let disposed = false
  let syncing = null
  let resyncRequested = false
  // ---------- 启动 / 停止 ----------
  async function start(def, source, extra = {}) {
    if (disposed) return null
    if (!platformAllowed(def)) return null
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
      log.info(`模块「${def.name || id}」${source !== 'user' ? '' : existsSync(join(rec.dir, '.aurabot-source.json')) ? '（模块库）' : '（自己写的）'}已启动`)
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
    if (!platformAllowed(def)) return
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
    if (rec.dshTools.length) refreshBridge()
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
    const complete = join(snap, '.complete')
    if (!existsSync(complete) || stampOf(snap) !== stamp) {
      const tmp = join(root, '.tmp-' + randomUUID())
      try {
        for (const f of filesOf(u.dir)) {
          const target = join(tmp, f)
          mkdirSync(dirname(target), { recursive: true })
          copyFileSync(join(u.dir, f), target)
          if (statSync(target).size !== statSync(join(u.dir, f)).size) throw new Error('快照复制不完整：' + f)
        }
        if (stampOf(tmp) !== stamp) throw new Error('快照内容在复制期间发生变化')
        writeFileSync(join(tmp, '.complete'), 'ok')
        rmSync(snap, { recursive: true, force: true })
        renameSync(tmp, snap)
      } catch (error) {
        rmSync(tmp, { recursive: true, force: true })
        throw error
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
    // 群管回归内置：老用户数据目录里残留的同名社区模块不再覆盖内置版；从面板 fork 出来的仍然用用户版。
    const preferBuiltin = id === 'group-admin' && !modCfg(id).forkedFrom
    if (hasUser && !(builtinDefs.has(id) && (preferBuiltin || modCfg(id).useBuiltin))) return 'user'
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
      watching = setInterval(() => { sync().catch((error) => log.warn('检查模块变化出错：', error.message)) }, 5000)
      watching.unref?.()
    })().catch((error) => log.error('加载自己写的模块出错：', error.message))
  }

  /** 按配置和文件夹的现状，把该开的开、该关的关、改过的重新加载。 */
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
      if (!changed) {
        if (rec && !rec.fallback) continue
        // 没有实例但也没有加载错误 = 刚被关闭后重新打开，继续启动；只有真的失败过才等文件变化。
        if (!rec && errors.get(id)?.source === 'user') continue
      }
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


  return { start, startSync, stop, boot, sync, reload, dispose, isDisposed: () => disposed }
}
