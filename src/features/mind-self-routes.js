import { MIND_OFF } from '../panel/route-kit.js'
// 心智自我、版本和性格路由。

export function registerMindSelfRoutes({ route, readBody, query, getMind, getConfig, readPersona, savePersona }) {

  route('/mind/self', async () => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    const m = mind.mind
    const ver = (kind, n) => m.listVersions(kind, n).map((v) => ({
      id: v.id, at: v.at, by: v.by, reason: v.reason, pinned: v.pinned,
      data: kind === 'persona' ? { name: v.data.name, nickname: v.data.nickname, chars: String(v.data.card || '').length, card: v.data.card } : v.data,
    }))
    return {
      ok: true,
      identity: m.identity(),
      card: m.personaCard(),
      profile: m.self.profile(),
      ownerCall: m.self.ownerCall(),
      ownerCallOk: m.self.canChangeOwnerCall(),
      personality: m.personality.state(),
      versions: { persona: ver('persona', 30), self: ver('self', 50), traits: ver('traits', 50), habits: ver('habits', 50) },
      prompt: m.selfPrompt(),
    }
  })

  route('/mind/self/change', async (req) => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    const b = await readBody(req)
    return mind.changeSelf({ what: b.what, content: b.content, why: b.why || '管理员在面板里改的', trait: b.trait, dir: b.dir }, 'owner')
  })

  route('/mind/self/goal/drop', async (req) => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    const b = await readBody(req)
    return { ok: mind.mind.self.dropGoal(String(b.text || '')) }
  })

  route('/mind/self/restore', async (req) => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    const b = await readBody(req)
    try {
      if (b.kind === 'persona') {
        mind.mind.restorePersona(Number(b.id))
        const id = getConfig().persona.current
        const cur = readPersona(id)
        if (cur) savePersona(id, { name: cur.name, tags: cur.tags, body: mind.mind.personaCard(), nickname: cur.nickname })
        return { ok: true, message: '人格卡退回了' }
      }
      if (b.kind === 'traits') { mind.mind.personality.restore(Number(b.id)); return { ok: true, message: '性格退回了' } }
      if (b.kind === 'habits') { mind.mind.personality.restoreHabits(Number(b.id)); return { ok: true, message: '习惯退回了' } }
      if (b.kind === 'self') return mind.mind.self.restore(Number(b.id))
      return { ok: false, message: '不认识的版本' }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })

  route('/mind/version/pin', async (req) => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    const b = await readBody(req)
    mind.mind.pinVersion(Number(b.id), b.pinned !== false)
    return { ok: true }
  })

  route('/mind/version/list', async (req) => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    const { kind, before } = query(req)
    if (!['persona', 'self', 'traits', 'habits'].includes(kind)) return { ok: false, message: '不认识的版本类别' }
    const cursor = Number(before)
    const versions = mind.mind.listVersions(kind, 51, Number.isSafeInteger(cursor) && cursor > 0 ? cursor : undefined)
    return { ok: true, items: versions.slice(0, 50).map(({ data, ...meta }) => meta), hasMore: versions.length > 50 }
  })

  route('/mind/version/compare', async (req) => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    const { first, second } = query(req)
    const a = mind.mind.getVersion(first)
    const b = mind.mind.getVersion(second)
    return a && b && a.kind === b.kind ? { ok: true, versions: [a, b] } : { ok: false, message: '请选择同一类别的两个版本' }
  })

  route('/mind/version/delete', async (req) => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    const b = await readBody(req)
    try {
      const n = b.id ? mind.mind.deleteVersion(b.id) : mind.mind.deleteVersions(String(b.kind), { from: Number(b.from), through: Number(b.through) })
      return { ok: true, message: `清理了 ${n} 个版本` }
    } catch (error) { return { ok: false, message: error.message } }
  })

  route('/mind/traits/confirm', async (req) => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    const b = await readBody(req)
    mind.mind.personality.confirm(b.base || {})
    return { ok: true, message: '确认好了：这就是她本来的样子' }
  })

  route('/mind/traits/infer', async () => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    try {
      const r = await mind.inferTraits({ force: true })
      return r ? { ok: true, inferred: r, message: '推好了，看看像不像她，再确认' } : { ok: false, message: '没推出来（人格卡是空的，或者模型没接上）' }
    } catch (error) {
      return { ok: false, message: '没推出来：' + error.message }
    }
  })

  route('/mind/traits/alerts/read', async () => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    mind.mind.personality.readAlerts()
    return { ok: true }
  })
}
