// 宿主全局工具的发现与识别。
//
// 宿主把「全局工具」（例如 dsh-purge 注册的 purge_apply / purge_revert / purge_status）
// 挂在根作用域，所有会话都能看到。Aurabot 的 QQ 会话也用同一个 agent 平面，
// 因此只能按名字识别、按会话收窄，不能假设它们来自哪个插件。
//
// 四种发现方式按可靠性排序：
//   1. tools.definitions()                  —— 宿主公开的完整定义列表；
//   2. tools.view(agent).restrictableNames  —— 会话实际可限制的全局工具名（rc.3 有）；
//   3. tools.view(agent).knownNames         —— 同名集合的另一个字段，前一个改名时的备份；
//   4. 用 restrict({ deny: probe }) 触发一次报错，从错误信息里读已知名单（最脆，仅兜底）。
// 全失败时返回 null（未知）；调用方拿到 [] 时按「没有需要限制的维护工具」处理，
// 但那是**放行**的方向 —— 所以这里会打一条 warn，别让探测失效变成静默放宽权限。

/** 宿主维护工具的命名前缀。新插件沿用同一前缀即可被自动识别。 */
export const HOST_MAINTENANCE_PREFIX = 'purge_'

export function isHostMaintenanceTool(name) {
  return typeof name === 'string' && name.startsWith(HOST_MAINTENANCE_PREFIX)
}

/** 会话可见的全局工具名；拿不到时返回 null（与 [] 区分：null 表示未知）。 */
const PROBE_TOOL = 'aurabot__probe__'

/** 从宿主的报错文案里抠出已知工具名。格式会随宿主版本变，所以这里单独一个函数、单独测。 */
export function parseKnownToolNames(message) {
  const text = String(message || '')
  // 宿主（rc.3）原文：tools.restrict() names unknown global tool "x"; known global tools: a, b, c
  const found = /known\s+global\s+tools?\s*[:：]\s*(.+)$/is.exec(text)
  if (!found) return null
  const names = found[1]
    .split(/[,，]/)
    .map((name) => name.trim().replace(/^["'`]|["'`]$/g, ''))
    .filter((name) => name && name !== '(none)' && name !== '（无）')
  return names
}

/**
 * 最近一次探测的结果（面板排错用）。
 * 记录「真机上一次会话挂载到底走了哪条发现路径、认出了谁」——这是 B17 补的证据缺口：
 * 四条路径都只有单测、没有运行时观测，探测悄悄失效就没人知道。
 */
let last = null

/** 记录一次探测（由 hostMaintenanceToolNames 在挂载时调用）。 */
export function recordDetection(entry) {
  last = { ...entry, at: Date.now() }
  return last
}

/** 最近一次探测；从没挂载过则为 null。 */
export function lastDetection() {
  return last
}

/**
 * 全局视图探测：不依赖任何会话，直接问宿主「根作用域里有哪些可限制的全局工具」。
 * rc.3 里 `view(undefined)` 就是全局视图；这里只读、不注册任何东西，用来在面板上取证。
 */
export function probeGlobalTools(tools) {
  const out = { view: 'none', restrictableNames: null, knownNames: null, error: '' }
  try {
    const view = tools?.view?.(undefined)
    if (view && typeof view === 'object') {
      out.view = 'ok'
      if (view.restrictableNames instanceof Set) out.restrictableNames = [...view.restrictableNames].sort()
      if (view.knownNames instanceof Set) out.knownNames = [...view.knownNames].sort()
    }
  } catch (error) {
    out.error = String((error && error.message) || error).slice(0, 160)
  }
  return out
}

/**
 * 四条发现路径的统一实现，附带「命中哪一条」。
 * @returns {{source: 'restrictableNames'|'knownNames'|'probe'|'unknown', names: string[]|null}}
 */
export function describeDiscovery(agent, { log } = {}) {
  const tools = agent?.ctx?.tools
  for (const field of ['restrictableNames', 'knownNames']) {
    try {
      const names = tools?.view?.(agent)?.[field]
      if (names instanceof Set) return { source: field, names: [...names] }
    } catch { /* 继续尝试下一种 */ }
  }
  try {
    const off = tools?.restrict?.({ deny: [PROBE_TOOL] })
    // 探针被接受了：说明这个名字在已知名单里，宿主没把名单告诉我们
    if (typeof off === 'function') off()
    log?.debug?.('宿主接受了探针工具名，拿不到全局工具名单')
    return { source: 'unknown', names: null }
  } catch (error) {
    const parsed = parseKnownToolNames(error && error.message)
    if (!parsed) log?.debug?.('认不出宿主报错里的工具名单，本次按「未知」处理：' + String((error && error.message) || '').slice(0, 160))
    return { source: parsed ? 'probe' : 'unknown', names: parsed }
  }
}

/** 会话可见的全局工具名；拿不到返回 null（未知，不是空）。 */
export function knownGlobalToolNames(agent, { log } = {}) {
  return describeDiscovery(agent, { log }).names
}

/** 宿主维护工具名（排序后），拿不到定义时退回已知全局名单。 */
export function hostMaintenanceToolNames(agent, { log, chatId = '', sessionId = '' } = {}) {
  const filter = (names) => names.filter(isHostMaintenanceTool).sort()
  try {
    const definitions = agent?.ctx?.tools?.definitions?.()
    if (Array.isArray(definitions)) {
      const names = filter(definitions.map(({ name }) => name))
      recordDetection({ source: 'definitions', names, all: definitions.length, chatId, sessionId })
      return names
    }
  } catch (error) {
    log?.debug?.('读取宿主工具定义失败：', error.message)
  }
  const found = describeDiscovery(agent, { log })
  recordDetection({ source: found.source, names: found.names ? filter(found.names) : null, all: found.names?.length ?? 0, chatId, sessionId })
  const known = found.names
  if (!known) {
    // 探测失败时返回空表，等于「不限制这些维护工具」——这是放宽权限的方向。
    // 用 debug 而不是 warn：这个函数每挂载一个会话就会走一次，warn 会刷屏；
    // 失效的可见性由 test/host-tools.test.js 与面板的模块状态承担。
    log?.debug?.('拿不到宿主全局工具名单，本次不对维护工具做收窄')
    return []
  }
  return filter(known)
}
