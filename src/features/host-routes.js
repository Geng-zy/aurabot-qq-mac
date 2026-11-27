// 宿主接触面的取证接口：只读，给面板和实机验收看「rc.3 上到底走通了哪条路」。
//
// 起因（B17）：维护工具的发现有四条路径，全都只有单测。真机上究竟命中哪一条、
// 认出了哪些 purge_* 工具，一直没有人能在运行时回答。这个接口把答案摆出来：
//   · last  —— 最近一次会话挂载实际用的来源与结果（挂载时记录，含 chatId/sessionId）
//   · probe —— 当场对宿主全局视图再问一次（不依赖会话，随时可查）
// 两个都是只读：不注册工具、不改配置、不触发任何宿主状态变更。

import { HOST_MAINTENANCE_PREFIX, lastDetection, probeGlobalTools } from '../integration/host-tools.js'

export function registerHostRoutes({ route, ctx }) {
  route('/host/tools', async () => {
    // 宿主没注入 tools 时，读属性本身就会抛（cordis: cannot get property … without inject）。
    // 这是**能力缺失**，不是错误：如实报 view: 'none' 并带上原因，别让面板拿到一个 500。
    let tools = null
    let missing = ''
    try { tools = ctx?.tools ?? null } catch (error) { missing = String((error && error.message) || error).slice(0, 160) }
    const probe = probeGlobalTools(tools)
    if (missing && !probe.error) probe.error = missing
    const names = probe.restrictableNames || probe.knownNames || []
    return {
      ok: true,
      prefix: HOST_MAINTENANCE_PREFIX,
      probe,
      probeMaintenance: names.filter((n) => n.startsWith(HOST_MAINTENANCE_PREFIX)).sort(),
      last: lastDetection(),
    }
  })
}
