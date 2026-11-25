// 模块注册表：定义从哪来、面板看什么、新建/复制/文档。
// 只读 state 和配置，不负责启动/停止。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { rewriteImports } from './module-code.js'

export function createModuleRegistry({ state, builtinDefs, getConfig, setConfig, version, API_VERSION, ID_RE, BUILTIN_DIR, SRC, DOC, TYPES, userDir, libKeys, scanUser, routesAtRoot, modCfg }) {
  const { live, errors, routes, userSeen } = state

  /** 模块声明的能力（module.json 的 capabilities 数组）：内置模块没有 module.json 就当未声明（[]）。 */
  function capabilitiesOf(id) {
    const key = String(id || '')
    if (!ID_RE.test(key)) return []
    for (const dir of [join(userDir(), key), join(BUILTIN_DIR, key)]) {
      const file = join(dir, 'module.json')
      if (!existsSync(file)) continue
      try {
        const m = JSON.parse(readFileSync(file, 'utf8'))
        return Array.isArray(m.capabilities) ? m.capabilities.map(String) : []
      } catch (error) {
        return []
      }
    }
    return []
  }

  function toolNames(rec) {
    if (Array.isArray(rec.toolNamesCache)) return rec.toolNamesCache
    const names = []
    for (const b of rec.tools) {
      try {
        const r = typeof b === 'function' ? b({ chat: { chatId: 'private:0', kind: 'private', userId: '0' }, level: 'full', sessionId: '' }) : b
        for (const t of [].concat(r || [])) if (t?.name) names.push(t.name)
      } catch {}
    }
    rec.toolNamesCache = names
    return names
  }

  function status() {
    const users = scanUser()
    const ids = [...builtinDefs.keys(), ...[...new Set([...users.map((u) => u.id), ...live.keys()])].filter((id) => !builtinDefs.has(id)).sort()]
    return ids.map((id) => {
      const b = builtinDefs.get(id)
      const u = users.find((x) => x.id === id)
      const rec = live.get(id)
      const def = rec?.def || b || {}
      const m = modCfg(id)
      const err = errors.get(id)
      return {
        id,
        name: def.name || id,
        description: def.description || '',
        version: def.version || '',
        builtin: Boolean(b),
        builtinVersion: b?.version || '',
        hasUser: Boolean(u),
        community: Boolean(u && existsSync(join(u.dir, '.aurabot-source.json'))),
        userDir: u?.dir || '',
        safeSkipped: Boolean(u?.safe),
        running: rec ? rec.source : null,
        fallback: Boolean(rec?.fallback),
        enabled: m.enabled !== false,
        useBuiltin: Boolean(m.useBuiltin),
        forkedFrom: m.forkedFrom || '',
        outdated: Boolean(b && rec?.source === 'user' && m.forkedFrom && m.forkedFrom !== b.version),
        error: err ? err.message : '',
        errors: rec ? rec.errors : [],
        tools: rec ? toolNames(rec) : [],
        commands: rec ? rec.commands.map((c) => c.name) : [],
        routes: [...routes].filter(([, r]) => r.id === id).map(([p]) => p.replace('/aurabot/api', '')),
        settings: rec?.source === 'user' || (!rec && u) ? (def.settings || []) : [],
        defaults: def.defaults || {},
        panel: Boolean(rec && def.panel),
        routesAtRoot: routesAtRoot(id),
        tab: def.tab || '',
        platform: def.platform || '',
        platformFeature: Boolean(def.platformFeature),
        flag: typeof def.flag === 'string' ? def.flag : (def.settings || []).some((f) => f?.key === 'enabled') ? 'enabled' : '',
        keepPanel: Boolean(def.keepPanel),
        startedAt: rec?.startedAt || 0,
      }
    })
  }

  function installDocs() {
    try {
      mkdirSync(userDir(), { recursive: true })
      const doc = readFileSync(join(BUILTIN_DIR, DOC), 'utf8').replaceAll('{{VERSION}}', version).replaceAll('{{API}}', String(API_VERSION)).replace('{{LIB}}', libKeys().map((k) => '- `' + k + '`').join('\n'))
      const dest = join(userDir(), DOC)
      if (!existsSync(dest) || readFileSync(dest, 'utf8') !== doc) writeFileSync(dest, doc, 'utf8')
      const types = readFileSync(join(BUILTIN_DIR, TYPES), 'utf8')
      const tdest = join(userDir(), TYPES)
      if (!existsSync(tdest) || readFileSync(tdest, 'utf8') !== types) writeFileSync(tdest, types, 'utf8')
    } catch {}
  }

  function create(id, name) {
    if (!ID_RE.test(id)) return { ok: false, message: 'id 要小写字母开头，只能有小写字母、数字和 -，比如 weather' }
    const dir = join(userDir(), id)
    if (existsSync(dir)) return { ok: false, message: `modules/${id} 已经有了` }
    mkdirSync(dir, { recursive: true })
    const tpl = readFileSync(join(BUILTIN_DIR, '_template', 'index.mjs'), 'utf8')
    writeFileSync(join(dir, 'index.mjs'), tpl.replaceAll('__TOOL__', id.replace(/-/g, '_')).replaceAll('__ID__', id).replaceAll('__NAME__', String(name || id).replace(/['\\\n]/g, '')), 'utf8')
    installDocs()
    return { ok: true, dir, file: join(dir, 'index.mjs'), message: `建好了：${join(dir, 'index.mjs')}` }
  }

  function fork(id) {
    const b = builtinDefs.get(id)
    if (!b) return { ok: false, message: '没有这个内置模块' }
    const dir = join(userDir(), id)
    if (existsSync(dir)) return { ok: false, message: `modules/${id} 已经有了，先挪走它` }
    const own = new Map()
    own.set(b.sourcePath || `modules/${id}/index.js`, 'index.mjs')
    for (const f of b.files || []) own.set(f, f.split('/').pop())
    mkdirSync(dir, { recursive: true })
    for (const [key, name] of own) {
      let code = rewriteImports(readFileSync(join(SRC, ...key.split('/')), 'utf8'), key, new Set(own.keys()))
      for (const [k2, n2] of own) {
        const relFrom = relative(dirname(join(SRC, ...key.split('/'))), join(SRC, ...k2.split('/'))).split(sep).join('/')
        const spec = relFrom.startsWith('.') ? relFrom : './' + relFrom
        code = code.split(`'${spec}'`).join(`'./${n2}'`)
      }
      writeFileSync(join(dir, name), `// 从 Aurabot v${version} 的内置模块「${b.name}」复制出来的，改了就替换内置的。\n// 原文件：src/${key}\n` + code, 'utf8')
    }
    setConfig({ ...getConfig(), modules: { ...getConfig().modules, [id]: { ...modCfg(id), useBuiltin: false, forkedFrom: b.version || version } } })
    installDocs()
    return { ok: true, dir, message: `复制好了：${dir}。改完保存，几秒内就会换成你的版本` }
  }

  function promptFor(id) {
    const dir = id ? join(userDir(), id) : userDir()
    return `帮我写/改 AuraBot（大肥鱼 QQ 插件）的外部模块。模块目录：${dir}
当前插件版本：${version}；扩展接口：v${API_VERSION}

开始前请完整读：
- ${join(userDir(), DOC)}
- ${join(userDir(), TYPES)}

要求：
1. 只改 ${dir}（也就是 modules/）里的文件；不要改插件本身的源码、API.md 或 aurabot.d.ts。
2. 入口用 index.mjs，id 必须和目录名一致；模块只用 api.* 公开接口，不要 import 插件 src/ 内部路径，也不要依赖 globalThis.aurabot。
3. 先判断这个功能该用哪种入口：
   - 用户发消息触发 → api.on('message') 或 api.command
   - 模型需要主动调用 → api.tool，description 必须写清「什么时候用、用来做什么」
   - 需要影响模型判断 → api.rule / api.context
   - 她自己在合适的时候去做 → api.mind.offer，不要用 api.every 替她决定
4. 工具结果要如实返回。没有真的执行成功，不要写「已经完成」；失败时说明卡在哪。
5. 需要联网、读写文件、启动程序、动态执行代码或使用插件内部接口时，在 module.json 的 capabilities 里声明，并在代码里限制范围和错误处理。模块和插件在同一进程运行，能力声明不是沙箱。
6. 不要把账号、Cookie、API key、聊天原文或记忆原文写进代码、日志或返回值。不要替她改人格。
7. 写完后保存；到面板「扩展 → 模块管理」看有没有加载错误，用模拟测试跑一遍；真实 QQ 私聊/群聊再试。不要只写代码不验证。

我的需求：
【这里写你想让她多会什么、改成什么样】

请直接修改代码并告诉我改了哪些文件、怎么测试；不要只给示例片段。
`
  }

  return { capabilitiesOf, status, installDocs, create, fork, promptFor }
}
