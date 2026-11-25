// 心智实时状态、投喂、睡眠和内心活动。

export function registerMindLiveRoutes({ route, readBody, getMind, getConfig, shortRef, localInstaller }) {
  const mindOff = { ok: false, message: '心智核心没起来，看日志里的原因' }

  route('/mind/now', async () => {
    const mind = getMind()
    if (!mind) return mindOff
    const f = mind.mind.feeling()
    const cfgNow = mind.mind.settings()
    return {
      ok: true,
      body: f.body,
      mood: f.mood,
      emotions: f.emotions.map((e) => ({
        name: e.name,
        intensity: e.intensity,
        target: e.target,
        targetName: e.target ? (mind.mind.isOwner(e.target) ? '管理员' : mind.mind.person(e.target)?.name || shortRef(e.target)) : '',
        why: e.why,
        source: e.source,
        hidden: e.hidden,
        at: e.at,
      })),
      history: mind.mind.emotion.history(30),
      hunger: cfgNow['body.hunger'],
      feedOnlyByOwner: cfgNow['body.feedOnlyByOwner'],
      now: mind.mind.nowText(),
      ownerQQ: String(getConfig().ownerQQ || ''),
    }
  })

  route('/mind/feed', async (req) => {
    const mind = getMind()
    if (!mind) return mindOff
    const b = await readBody(req)
    if (!String(b.food || '').trim()) return { ok: false, message: '填一个吃的' }
    return mind.feed(String(b.food), String(getConfig().ownerQQ || ''), '')
  })

  route('/mind/wake', async () => {
    const mind = getMind()
    if (!mind) return mindOff
    const ev = mind.wakeUp(String(getConfig().ownerQQ || ''))
    return ev ? { ok: true, message: `叫醒了（睡了 ${ev.hours.toFixed(1)} 小时）` } : { ok: false, message: '她没在睡' }
  })

  route('/mind/sleepnow', async () => {
    const mind = getMind()
    if (!mind) return mindOff
    return mind.mind.body.sleepNow() ? { ok: true, message: '让她睡了' } : { ok: false, message: '她已经在睡了' }
  })

  route('/mind/inner', async () => {
    const mind = getMind()
    if (!mind) return mindOff
    const m = mind.mind
    const f = m.feeling()
    return {
      ok: true,
      diary: m.inner.diary(80),
      timezone: m.identity().timezone,
      boredom: m.inner.boredom(),
      motivation: m.motivation.state(f.body),
      motives: m.motivation.motives({ body: f.body, mood: f.mood, boredom: m.inner.boredom() }),
      actThreshold: m.setting('motivation.actThreshold'),
      outreach: m._store.get('outreach', { pending: null, log: [] }),
      grants: m._store.get('grants', { requests: [], granted: {} }),
      local: { ...mind.local.status(), install: localInstaller.status() },
      usage: m.budget.spent(),
    }
  })
}
