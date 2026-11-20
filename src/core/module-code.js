// 模块源码的纯工具：源码 import 改写、模块 core 作用域、懒代理和深合并。
// 不依赖 DSH 运行时，也不参与模块目录扫描，便于单测。
/** 把一份源码里指向插件内部的相对 import 改成走 lib()，这样复制出去也能跑。 */
export function rewriteImports(code, fromKey, keep = new Set()) {
  const base = fromKey.split('/').slice(0, -1)
  const target = (spec) => {
    if (!/^\.\.?\//.test(spec)) return null
    const parts = [...base]
    for (const seg of spec.split('/')) {
      if (seg === '..') parts.pop()
      else if (seg !== '.') parts.push(seg)
    }
    const key = parts.join('/')
    return keep.has(key) ? null : key
  }
  const names = (list) => list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': ')).join(', ')
  let out = code.replace(/import\s+(\w+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g, (m, def, list, spec) => {
    const key = target(spec)
    if (!key) return m
    const d = def ? `const ${def.replace(/[\s,]/g, '')} = __lib('${key}').default\n` : ''
    return `${d}const { ${names(list)} } = __lib('${key}')`
  })
  out = out.replace(/import\s+\*\s+as\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g, (m, name, spec) => {
    const key = target(spec)
    return key ? `const ${name} = __lib('${key}')` : m
  })
  out = out.replace(/import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g, (m, name, spec) => {
    const key = target(spec)
    return key ? `const ${name} = __lib('${key}').default` : m
  })
  out = out.replace(/import\(\s*['"]([^'"]+)['"]\s*\)/g, (m, spec) => {
    const key = target(spec)
    return key ? `Promise.resolve(__lib('${key}'))` : m
  })
  // 插件里带的数据文件（new URL('./x.py', import.meta.url)）：指回插件目录
  out = out.replace(/new URL\(\s*['"](\.\.?\/[^'"]*)['"]\s*,\s*import\.meta\.url\s*\)/g, (m, spec) => {
    const key = target(spec)
    return key ? `new URL('${key}', globalThis.aurabot.src)` : m
  })
  if (out !== code) out = "const __lib = globalThis.aurabot.lib // 插件内部源码（复制出来后靠它找到插件里的文件）\n" + out
  return out
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
/**
 * 给单个模块的 core：hub 下发「白名单副本」，原始委派入口不下发、也不可经原型链摸回（三审 #177）。
 * - scopedHub：平面对象，只转发 hub 的函数/取值器（跳过原始 runSubagentTurn / subagentFor），
 *   再补一个固定模块 id 的 runSubagentTurn；原型就是 Object.prototype，没有可逃逸的入口。
 * - scopedCore：Proxy 转发 core 的其余属性（bridge / modules 后挂的也可见），
 *   但 getPrototypeOf 掐成 null —— Object.getPrototypeOf(api.core).hub 也绕不回去。
 */
export function scopeCoreForModule(core, id) {
  if (!core || !core.hub || typeof core.hub !== 'object') return {}
  const scopedHub = {}
  for (const name of Object.getOwnPropertyNames(core.hub)) {
    if (name === 'runSubagentTurn' || name === 'subagentFor') continue
    const d = Object.getOwnPropertyDescriptor(core.hub, name)
    if (!d) continue
    if (typeof d.get === 'function') {
      Object.defineProperty(scopedHub, name, { enumerable: true, configurable: true, get: () => core.hub[name] })
    } else if (typeof d.value === 'function') {
      const fn = d.value
      Object.defineProperty(scopedHub, name, { enumerable: true, configurable: true, value: (...args) => fn.apply(core.hub, args) })
    } else {
      Object.defineProperty(scopedHub, name, { enumerable: true, configurable: true, get: () => core.hub[name], set: (v) => { core.hub[name] = v } })
    }
  }
  if (typeof core.hub.subagentFor === 'function') {
    Object.defineProperty(scopedHub, 'runSubagentTurn', {
      enumerable: true, configurable: true,
      value: (name, title, prompt, opts = {}) => core.hub.subagentFor(id)(name, title, prompt, opts),
    })
  }
  return new Proxy(core, {
    get(target, key, recv) {
      if (key === 'hub') return scopedHub
      // 模块不能拿回内核控制面或伪造自己的身份；配置只给只读快照。
      if (key === 'modules' || key === 'mindFor' || key === 'setConfig') return undefined
      if (key === 'getConfig') return () => structuredClone(target.getConfig())
      return Reflect.get(target, key, recv)
    },
    getPrototypeOf() { return null }, // 摸原型拿回原始 hub 的路也堵死（三审 #177）
  })
}

/**
 * 一个「用的时候才去找」的模块代理：memory.add(...) 每次都调当时在跑的那个 memory 模块；
 * 模块没在跑时，属性都是 undefined（所以调用方写 memory.add?.(...) 就不会出错）。
 */
export function lazyProxy(get) {
  return new Proxy({}, {
    get(_, k) {
      const t = get()
      if (!t) return undefined
      const v = t[k]
      return typeof v === 'function' ? v.bind(t) : v
    },
    has: (_, k) => Boolean(get() && k in get()),
  })
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
export function deepMerge(base, over) {
  if (!isObj(over)) return over === undefined ? base : over
  const out = { ...(isObj(base) ? base : {}) }
  for (const [k, v] of Object.entries(over)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v
  }
  return out
}
