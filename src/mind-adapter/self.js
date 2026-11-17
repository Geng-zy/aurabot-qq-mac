// 她自己改自己、从人格卡推断特质、人格卡版本同步、想管理员。
export function createSelf({ mind, mem, opts, log, ownerOf, outreach, now }) {
  async function changeSelf(a, by = 'self') {
    const r = mind.self.change(a, { by })
    if (!r.ok || !r.change) return { ok: r.ok, message: r.message }
    const c = r.change
    if (['persona', 'name', 'nickname'].includes(c.what)) {
      try { opts.onSelfChange?.({ what: c.what, after: c.after, by }) } catch (error) { log.warn('人格卡文件没跟着改：', error.message) }
    }
    if (by === 'self') {
      mind.emotion.feel([{ name: '平静', intensity: 0.3, why: '想通了，改了' + c.label, importance: 0.5 }], { source: 'self-change' })
      if (mind.setting('identity.notifySelfChange') !== false && typeof opts.notifyOwner === 'function') {
        const show = c.what === 'persona' || c.what === 'story' ? `（${c.after.length} 字，面板「人格与自我」里能看前后对比）` : `：${c.before ? `「${[...c.before].slice(0, 60).join('')}」→ ` : ''}「${[...c.after].slice(0, 80).join('')}」`
        opts.notifyOwner(`【通知】她改了自己的${c.label}${show}\n理由：${c.why || '（没写）'}`).catch(() => {})
      }
    }
    return { ok: true, message: r.message }
  }

  async function inferTraits({ force = false } = {}) {
    const st = mind.personality.state()
    if (!opts.ask || (!force && (st.inferred || st.confirmed))) return null
    const card = mind.personaCard()
    if (!card.trim()) return null
    return mind.personality.infer(card, (scene, system, text, maxTokens) => mem.ask(scene, system, text, maxTokens))
  }

  function resolveOwnerAbsence(at) {
    const owner = mind.identity().ownerId
    if (!owner || !at || !mind.emotion.resolveSource('attachment', owner, at)) return
    for (const want of mind.motivation.state().wants) {
      if (want.action === 'reach_owner' && want.text === '想管理员了，想找他说说话' && want.at <= at) mind.motivation.closeWant(want.id)
    }
  }

  function missOwner() {
    const owner = ownerOf()
    if (!owner) return null
    const p = mind.relations.get(mind.canon(owner))
    const last = Math.max(p.rel.lastContact || 0, outreach.lastContact() || 0, mind.person(owner)?.lastSeen || 0, mind.lastOwnerMessageAt())
    if (!last) return null
    const anx = mind.personality.value('attachAnxiety')
    const hours = (Number(mind.setting('relations.missOwnerHours')) || 24) * (1.3 - 0.6 * anx)
    if (now() - last < hours * 3600000) return null
    const day = mind.today()
    if (mind._store.get('relations.missedDay') === day) return null
    mind._store.set('relations.missedDay', day)
    const h = Math.round((now() - last) / 3600000)
    const items = [{ name: '思念', intensity: Math.min(0.9, 0.3 + 0.5 * anx), target: p.id, why: `当时距离上次联系约 ${h} 小时`, importance: 0.5 }]
    if (anx >= 0.57) items.push({ name: '焦虑', intensity: 0.2 + 0.4 * anx, target: p.id, why: '有一阵没联系，心里有些惦记', importance: 0.4 })
    mind.emotion.feel(items, { source: 'attachment' })
    mind.motivation.want('想管理员了，想找他说说话', { strength: 0.3 + 0.4 * anx, action: 'reach_owner' })
    return items
  }

  function syncPersona(by = 'owner', reason = '面板修改') {
    try {
      const p = opts.persona?.()
      if (!p || !String(p.body || '').trim()) return false
      const body = String(p.body).trim()
      if (body === mind.personaCard()) return false
      const first = !mind.listVersions('persona', 1).length
      const name = mind.identity().name || String(p.name || '').trim()
      mind.setPersonaCard(body, { by: first ? 'migration' : by, reason: first ? '从面板的人格卡迁移' : reason, name })
      return true
    } catch (error) {
      log.warn('人格卡同步失败：', error.message)
      return false
    }
  }

  return { changeSelf, inferTraits, resolveOwnerAbsence, missOwner, syncPersona }
}
