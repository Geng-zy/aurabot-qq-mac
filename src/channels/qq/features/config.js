// QQ 平台读取配置的薄层：连接地址、启用状态、机器人号。
export function createConfigApi({ getConfig }) {
  const endpoint = () => {
    const cfg = getConfig() || {}
    const s = cfg.platforms?.qq || cfg.snowluma || {}
    return { httpUrl: s.httpUrl || '', wsUrl: s.wsUrl || '', httpToken: s.httpToken || '', wsToken: s.wsToken || '' }
  }
  const enabled = () => {
    const cfg = getConfig() || {}
    return cfg.enabled !== false && cfg.platforms?.qq?.enabled !== false
  }
  const botAccount = () => String(getConfig()?.platforms?.qq?.botQQ || getConfig()?.botQQ || '')
  const connectionProblem = (getWrongAccount = () => '') => {
    const cfg = getConfig()
    if (!cfg.enabled) return '总开关关着（右上角），打开后才会连'
    if (!botAccount()) return '还没填机器人 QQ 号'
    const ep = endpoint()
    if (!ep.wsUrl) return '还没填 OneBot 的 WebSocket 地址：在「连接」页填你的 OneBot v11 正向 WebSocket 地址（收消息要靠它；HTTP 可以不填）'
    const wrong = getWrongAccount()
    if (wrong) return `连上的是 ${wrong}，不是机器人号 ${botAccount()}，已经断开：让你的 OneBot 服务登录机器人号，再点「重新连接」`
    return `连 ${ep.wsUrl || ep.httpUrl} 没连上：确认 OneBot 服务（比如 OrbStack 里的 SnowLuma）开着、地址和 token 填对了`
  }
  return { endpoint, enabled, botAccount, connectionProblem }
}
