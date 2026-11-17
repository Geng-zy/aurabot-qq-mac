// 惦记别人的事和到期的约定。
export function createFollowups({ store, now, S, DAY, save, row, keywordHits, visibleIn, deps }) {
  function pendingRows({ open = false, sourceWindow } = {}) {
    return store.prep(`SELECT * FROM episodes WHERE kind = 'pending' AND status = 'live'${open ? " AND json_extract(json, '$.followup.done') IS NULL" : ''} AND (? IS NULL OR window = ?) ORDER BY at DESC LIMIT 200`).all(sourceWindow ?? null, sourceWindow ?? null)
      .map((r) => ({ ...r, data: JSON.parse(r.json) }))
  }
  const followupMaxAsks = (care) => Math.max(1, Math.round((Number(S('followupMaxAsks')) || 3) * (0.4 + 0.6 * care)))
  function dueFollowups({ people = [], audienceWindow, cue = '', contextCue = '', limit = 2 } = {}) {
    if (S('followup') === false || !people.length) return []
    const related = new Set([...keywordHits(cue, audienceWindow).keys(), ...keywordHits(contextCue, audienceWindow).keys()])
    if (!related.size) return []
    const at = now()
    const out = []
    for (const e of pendingRows({ open: true })) {
      const f = e.data.followup
      if (!f || f.done || !people.includes(e.data.about) || !related.has(e.id) || !visibleIn(e, audienceWindow)) continue
      const care = Math.max(0, Math.min(1, Number(deps.care?.(e.data.about) ?? 0.5)))
      if (care < 0.3) continue // 不熟、她又不特别心疼人的：不追问
      if (f.asks >= followupMaxAsks(care) || f.nextAt > at) continue
      out.push({ e, care })
      if (out.length >= limit) break
    }
    return out
  }
  /** 这件事她提过一次了：往后推（越在乎隔得越短）。 */
  function markAsked(e, care) {
    const at = now()
    const asks = (e.data.followup?.asks || 0) + 1
    const gap = (Number(S('followupGapDays')) || 2) * (1.5 - care) * DAY
    e.data.followup = { ...e.data.followup, asks, nextAt: at + gap, lastAt: at }
    if (asks >= followupMaxAsks(care)) Object.assign(e.data.followup, { done: at, why: 'asked-limit' })
    save(e)
  }
  /** 有结果了 / 对方说别问了 / 管理员在面板里取消：放下。 */
  function closeFollowup(id, why = 'done') {
    const e = row(id)
    if (!e || e.data.kind !== 'pending') return false
    e.data.followup = { ...(e.data.followup || {}), done: now(), why }
    save(e)
    return true
  }
  /** 还惦记着的（面板用）：某个人的，或者全部。 */
  function followups({ person: pid = '', all = false, audienceWindow, sourceWindow } = {}) {
    return pendingRows({ open: !all, sourceWindow })
      .filter((e) => (all || !e.data.followup?.done) && (!pid || e.data.about === pid) && visibleIn(e, audienceWindow))
      .map((e) => ({ id: e.id, at: e.at, gist: e.gist, about: e.data.about, due: e.data.due || null, asks: e.data.followup?.asks || 0, nextAt: e.data.followup?.nextAt || 0, done: e.data.followup?.done || 0 }))
  }

  // ---------- 工作记忆 ----------
  /** 到期或快到期的要做的事（前瞻记忆）。 */
  function dueIntentions({ window = '', audienceWindow, sourceWindow, within = 2 * 3600000 } = {}) {
    const at = now()
    return store.prep("SELECT * FROM episodes WHERE kind = 'intention' AND status = 'live' AND json_extract(json, '$.done') IS NULL AND (? IS NULL OR window = ?) ORDER BY at DESC LIMIT 50").all(sourceWindow ?? null, sourceWindow ?? null)
      .map((r) => ({ ...r, data: JSON.parse(r.json) }))
      // 到期或快到期的；过期三天还没做的慢慢就不惦记了（还在记忆里，只是不再每轮提醒）。
      // 没说时间的：答应后（或上次想起后）一周内每轮记着，之后就不再时时挂在心上，聊到了还想得起来
      .filter((e) => !e.data.done && (e.data.due ? e.data.due <= at + within && e.data.due >= at - 3 * DAY : at - Math.max(e.at || 0, e.last_recall || 0) < 7 * DAY) && (!window || !e.window || e.window === window || e.data.due))
      .filter((e) => visibleIn(e, audienceWindow))
      .slice(0, 5)
  }
  function completeIntention(id) {
    const e = row(id)
    if (!e || e.data.kind !== 'intention') return false
    e.data.done = now()
    save(e)
    return true
  }


  return { pendingRows, dueFollowups, markAsked, closeFollowup, followups, dueIntentions, completeIntention }
}
