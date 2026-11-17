// 想起来会加强记忆，并按概率排进睡眠改写。
import { afterRecall } from './curve.js'

export function createStrengthen({ store, now, S, row, rOf, save, queueJob, state, random }) {
  return function strengthen(ids) {
    const at = now()
    store.tx(() => {
      for (const id of ids) {
        const e = row(id)
        if (!e) continue
        const r = rOf(e, at)
        e.stability = afterRecall(e.stability, r, Number(S('spacingBonus')))
        e.last_recall = at
        e.data.hits = (e.data.hits || 0) + 1
        save(e)
        const p = Number(S('reconsolidation')) || 0
        if (p > 0 && random() < p && !['intention', 'pending', 'dream', 'public-note', 'shared-note'].includes(e.data.kind)) {
          queueJob('reconsolidate', id, { mood: (state() || {}).valence || 0, at })
        }
      }
    })
  }
}
