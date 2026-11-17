// 模块内核的面板/事件/工具汇总层：只读 state，不负责启动和停止。
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

/**
 * @param {object} o
 * @param {ReturnType<import('./module-state.js').createModuleState>} o.state
 * @param {() => boolean} o.isDisposed
 * @param {(id:string, label:string, error:Error) => void} o.note
 * @param {object} o.log
 * @param {() => object} o.getConfig
 * @param {Map<string, object>} o.builtinDefs
 * @param {(id:string) => object} o.exportsOf
 * @param {() => object[]} o.status
 * @param {RegExp} o.ID_RE
 * @param {string} o.BUILTIN_DIR
 */
export function createModulePanel({ state, isDisposed, note, log, getConfig, builtinDefs, exportsOf, status, ID_RE, BUILTIN_DIR }) {
  const { live, routes, listeners, userSeen } = state

  function emit(event, ...args) {
    if (isDisposed()) return
    for (const { fn } of listeners.get(event) || []) {
      try { const r = fn(...args); if (r && typeof r.catch === 'function') r.catch(() => {}) } catch (error) {}
    }
  }
  /** 依次问每个模块，第一个返回真值的接管（收到消息时用）。 */
  async function claim(event, ...args) {
    for (const { fn } of listeners.get(event) || []) {
      try { if (await fn(...args)) return true } catch (error) {}
    }
    return false
  }
  /** 依次让每个模块改写一个值（发回复前用）：返回 undefined 不改，null 拦下。 */
  async function filter(event, value, ...args) {
    let v = value
    for (const { fn } of listeners.get(event) || []) {
      try {
        const r = await fn(v, ...args)
        if (r === null) return null
        if (r !== undefined) v = r
      } catch (error) {}
    }
    return v
  }
  /** 同步版（人格、规则、模型选择这些地方不能等）：监听函数返回 Promise 的不算。 */
  function filterSync(event, value, ...args) {
    let v = value
    for (const { fn } of listeners.get(event) || []) {
      try {
        const r = fn(v, ...args)
        if (r && typeof r.then === 'function') continue
        if (r === null) return null
        if (r !== undefined) v = r
      } catch (error) {}
    }
    return v
  }

  function buildTools(where) {
    const out = []
    const names = new Set()
    for (const rec of live.values()) {
      for (const b of rec.tools) {
        let r
        try { r = typeof b === 'function' ? b(where) : b } catch (error) { note(rec.id, '生成工具', error); continue }
        for (const t of [].concat(r || [])) {
          if (!t || !t.name) continue
          if (names.has(t.name)) { log.debug(`工具 ${t.name} 重名，模块「${rec.id}」的没挂`); continue }
          names.add(t.name)
          out.push(t)
        }
      }
    }
    return out
  }
  function contextFor(args) {
    const parts = []
    for (const rec of live.values()) {
      for (const fn of rec.contexts) {
        try { const t = fn(args); if (t) parts.push(String(t)) } catch (error) {}
      }
    }
    return parts.join('\n\n')
  }
  function rules(kind) {
    const out = []
    for (const rec of live.values()) {
      for (const fn of rec.rules) {
        try { const t = typeof fn === 'function' ? fn(kind, getConfig()) : fn; for (const line of [].concat(t || [])) if (line) out.push(String(line)) } catch (error) {}
      }
    }
    return out
  }
  const commands = () => [...live.values()].flatMap((r) => r.commands)
  const dshTools = () => [...live.values()].flatMap((r) => r.dshTools.map((t) => ({ ...t, module: r.id })))
  /** 内置模块里没在跑的（关掉的、被替换的）。 */
  const builtinOff = () => new Set([...builtinDefs.keys()].filter((id) => live.get(id)?.source !== 'builtin'))

  async function handle(path, req, res) {
    const r = routes.get(path)
    if (!r || !live.has(r.id)) return { ok: false, message: '这个功能所在的模块没开（面板「已安装」里看看）', moduleOff: true }
    return r.handler(req, res)
  }

  /** file 是不是在 root 目录里面（root 自己不算；越过 root 的 ../ 一律不算）。 */
  function inside(root, file) {
    const rel = relative(resolve(root), resolve(file))
    return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)
  }

  /**
   * 模块的面板代码（panel.js），面板拿去执行。
   * 内置模块也允许带面板：两者本来就是同一条加载链路，面板只需要「定义里声明了 panel」。
   * 面板文件从模块自己的文件夹读：用户模块在数据目录 modules/<id>，内置模块在 src/modules/<id>；
   * 两边都要求落在各自的根目录里，防止 panel 写成 ../../xxx 去读根目录外面的文件。
   */
  function panelSource(id) {
    const rec = live.get(id)
    if (!rec || !rec.def.panel) return null
    const builtin = rec.source !== 'user'
    const root = builtin
      ? (ID_RE.test(String(id)) ? join(BUILTIN_DIR, id) : '')
      : (rec.dir || userSeen.get(id)?.dir || '')
    if (!root) return null
    const file = resolve(root, typeof rec.def.panel === 'string' ? rec.def.panel : 'panel.js')
    if (!inside(root, file) || !existsSync(file)) return null
    return readFileSync(file, 'utf8')
  }

  const publicHandle = { use: exportsOf, has: (id) => live.has(id), list: () => status().map(({ id, name, running }) => ({ id, name, running })), emit }

  return { emit, claim, filter, filterSync, buildTools, contextFor, rules, commands, dshTools, builtinOff, handle, panelSource, publicHandle }
}
