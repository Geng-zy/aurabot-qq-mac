// 性格的「每晚走一步」：把一天里的证据折成方向，按步长挪一点，很久没证据就慢慢回落。
// 从 mind/personality/index.js 抽出来：那边管存档与对外接口（values/state/text 与人交互前后），
// 这边只做一件事——**这一晚要不要动、动多少、为什么**（含影子模式、管理员影响上限、连续步数提醒）。
//
// 依赖注入：load / save / now / P / setting / TRAIT / TRAIT_IDS / bandOf / r2 / clamp /
// deps（isOwner / goals / addVersion）/ log / habitsNightly / saveHabitsVersion / alert。

const DAY = 86400000

export function createNightly({ load, save, now, P, setting, TRAIT, TRAIT_IDS, bandOf, r2, clamp, deps, log, habitsNightly, saveHabitsVersion, alert }) {
  /**
   * 一项特质今晚的证据。反应好的算 1，没反应算 0.5，被冷落或责怪的反过来算 0.5（这么做不讨喜，往反方向推）。
   * 只算上次走过一步之后的新证据（「和现在的她比」：走过一步，「平时」就变了）。
   */
  function tally(observations) {
    const ev = { 1: { days: new Set(), w: 0, owner: 0 }, [-1]: { days: new Set(), w: 0, owner: 0 } }
    for (const o of observations) {
      const dir = o.react === 'bad' ? -o.d : o.d
      const w = o.react === 'good' ? 1 : 0.5
      const e = ev[dir]
      e.days.add(o.day)
      e.w += w
      if (o.by && deps.isOwner(o.by)) e.owner += w
    }
    return ev
  }

  function movement(cur, base, observations, { need, cap, pull, stepSize, goal }) {
    const ev = tally(observations)
    const dir = [1, -1].find((d) => ev[d].days.size >= need && ev[d].w > ev[-d].w * 1.5)
    if (!dir) return null
    const share = ev[dir].owner / ev[dir].w
    const dev = cur - base
    const outward = dev === 0 || Math.sign(dev) === dir
    const pl = goal === dir ? pull * 0.5 : pull
    const pf = outward ? Math.max(0.15, 1 - pl * Math.min(1, Math.abs(dev) / 0.3)) : 1 + pl * Math.min(1, Math.abs(dev) / 0.3)
    const room = dir > 0 ? 1 - cur : cur
    const ef = outward ? Math.max(0.2, Math.min(1, room / 0.15)) : 1
    const next = r2(clamp(cur + dir * stepSize * (share > cap ? cap / share : 1) * pf * ef, 0.02, 0.98))
    return { next, dir, share, days: ev[dir].days.size, outward }
  }

  /**
   * 睡觉时检查一次。返回这晚走了哪几步（影子模式下只算不生效）。
   */
  function nightly() {
    const s = load()
    const at = now()
    const win = (Number(P('windowDays')) || 14) * DAY
    const need = Number(P('thresholdDays')) || 3
    const stepSize = Number(P('stepSize')) || 0.02
    const gap = (Number(P('stepGapDays')) || 3) * DAY
    const pull = clamp(P('pull'), 0, 0.95)
    const cap = clamp(P('ownerInfluenceCap') ?? 0.6, 0.3, 1)
    const shadow = setting('personality.shadowMode') === true
    if (shadow) {
      s.shadow ??= { ...s.cur }
      s.shadowProgress ??= { lastStep: { ...s.lastStep }, consumed: { ...s.consumed }, run: { ...s.run }, peak: { ...s.peak } }
    } else {
      s.shadow = null
      delete s.shadowProgress
    }
    const progress = shadow ? s.shadowProgress : s
    const target = shadow ? s.shadow : s.cur
    const goals = (deps.goals?.() || []).filter((g) => TRAIT.has(g.trait) && g.dir)
    const steps = []
    for (const id of TRAIT_IDS) {
      const since = Math.max(at - win, progress.consumed[id] || 0)
      const observations = s.obs.filter((o) => o.t === id && o.at >= since)
      const cur = target[id] ?? 0.5
      const base = s.base[id] ?? 0.5
      const dev = cur - base
      const rules = { need, cap, pull, stepSize, goal: Math.sign(goals.find((g) => g.trait === id)?.dir || 0) }
      const move = movement(cur, base, observations, rules)
      if (move && at - (progress.lastStep[id] || 0) >= gap) {
        const { next, dir, share, days, outward } = move
        if (next !== cur) {
          ;(s.traitSteps ??= []).push({ id, at, cur, base, next, shadow, observations, rules })
          target[id] = next
          progress.lastStep[id] = at
          progress.consumed[id] = at
          if (outward) progress.peak[id] = Math.max(progress.peak[id] || 0, Math.abs(next - base))
          const run = progress.run[id] && progress.run[id].dir === dir ? progress.run[id].n + 1 : 1
          progress.run[id] = { dir, n: run }
          const why = `${days} 天里有这样的表现${share > 0 ? `（管理员占 ${Math.round(share * 100)}%）` : ''}`
          steps.push({ id, from: cur, to: next, dir, why, band: bandOf(next), crossed: bandOf(next) !== bandOf(cur) })
          if (!shadow && run >= 3) alert(s, id, `「${TRAIT.get(id).label}」连着 ${run} 步往${dir > 0 ? '高' : '低'}走`)
          if (!shadow && (bandOf(next) === 1 || bandOf(next) === 7)) alert(s, id, `「${TRAIT.get(id).label}」走到了${bandOf(next) === 7 ? '最高' : '最低'}一档`)
        }
        continue
      }
      // 很久没有新证据：很慢地往本来的样子回落一些，但不完全回去（回到最远时偏离的一半为止）
      const quiet = !s.obs.some((o) => o.t === id && o.at >= at - win) && at - (progress.lastStep[id] || 0) >= win
      const floor = (progress.peak[id] || 0) * 0.5
      if (quiet && Math.abs(dev) > floor + 0.005) {
        const back = Math.min(Math.abs(dev) - floor, stepSize * 0.25)
        target[id] = r2(cur - Math.sign(dev) * back)
      }
    }
    const habits = habitsNightly(s, at, win, need)
    if (habits.length) saveHabitsVersion(s, '睡觉时更新了习惯')
    if (steps.length) {
      deps.addVersion('traits', { base: s.base, cur: s.cur, shadow: s.shadow }, {
        by: 'sleep',
        reason: (shadow ? '（影子模式，没生效）' : '') + steps.map((x) => `${TRAIT.get(x.id).label} ${x.from}→${x.to}（${x.why}）`).join('；'),
      })
      log.info(`性格${shadow ? '（影子）' : ''}走了 ${steps.length} 步：`, steps.map((x) => `${x.id} ${x.from}→${x.to}`).join(', '))
    }
    save(s)
    return { steps, shadow, habits }
  }


  return { tally, movement, nightly }
}
