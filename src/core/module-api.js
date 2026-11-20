import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './store.js'
import { scopeCoreForModule, lazyProxy, deepMerge } from './module-code.js'

export function createModuleApi({ state, isDisposed, logger, getConfig, setConfig, version, API_VERSION, BUILTIN_DIR, core, ctx, lib, defineTool, routesAtRoot, emit, cleanup }) {
  const { live, listeners, routes } = state
  const log = logger.child('modules')
  // ---------- 给模块的 api ----------
  function makeApi(id, source, rec) {
    const mlog = logger.child(id)
    const active = () => !isDisposed() && !rec.stopped && live.get(id) === rec
    const writable = (label, fn) => (...args) => {
      if (!active()) {
        const error = new Error(`模块「${id}」已停止，不能调用 ${label}`)
        mlog.warn(error.message)
        throw error
      }
      return fn(...args)
    }
    const guard = (label, fn) => (...args) => {
      if (!active()) return
      try {
        const r = fn(...args)
        if (r && typeof r.then === 'function') return r.catch((error) => { note(id, label, error); throw error })
        return r
      } catch (error) {
        note(id, label, error)
        throw error
      }
    }
    const track = (off) => {
      if (typeof off === 'function') {
        if (active()) rec.offs.push(off)
        else cleanup(off)
      }
      return off
    }
    // 内置模块和替换它的版本用原来的路径（内置的面板页照常能用）；新模块放在 /ext/模块id/ 下
    const prefix = routesAtRoot(id) ? '' : `/ext/${id}`
    const def = rec.def
    // 模块拿到的 core：hub 换成「宿主按模块身份封装」的白名单副本（三审 #177：原型链斩断，
    // 模块摸不到原始 runSubagentTurn / subagentFor）；core 本体用 Proxy 转发，
    // getPrototypeOf 也掐断，防 getPrototypeOf(api.core).hub 绕回原始入口。
    const scopedCore = scopeCoreForModule(core, id)
    const api = {
      id,
      source,
      // 模块自己的文件夹（读自己带的数据文件用这个；import.meta.url 指向的是加载快照）
      dir: rec.dir || join(BUILTIN_DIR, id),
      apiVersion: API_VERSION,
      version,
      log: mlog,
      // ---- 配置 ----
      // 只读快照：模块不能原地改宿主配置，再借下一次保存落盘。
      config: () => structuredClone(getConfig()),

      setConfig: writable('setConfig', (patch) => setConfig(typeof patch === 'function' ? patch(getConfig()) : deepMerge(getConfig(), patch))),
      settings: () => ({ ...(def.defaults || {}), ...(getConfig().ext?.[id] || {}) }),
      saveSettings: writable('saveSettings', (patch) => {
        const cfg = getConfig()
        setConfig({ ...cfg, ext: { ...cfg.ext, [id]: { ...(cfg.ext?.[id] || {}), ...patch } } })
        return api.settings()
      }),
      dataDir: (...parts) => { const d = dataDir('modules-data', id); mkdirSync(d, { recursive: true }); return join(d, ...parts) },
      // ---- 别的模块和插件内部 ----
      use: (other) => exportsOf(other),
      lazy: (other) => lazyProxy(() => exportsOf(other)),
      has: (other) => live.has(other),
      core: scopedCore,
      // 心智核心：模块只能往她的经历里添她做过、看过的事，和查她记得的事；不能替她做决定、不能改她
      mind: (() => {
        const m = typeof core.mindFor === 'function' ? core.mindFor(id, source) : null
        // 模块停了（关掉、热重载、替换），它交给她的事跟着撤掉，免得她去调用一个已经停了的模块
        return m ? Object.freeze({ ...m, offer: (a) => track(m.offer(a)) }) : null
      })(),
      dsh: ctx,
      lib,
      // ---- 往插件里加东西 ----
      tool: (builder) => { rec.tools.push(builder); return () => remove(rec.tools, builder) },
      defineTool,
      context: (fn) => { rec.contexts.push(fn); return () => remove(rec.contexts, fn) },
      rule: (fn) => { rec.rules.push(fn); return () => remove(rec.rules, fn) },
      command: (c) => {
        if (!c || !c.name || typeof c.run !== 'function') throw new Error('command 要有 name 和 run')
        const item = { ...c, module: id }
        rec.commands.push(item)
        return () => remove(rec.commands, item)
      },
      on: (event, fn) => {
        const item = { id, fn: guard(`事件 ${event}`, fn) }
        const list = listeners.get(event) || []
        list.push(item)
        listeners.set(event, list)
        const off = () => listeners.set(event, (listeners.get(event) || []).filter((x) => x !== item))
        track(off)
        return off
      },
      emit: writable('emit', (event, ...args) => emit(event, ...args)),
      every: (ms, fn, label = '定时任务') => {
        const t = setInterval(() => {
          if (!active()) return
          // 调试模式不跑定时任务：逛空间这些都别在调试里自己动
          if (getConfig().debug) return
          Promise.resolve().then(() => { if (active()) return fn() }).catch((error) => note(id, label, error))
        }, Math.max(1000, Number(ms) || 60_000))
        t.unref?.()
        return track(() => clearInterval(t))
      },
      later: (ms, fn) => {
        const t = setTimeout(() => { Promise.resolve().then(() => { if (active()) return fn() }).catch((error) => note(id, '延时任务', error)) }, Math.max(0, Number(ms) || 0))
        t.unref?.()
        return track(() => clearTimeout(t))
      },
      route: (path, handler, options = {}) => {
        if (!active()) return () => {}
        if (options.access != null && options.access !== 'panel') throw new Error('路由 access 只支持 panel')
        const full = '/aurabot/api' + prefix + (String(path).startsWith('/') ? path : '/' + path)
        const cur = routes.get(full)
        if (cur && cur.id !== id && live.has(cur.id)) throw new Error(`接口 ${full} 已经被模块「${cur.id}」占了`)
        const route = { id, handler: guard(`接口 ${path}`, handler), access: options.access || null }
        routes.set(full, route)
        return track(() => { if (routes.get(full) === route) routes.delete(full) })
      },
      onDispose: (fn) => track(fn),
      // ---- 常用操作的捷径（都是 core 里的东西包了一层）----
      send: writable('send', (chatId, text) => core.hub.deliver(String(chatId), String(text ?? ''))),
      sendText: writable('sendText', (chatId, text) => core.hub.sendBackground
        ? core.hub.sendBackground(String(chatId), [{ type: 'text', data: { text: String(text ?? '') } }], `[${id}]`)
        : core.hub.sendText(String(chatId), String(text ?? ''))),
      // 回某一条消息：群里以「引用回复」发出，私聊直接发
      reply: writable('reply', (msg, text) => core.hub.sendBackground
        ? core.hub.sendBackground(String(msg.chatId), [{ type: 'text', data: { text: String(text ?? '') } }, ...(msg.kind === 'group' && msg.messageId ? [{ type: 'reply', data: { id: String(msg.messageId) } }] : [])], `[${id}]`)
        : core.hub.sendText(String(msg.chatId), String(text ?? ''), msg.kind === 'group' ? msg.messageId : undefined)),
      isOwner: (userId) => String(userId) === String(getConfig().ownerQQ),
      sendImage: writable('sendImage', (chatId, src) => core.hub.sendImage(String(chatId), src)),
      sendSegments: writable('sendSegments', (chatId, segs, note) => core.hub.sendBackground
        ? core.hub.sendBackground(String(chatId), segs, note || `[${id}]`)
        : core.hub.sendSegments(String(chatId), segs, note || `[${id}]`)),
      // 发任意文件（文档 / 压缩包 / 音频 / 视频……）：本机绝对路径，或网关能取到的网址 / base64://
      sendFile: writable('sendFile', (chatId, file, name) => core.hub.sendFile(String(chatId), file, name)),
      // 把一个音频文件当语音条发出去（不走念文字）
      sendVoiceFile: writable('sendVoiceFile', (chatId, file, note) => core.hub.sendVoiceFile(String(chatId), file, note || `[${id}] 语音`)),
      // module: id —— 这次模型调用的用量记到哪个模块名下（面板「概览」的 token 明细）
      ask: writable('ask', (opts) => core.ask(typeof opts === 'string' ? { text: opts, module: id } : { ...opts, module: id })),
      think: writable('think', (prompt, opts = {}) => core.hub.runSystemTurn(`ext-${id}`, opts.title || def.name || id, String(prompt), opts)),
      onebot: writable('onebot', (action, params, opts) => core.onebot.call(action, params, opts)),
      dshTool: (tool) => { if (!active()) return () => {}; rec.dshTools.push(tool); core.bridge?.refresh(); return () => { remove(rec.dshTools, tool); core.bridge?.refresh() } },
    }
    return api
  }

  function remove(list, item) {
    const i = list.indexOf(item)
    if (i >= 0) list.splice(i, 1)
  }

  function note(id, label, error) {
    const message = String(error && error.message ? error.message : error).slice(0, 500)
    const rec = live.get(id)
    if (rec) {
      rec.errors.unshift({ at: Date.now(), label, message })
      rec.errors.length = Math.min(rec.errors.length, 8)
    }
    log.warn(`模块「${id}」${label}出错：`, message)
  }

  function exportsOf(id) {
    const rec = live.get(id)
    return rec ? rec.exports : null
  }


  return { makeApi, remove, note, exportsOf }
}
