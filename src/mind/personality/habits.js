// 性格里的「习惯」与「证据遗忘」：习惯的夜间更新、版本记录、证据删除后的回溯修正、提醒。
// 从 mind/personality/index.js 抽出来：那边管特质（基础值/当前值/影子模式/每晚走一步），
// 这边管习惯这一支（它有自己的证据池与版本历史），两边只共享 store/load/save 与几个小工具。
//
// 依赖注入：store / load / save / now / r2 / clamp / P / DAY / deps / movement / alert。

import { similar } from './similar.js'

export function createHabits({ store, load, save, now, r2, clamp, P, DAY, deps, movement, alert = () => {} }) {
  function saveHabitsVersion(s, reason, by = 'sleep') {
    deps.addVersion('habits', { habits: s.habits }, { by, reason })
  }

  function forgetEvidence(episode) {
    const s = load()
    const sources = new Set(episode.data.sources || [])
    const legacyTimes = new Set([...sources].map((id) => store.prep('SELECT at FROM perception WHERE id = ?').get(id)?.at).filter(Number.isFinite))
    const kept = (o) => !(o.episodes?.includes(episode.id) || (o.window === episode.window &&
      (sources.has(o.perception) || (!o.perception && legacyTimes.has(o.at)))))
    const prior = s.obs.length + s.habitObs.length
    s.obs = s.obs.filter(kept)
    s.habitObs = s.habitObs.filter(kept)
    const corrections = new Map()
    const timeline = []
    for (const step of s.traitSteps || []) {
      const key = step.id + ':' + step.shadow
      const offset = corrections.get(key) || 0
      const remaining = step.observations.filter(kept)
      if (!offset && remaining.length === step.observations.length) continue
      const before = step.cur + offset
      const next = movement(before, step.base, remaining, step.rules)?.next ?? before
      const change = r2(next - step.next)
      corrections.set(key, change)
      timeline.push({ id: step.id, at: step.at, field: step.shadow ? 'shadow' : 'cur', change })
      Object.assign(step, { cur: before, next, observations: remaining })
    }
    for (const [key, correction] of corrections) {
      if (!correction) continue
      const [id, mode] = key.split(':')
      const shadow = mode === 'true'
      const target = shadow ? s.shadow : s.cur
      const progress = shadow ? s.shadowProgress : s
      if (target) target[id] = r2(clamp(target[id] + correction, 0.02, 0.98))
      if (!progress) continue
      const active = (s.traitSteps || []).filter((step) => step.id === id && (!step.shadow || shadow) && step.next !== step.cur)
      if (active.length) progress.lastStep[id] = progress.consumed[id] = active.at(-1).at
      else { delete progress.lastStep[id]; delete progress.consumed[id] }
      delete progress.run[id]
      if (!shadow) s.alerts = s.alerts.filter((a) => a.trait !== id)
      progress.peak[id] = Math.max(Math.abs((target?.[id] ?? 0.5) - (s.base[id] ?? 0.5)), ...active.map((step) => Math.abs(step.next - step.base)))
    }
    if (timeline.length) {
      const versions = store.prep("SELECT id, at, json FROM versions WHERE kind = 'traits' AND at >= ?").all(timeline[0].at)
      for (const v of versions) {
        const data = JSON.parse(v.json)
        const latest = new Map(timeline.filter((entry) => entry.at <= v.at).map((entry) => [entry.id + ':' + entry.field, entry]))
        let changed = false
        for (const { id, field, change } of latest.values()) {
          if (!change || !Number.isFinite(data[field]?.[id])) continue
          data[field][id] = r2(clamp(data[field][id] + change, 0.02, 0.98))
          changed = true
        }
        if (changed) store.prep("UPDATE versions SET json = ?, reason = ? WHERE id = ?")
          .run(JSON.stringify(data), '删除经历后重算了此版本', v.id)
      }
    }
    const pruneHabits = (habits, at) => {
      let changed = false
      const win = (Number(P('windowDays')) || 14) * DAY
      const need = Number(P('thresholdDays')) || 3
      const remaining = habits.map((habit) => {
        const seen = habit.seen.filter(kept)
        if (seen.length === habit.seen.length) return habit
        changed = true
        const recent = seen.filter((o) => o.at >= at - win)
        const days = new Set(recent.filter((o) => o.react !== 'bad').map((o) => o.day))
        const good = recent.filter((o) => o.react === 'good').length
        const bad = recent.filter((o) => o.react === 'bad').length
        return { ...habit, seen, active: habit.active && days.size >= need && good > bad }
      }).filter((habit) => habit.seen.length)
      return { changed, remaining }
    }
    const { changed: habitsChanged, remaining } = pruneHabits(s.habits, now())
    for (const v of store.prep("SELECT id, at, json FROM versions WHERE kind = 'habits'").all()) {
      const data = JSON.parse(v.json)
      const pruned = pruneHabits(data.habits, v.at)
      if (pruned.changed) store.prep("UPDATE versions SET json = ? WHERE id = ?").run(JSON.stringify({ habits: pruned.remaining }), v.id)
    }
    if (habitsChanged) {
      s.habits = remaining
      saveHabitsVersion(s, '删除经历后重算习惯', 'owner')
    }
    if ([...corrections.values()].some(Boolean)) {
      deps.addVersion('traits', { base: s.base, cur: s.cur, shadow: s.shadow }, { by: 'owner', reason: '删除经历后重算性格' })
    }
    if (habitsChanged || corrections.size || prior !== s.obs.length + s.habitObs.length) save(s)
  }

  function restoreHabits(id) {
    const version = deps.getVersion(id)
    if (version?.kind !== 'habits') throw new Error('没有这个习惯版本')
    const s = load()
    s.habits = version.data.habits.map((habit) => ({
      ...habit, seen: habit.seen.filter((o) => !o.episodes?.some((source) => store.prep('SELECT 1 FROM deletions WHERE id = ? AND kind = ?').get(source, 'episode'))),
    })).filter((habit) => habit.seen.length)
    save(s)
    saveHabitsVersion(s, `退回到版本 ${id}`, 'owner')
  }

  function alert(s, id, text) {
    s.alerts.unshift({ at: now(), trait: id, text, read: false })
    s.alerts = s.alerts.slice(0, 50)
  }

  /** 习惯：反复出现、被正面回应的反应 → 习惯；被冷落或责怪的、很久不出现的慢慢消失。 */
  function habitsNightly(s, at, win, need) {
    // 把新的观察并进已有的习惯（场合和反应都很像就算同一个）
    for (const o of s.habitObs) {
      if (o.merged) continue
      let h = s.habits.find((x) => similar(x.sit, o.sit) >= 0.5 && similar(x.act, o.act) >= 0.5)
      if (!h) {
        h = { id: 'h' + at.toString(36) + s.habits.length, sit: o.sit, act: o.act, seen: [], active: false, since: 0, shareable: o.shareable === true }
        s.habits.push(h)
      }
      h.seen.push({ at: o.at, day: o.day, react: o.react, window: o.window, perception: o.perception, episodes: o.episodes })
      h.seen = h.seen.slice(-60)
      o.merged = true
    }
    const changed = []
    for (const h of s.habits) {
      const recent = h.seen.filter((x) => x.at >= at - win)
      const goodDays = new Set(recent.filter((x) => x.react !== 'bad').map((x) => x.day)).size
      const good = recent.filter((x) => x.react === 'good').length
      const bad = recent.filter((x) => x.react === 'bad').length
      const last = h.seen.length ? h.seen[h.seen.length - 1].at : 0
      if (!h.active && goodDays >= need && good > bad) { h.active = true; h.since = at; changed.push({ id: h.id, on: true }) }
      else if (h.active && (bad >= good + 2 || at - last > 2 * win)) { h.active = false; changed.push({ id: h.id, on: false }) }
    }
    // 不再活跃又很久没出现的就忘了
    s.habits = s.habits.filter((h) => h.active || h.seen.some((x) => x.at >= at - 4 * win)).slice(-60)
    return changed
  }


  return { saveHabitsVersion, forgetEvidence, restoreHabits, habitsNightly, alert }
}
