// 发送自测和聊天会话重置路由。

export function registerSessionRoutes({ route, getConfig, backgroundText, hub }) {
  route('/test-send', async (req) => {
    if (req.method !== 'POST') return { ok: false, message: '请从面板发起发送测试' }
    const cfg = getConfig()
    if (!cfg.enabled) return { ok: false, message: '先打开总开关' }
    if (cfg.debug) return { ok: false, message: '现在是调试模式，先回到正式模式再测' }
    if (cfg.dryRun) return { ok: false, message: '现在是试运行，先关掉试运行再测' }
    const ownerQQ = String(cfg.platforms?.qq?.ownerQQ || cfg.ownerQQ || '')
    if (!ownerQQ) return { ok: false, message: '先填写管理员 QQ 号' }
    const r = await backgroundText(`qq:private:${ownerQQ}`, '【Aurabot 自测】大肥鱼到此一游～', '自测', { allowQueue: false, system: true })
    return r && !r.queued && !r.simulated ? { ok: true, message: '发给管理员了，去 QQ 看看' } : { ok: false, message: '未确认送达，请查看日志' }
  })

  route('/sessions/reset', async () => {
    const result = await hub.resetSessions()
    const { archived, retained, failed } = result
    if (!archived && !retained && !failed) return { ok: true, ...result, message: '本来就没有聊天会话' }
    const notes = [`归档了 ${archived} 个聊天会话`]
    if (retained) notes.push(`为保留工作树留下 ${retained} 个旧会话`)
    if (failed) notes.push(`${failed} 个会话归档失败，旧会话仍可查看`)
    return { ok: true, ...result, message: notes.join('，') + '。下一条消息起她会重新开始。' }
  })
}
