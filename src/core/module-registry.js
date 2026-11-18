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
    const names = []
    for (const b of rec.tools) {
      try {
        const r = typeof b === 'function' ? b({ chat: { chatId: 'private:0', kind: 'private', userId: '0' }, level: 'full', sessionId: '' }) : b
        for (const t of [].concat(r || [])) if (t?.name) names.push(t.name)
      } catch (error) {}
    }
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
    } catch (error) {}
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
    return `帮我修改 AuraBot（大肥鱼 QQ 插件）的外部模块：${dir}\n`
      + `先完整读一遍「${join(userDir(), DOC)}」和「${join(userDir(), TYPES)}」，了解模块怎么写、能用哪些 api 接口，再按我的要求改：\n`
      + '【这里写你想让她多会什么、改成什么样】\n'
      + `只改 ${userDir()}（modules/）里的文件，不要动插件本身的源码；模块只用 api.* 公开接口，不要 import 插件 src/ 内部路径。`
      + '改完保存会自动重新加载；到面板「扩展 → 模块管理」看有没有报错，再告诉我怎么试。'
  }

  return { capabilitiesOf, status, installDocs, create, fork, promptFor }
}
