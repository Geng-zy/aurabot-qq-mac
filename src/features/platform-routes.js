// 平台状态与 QQ 连接测试路由；只做查询/重连，不启动或停止通道。

export function registerPlatformRoutes({ route, channels, qq, onebot, getConfig }) {
  route('/platforms', async () => ({ ok: true, list: channels.status() }))
  route('/platforms/qq/diagnose', async () => qq.diagnose())
  route('/platforms/qq/reconnect', async () => qq.reconnect())
  // 一键诊断：顺着 OrbStack → SnowLuma 容器 → 端口 → 连上 → 登录的号 → 在线 一项项看
  route('/onebot/diagnose', async () => qq.diagnose())
  route('/onebot/reconnect', async () => qq.reconnect())
  route('/onebot/test', async () => {
    try {
      const info = await onebot.call('get_login_info', {}, { timeoutMs: 8000 })
      const uin = String(info?.user_id ?? '')
      const cfg = getConfig()
      const botQQ = String(cfg.platforms?.qq?.botQQ || cfg.botQQ || '')
      return { ok: uin === botQQ, message: uin === botQQ ? `连上了：${info.nickname}（${uin}）` : `连上的是 ${uin}，不是机器人号 ${botQQ}！`, info }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })
}
