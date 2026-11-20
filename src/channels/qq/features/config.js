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
  return { endpoint, enabled, botAccount }
}
