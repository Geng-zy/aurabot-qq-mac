// 虚拟身体：只模拟对心理有影响的部分——精力、困、饿、睡眠，以及换时区后的倒时差。
//
// 困：睡眠的双过程模型（Borbély 1982；Daan、Beersma & Borbély 1984）。
//   过程 S（睡眠压力）醒着时朝 1 上升，时间常数约 18.2 小时；睡着时指数下降，时间常数约 4.2 小时。
//   过程 C（生物钟）用以「生物钟上的夜晚」中点为峰的余弦表示。
//   想睡的程度 = 0.6×S + 0.4×C（组合方式和两条线是经验值；原模型用随 C 变化的上下阈值，这里做了简化）。
// 倒时差：每天大约能调过来一个时区（Waterhouse 等 2007，Lancet 综述：往东约 1 小时/天，往西约 1.5 小时/天）。
// 刚睡醒迷糊：睡眠惯性一般持续 15～30 分钟（Tassi & Muzet 2000 综述）。

import { localParts, parseRange, parseHm, minuteOfDay } from '../clock.js'

const HOUR = 3600000
const MIN = 60000
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number(x) || 0))

/** 时区相对 UTC 的偏移（小时）。 */
export function tzOffsetHours(at, tz) {
  const p = localParts(at, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  return Math.round((asUtc - Math.floor(at / MIN) * MIN) / MIN) / 60
}

/**
 * @param {{ store: any, now: () => number, setting: (k: string) => any, tz: () => string, log?: any }} deps
 */
export function createBody(deps) {
  const { store, now, setting } = deps
  const B = (k) => setting('body.' + k)

  function fresh(at) {
    return { at, energy: 0.85, S: 0.35, asleep: false, sleepAt: 0, wokeAt: 0, wokenBy: '', hunger: 0.2, lastMeal: null, lastSleep: null, ownerAt: 0, tz: deps.tz(), shift: 0 }
  }
  function load() {
    const s = store.get('body', null)
    return s && typeof s === 'object' && Number.isFinite(s.at) ? s : fresh(now())
  }
  function save(s) {
    store.set('body', s)
  }
  // 第一次有身体：从现在开始算
  if (!store.get('body', null)) save(fresh(now()))

  /** 夜晚的中点（一天中的第几分钟）和长度（小时）。 */
  function night() {
    const r = parseRange(B('sleepWindow')) || parseRange('23:30-07:30')
    const len = (r.end - r.start + 1440) % 1440 || 480
    return { mid: (r.start + len / 2) % 1440, hours: len / 60, end: r.end }
  }
  /** 生物钟：-1～1，夜晚中点最想睡。倒时差时身体的钟还停在旧时区。 */
  function circadian(at, s) {
    const n = night()
    const m = (minuteOfDay(at, deps.tz()) - (s.shift || 0) * 60 + 1440) % 1440
    return Math.cos(2 * Math.PI * (m - n.mid) / 1440)
  }
  const propensity = (S, C) => clamp(0.6 * S + 0.4 * (C + 1) / 2)

  /** 时区改了：身体的钟不会马上跟上。 */
  function followTimezone(s, at) {
    const tz = deps.tz()
    if (s.tz === tz) return
    if (B('jetLag') !== false && s.tz) {
      try { s.shift = (s.shift || 0) + (tzOffsetHours(at, tz) - tzOffsetHours(at, s.tz)) } catch { s.shift = 0 }
    } else s.shift = 0
    s.tz = tz
  }

  /** 时间推进到 at：精力、困、饿按时间常数变化。返回这段时间里发生的事。 */
  function advance(s, at) {
    const events = []
    followTimezone(s, at)
    const rise = Number(B('sleepRiseHours')) || 18.2
    const decay = Number(B('sleepDecayHours')) || 4.2
    const recover = Number(B('energyRecoverPerHour')) || 0
    const hungerHours = Number(B('hungerHours')) || 5
    let t = s.at
    while (t < at) {
      const dt = Math.min(10 * MIN, at - t)
      const h = dt / HOUR
      if (s.asleep) {
        s.S *= Math.exp(-h / decay)
        s.energy = 1 - (1 - s.energy) * Math.exp(-h / decay)
      } else {
        s.S = 1 - (1 - s.S) * Math.exp(-h / rise)
        s.energy = Math.min(1 - 0.4 * s.S, s.energy + recover * h)
      }
      if (B('hunger') !== false) s.hunger = clamp(s.hunger + h / hungerHours * (s.asleep ? 0.3 : 1))
      else s.hunger = 0
      // 倒时差：每天调回来一点（往东 1 小时、往西 1.5 小时）
      if (s.shift) {
        const step = (s.shift > 0 ? 1 : 1.5) * h / 24
        s.shift = Math.abs(s.shift) <= step ? 0 : s.shift - Math.sign(s.shift) * step
      }
      t += dt
    }
    s.at = at
    return events
  }

  /**
   * 推进到现在，按身体自己决定睡、醒、吃：
   * - 困到门槛、又是生物钟的夜里就睡；刚和主人聊着（stayUpMinutes 内）就熬着不睡；
   * - 睡够了（想睡的程度低于醒来的门槛）或者已经过了夜晚结束 3 小时就醒；
   * - 饿了、正好是饭点（前后 1 小时）或者饿得受不了，她自己吃（「只靠主人投喂」开着时不吃）。
   * @returns {{ state: any, events: Array<{ kind: 'slept'|'woke'|'ate', [k: string]: any }> }}
   */
  function tick() {
    const at = now()
    const s = load()
    const events = advance(s, at)
    const C = circadian(at, s)
    const p = propensity(s.S, C)
    if (!s.asleep) {
      const stayUp = at - (s.ownerAt || 0) < (Number(B('stayUpMinutes')) || 20) * MIN
      if (p >= Number(B('sleepThreshold')) && C > 0 && !stayUp) {
        s.asleep = true
        s.sleepAt = at
        s.wokenBy = ''
        events.push({ kind: 'slept', at })
      }
    } else {
      const n = night()
      const pastEnd = ((minuteOfDay(at, deps.tz()) - n.end + 1440) % 1440) / 60
      if (p <= Number(B('wakeThreshold')) || (pastEnd >= 3 && pastEnd < 12)) events.push(wakeUp(s, at, ''))
    }
    if (!s.asleep && B('hunger') !== false && !B('feedOnlyByOwner')) {
      const nearMeal = String(B('mealTimes') || '').split(/[,，\s]+/).map(parseHm).filter((x) => x !== null)
        .some((m) => Math.min(Math.abs(minuteOfDay(at, deps.tz()) - m), 1440 - Math.abs(minuteOfDay(at, deps.tz()) - m)) <= 60)
      if ((s.hunger >= Number(B('selfFeedAt')) && nearMeal) || s.hunger >= 0.95) {
        events.push({ kind: 'ate', at, food: '', by: 'self', before: s.hunger })
        eat(s, at, '', 'self')
      }
    }
    save(s)
    return { state: view(s, at), events }
  }

  function wakeUp(s, at, by) {
    const hours = (at - s.sleepAt) / HOUR
    const quality = clamp(hours / night().hours)
    s.asleep = false
    s.wokeAt = at
    s.wokenBy = by
    s.lastSleep = { start: s.sleepAt, end: at, hours: Math.round(hours * 10) / 10, quality: Math.round(quality * 100) / 100, wokenBy: by }
    return { kind: 'woke', at, by, hours, quality, wokenUp: Boolean(by) }
  }

  /** 被人叫醒（谁能叫醒由对接层按设置判断）。 */
  function wake(by) {
    const at = now()
    const s = load()
    advance(s, at)
    if (!s.asleep) return null
    const ev = wakeUp(s, at, String(by || ''))
    save(s)
    return ev
  }

  /** 让她睡（面板「让她睡吧」或测试用）。 */
  function sleepNow() {
    const at = now()
    const s = load()
    advance(s, at)
    if (s.asleep) return false
    s.asleep = true
    s.sleepAt = at
    save(s)
    return true
  }

  function eat(s, at, food, by) {
    s.hunger = Math.max(0, s.hunger - 0.9)
    s.lastMeal = { at, food: String(food || ''), by: String(by || '') }
  }

  /** 有人喂她（或她自己吃）。都是虚拟的，不涉及付款。 */
  function feed(food, by) {
    const at = now()
    const s = load()
    advance(s, at)
    const before = s.hunger
    eat(s, at, food, by)
    save(s)
    return { before, after: s.hunger, food: String(food || ''), by: String(by || '') }
  }

  /** 做事花精力（聊天、唱歌、画画……）。 */
  function spend(cost) {
    const at = now()
    const s = load()
    advance(s, at)
    s.energy = clamp(s.energy - Math.max(0, Number(cost) || 0))
    save(s)
  }

  /** 和主人说着话：熬夜就是这么来的。 */
  function noteOwner() {
    const s = load()
    s.ownerAt = now()
    save(s)
  }

  function view(s, at) {
    const C = circadian(at, s)
    return {
      energy: s.energy,
      sleepiness: s.asleep ? 1 : propensity(s.S, C),
      pressure: s.S,
      hunger: B('hunger') !== false ? s.hunger : 0,
      asleep: s.asleep,
      sleepAt: s.sleepAt,
      groggy: !s.asleep && s.wokeAt && at - s.wokeAt < (Number(B('groggyMinutes')) || 20) * MIN,
      lastMeal: s.lastMeal,
      lastSleep: s.lastSleep,
      shift: Math.round((s.shift || 0) * 10) / 10,
    }
  }
  function state({ persist = true } = {}) {
    const at = now()
    const s = load()
    advance(s, at)
    if (persist) save(s)
    return view(s, at)
  }

  /** 给她看的身体状态。 */
  function describe(v = state()) {
    const parts = []
    parts.push(v.energy >= 0.7 ? '精力挺足' : v.energy >= 0.45 ? '精力还行' : v.energy >= 0.25 ? '有点累' : '很累')
    if (v.groggy) parts.push('刚睡醒，还迷迷糊糊的')
    else if (v.sleepiness >= 0.75) parts.push('很困')
    else if (v.sleepiness >= 0.6) parts.push('有点困')
    if (v.hunger >= 0.8) parts.push('很饿')
    else if (v.hunger >= 0.6) parts.push('饿了')
    else if (v.hunger >= 0.45) parts.push('有点饿')
    if (v.shift && Math.abs(v.shift) >= 1) parts.push('还在倒时差')
    return '【身体】' + parts.join('，')
  }

  return { tick, wake, sleepNow, feed, spend, noteOwner, state, describe }
}
