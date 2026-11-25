// 宿主全局工具的发现与识别。
//
// 宿主把「全局工具」（例如 dsh-purge 注册的 purge_apply / purge_revert / purge_status）
// 挂在根作用域，所有会话都能看到。Aurabot 的 QQ 会话也用同一个 agent 平面，
// 因此只能按名字识别、按会话收窄，不能假设它们来自哪个插件。
//
// 三种发现方式按可靠性排序：
//   1. tools.definitions()           —— 宿主公开的完整定义列表；
//   2. tools.view(agent).restrictableNames —— 会话实际可限制的全局工具名；
//   3. 用 restrict({ deny: probe }) 触发一次报错，从错误信息里读已知名单。
// 三条都失败时返回 []，调用方按「一个都不放行」处理。

/** 宿主维护工具的命名前缀。新插件沿用同一前缀即可被自动识别。 */
export const HOST_MAINTENANCE_PREFIX = 'purge_'

export function isHostMaintenanceTool(name) {
  return typeof name === 'string' && name.startsWith(HOST_MAINTENANCE_PREFIX)
}

/** 会话可见的全局工具名；拿不到时返回 null（与 [] 区分：null 表示未知）。 */
export function knownGlobalToolNames(agent) {
  try {
    const names = agent?.ctx?.tools?.view?.(agent)?.restrictableNames
    if (names instanceof Set) return [...names]
  } catch { /* 继续尝试下一种 */ }
  try {
    const off = agent?.ctx?.tools?.restrict?.({ deny: ['aurabot__probe__'] })
    if (typeof off === 'function') off()
    return null
  } catch (error) {
    const message = String((error && error.message) || '')
    const found = /known global tools?\s*[:：]\s*(.+)$/.exec(message)
    if (!found) return null
    return found[1]
      .split(',')
      .map((name) => name.trim().replace(/^"|"$/g, ''))
      .filter((name) => name && name !== '(none)')
  }
}

/** 宿主维护工具名（排序后），拿不到定义时退回已知全局名单。 */
export function hostMaintenanceToolNames(agent, { log } = {}) {
  const filter = (names) => names.filter(isHostMaintenanceTool).sort()
  try {
    const definitions = agent?.ctx?.tools?.definitions?.()
    if (Array.isArray(definitions)) return filter(definitions.map(({ name }) => name))
  } catch (error) {
    log?.debug?.('读取宿主工具定义失败：', error.message)
  }
  const known = knownGlobalToolNames(agent)
  return known ? filter(known) : []
}
