// 面板概览聚合：把宿主状态压成一个 /state 响应。

export function createOverview({
  getConfig, version, apiVersion, homedir, publicConfig, qq, channels, outbox, hub,
  nextChange, isPeak, getMind, stickers, use, avatarInfo, workspaceDirOf, realWorkspace,
  listPersonas, mods, bridge, ctx,
}) {
  return async function overview() {
    const cfg = getConfig()
    const mind = getMind()
    const diary = use('diary')
    return {
      ok: true,
      version,
      apiVersion,
      home: homedir(),
      config: publicConfig(cfg),
      onebot: await qq.status(),
      channels: channels.status(),
      outbox: outbox.status(),
      stats: hub.stats(),
      offpeak: (() => {
        const now = new Date()
        const holidays = cfg.cost?.offPeakHolidays || []
        const next = nextChange(now, { holidays })
        return { peak: isPeak(now, { holidays }), next: next?.at || 0 }
      })(),
      mood: (() => {
        try {
          const f = mind.mind.feeling()
          return { value: Math.round((f.mood.v + 1) * 50), label: f.body.asleep ? '睡着了' : f.mood.label, reason: f.emotions[0] ? f.emotions[0].name : '', history: [] }
        } catch (error) {
          return { value: 0, label: '心智核心没起来', reason: '', history: [] }
        }
      })(),
      stickers: { count: stickers.library().items.length },
      diary: { next: '', last: diary?.history()[0] || null },
      qzoneSocial: use('qzone-social')?.state?.() ?? null,
      mind: mind ? { sleep: mind.mind._store.get('sleep.lastReport', null), usage: mind.mind.budget.spent(), counts: mind.mind.status().counts } : null,
      avatar: avatarInfo(),
      voice: { edgeInstalled: use('voice')?.edgeInstalled?.() ?? false },
      song: use('song')?.status?.() ?? null,
      sessions: hub.sessions(),
      sessionHealth: hub.sessionHealth(),
      workspaceDir: workspaceDirOf(cfg),
      workspaceReal: realWorkspace(workspaceDirOf(cfg)),
      personas: listPersonas(),
      modules: mods.status(),
      bridge: { dshTools: cfg.bridge.dshTools, http: cfg.bridge.http, hasToken: Boolean(cfg.bridge.token), tools: bridge.deniedTools(), toolsService: Boolean(ctx.get?.('tools')) },
    }
  }
}
