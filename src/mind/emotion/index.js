// 情绪：好几种情绪可以同时在，每种有强度、对象、原因和自己的消退速度；心情（愉快度、唤醒度）由情绪和身体慢慢累积，
// 有惯性，没事时回到基线。规矩（专一、年龄）在这里硬判，不交给模型。
// 依据见 catalog.js 和设计文档「情绪」一章。

import { EMOTIONS, emotionOf, baseHours } from './catalog.js'

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number(x) || 0))
const LOG2_10 = Math.log2(10) // 「完全过去」按强度降到一成算，半衰期 = 持续时间 / log2(10)
const HOUR = 3600000
/** 按字截断（不会把 emoji 切成半个）。 */
const clip = (x, n) => [...String(x || '').toWellFormed()].slice(0, n).join('')

/** 强度的说法。 */
export const degree = (i) => (i >= 0.75 ? '很' : i >= 0.45 ? '有些' : '一点')

/** 心情的说法：愉快度 v、唤醒度 a，都是 -1～1。 */
export function moodLabel(v, a) {
  if (v >= 0.5) return a >= 0.3 ? '特别开心' : '心情很好'
  if (v >= 0.25) return a <= -0.4 ? '很放松' : '心情不错'
  if (v > -0.15) return a <= -0.5 ? '有点蔫' : a >= 0.5 ? '有点躁' : '平平常常'
  if (v > -0.45) return a >= 0.3 ? '有点烦' : '有点低落'
  return a >= 0.3 ? '很烦躁' : '不太开心'
}

/**
 * @param {{ store: any, now: () => number, setting: (k: string) => any, identity: () => any, isOwner: (id: string) => boolean,
 *   person: (id: string) => any, random?: () => number, log?: any }} deps
 */
export function createEmotion(deps) {
  const { store, now, setting } = deps
  const random = deps.random || Math.random
  const E = (k) => setting('emotion.' + k)

  function load() {
    const s = store.get('emotion', null)
    return s && Array.isArray(s.active) ? s : { active: [], mood: null, history: [] }
  }
  function save(s) {
    store.set('emotion', s)
  }
  // 平时的心情水位：设置里的基线，再按性格里的「容易低落」挪一点（0.5 是一般人，不挪）
  const baseline = () => ({ v: Math.max(-1, Math.min(1, (Number(E('baselineValence')) || 0) - 0.3 * ((Number(deps.trait?.('depression')) || 0.5) - 0.5))), a: 0 })
  const initial = load()
  if (!initial.mood) {
    initial.mood = { ...baseline(), at: now() }
    save(initial)
  }

  /** 某一刻的强度。 */
  function strength(e, at = now()) {
    return e.i0 * Math.pow(2, -Math.max(0, at - e.at) / (e.halfH * HOUR))
  }

  /**
   * 她感到了一些情绪。规矩：
   * - 认不出的名字不要；
   * - 没满 18 岁（或没填年龄）没有性欲；
   * - 「专一」开着时，恋爱式情绪只对主人：对别人的心动 / 爱慕变成喜爱（不超过中等），性欲去掉，嫉妒变成羡慕；
   * - 被带动的（src=contagion）按「情绪传染强度」打折；
   * - 调节方式改变强度和持续时间（Gross 的情绪调节模型；具体倍数是经验值）。
   * @param {Array<{ name: string, intensity: number, target?: string, why?: string, importance?: number, reg?: string, src?: string }>} items
   * @returns 实际记下的
   */
  function feel(items, { window = '', source = '', eventId = '', revision = null } = {}) {
    const id = deps.identity()
    const s = load()
    const at = now()
    updateMood(s, at, deps.body?.())
    if (revision && source === 'appraisal') {
      const prior = s.active.find((e) => e.source === 'appraisal' && e.window === window && e.target === revision.target && e.eventId === revision.eventId)
      if (prior) {
        prior.i0 = strength(prior, at) * 0.25
        prior.at = at
      }
    }
    const out = []
    for (const raw of Array.isArray(items) ? items : []) {
      let def = emotionOf(raw?.name)
      if (!def) continue
      let intensity = clamp(raw.intensity, 0, 1)
      const target = String(raw.target || '')
      if (def.adult && !id.sexualDesire) continue
      if (def.romantic && id.exclusive && target && !deps.isOwner(target)) {
        if (def.name === '性欲') continue
        if (def.name === '嫉妒') def = emotionOf('羡慕')
        else { def = emotionOf('喜爱'); intensity = Math.min(intensity, 0.5) }
      }
      if (def.romantic && id.exclusive && !target) continue // 恋爱式情绪一定有对象
      if (raw.src === 'contagion') intensity *= clamp(Number(E('contagion')) * 2, 0, 1)
      const importance = clamp(raw.importance ?? 0.5, 0, 1)
      let hours = baseHours(def.name) * (Number(E('durationScale')) || 1) * (0.5 + importance)
      const reg = String(raw.reg || '')
      if (reg === 'reappraise') { intensity *= 0.6; hours *= 0.7 } // 换个角度想：真的变弱
      if (reg === 'ruminate') hours *= 1.5 // 反复想：越想越久
      if (reg === 'share') intensity *= 0.8 // 找人说
      if (intensity < 0.05) continue
      const e = {
        name: def.name, i0: intensity, at, halfH: Math.max(0.05, hours / LOG2_10), target, why: clip(raw.why, 80),
        window, importance, hidden: reg === 'suppress', distract: reg === 'distract' ? at + HOUR : 0, source, ...(eventId ? { eventId } : {}),
      }
      // 同一会话和事件里的同类情绪取更强的一份，保留不同事件各自的依据。
      const same = s.active.find((x) => x.name === e.name && x.target === e.target && x.window === window && (x.eventId || '') === eventId)
      if (same && strength(same, at) >= e.i0) { same.why = e.why || same.why; continue }
      if (same) s.active.splice(s.active.indexOf(same), 1)
      s.active.push(e)
      s.history.unshift({ at, name: e.name, i: Math.round(e.i0 * 100) / 100, target, why: e.why, window, reg, ...(eventId ? { source, eventId } : {}) })
      out.push(e)
    }
    s.active = s.active.filter((x) => strength(x, at) >= 0.05).slice(-Number(E('maxActive') || 12))
    s.history = s.history.slice(0, 300)
    save(s)
    return out
  }

  /** 想起带着情绪的旧事：重新点燃一下（反复想会让情绪更久，Verduyn & Lavrijsen 2015）。 */
  function rekindle(memories, { window = '' } = {}) {
    const k = Number(E('rekindle')) || 0
    if (k <= 0) return []
    const items = (memories || []).filter((m) => m?.emotion?.name && m.emotion.intensity > 0)
      .map((m) => ({ name: m.emotion.name, intensity: m.emotion.intensity * k, target: m.target || '', why: '想起：' + String(m.text || '').slice(0, 40), importance: 0.4 }))
    return items.length ? feel(items, { window, source: 'recall' }) : []
  }

  /**
   * 心情：朝「基线 + 当前情绪 + 身体」去，惯性越大走得越慢（惯性 = 每小时的自回归系数，Kuppens 等 2010）。
   */
  function updateMood(s, at, body) {
    const b = baseline()
    const m = s.mood || { v: b.v, a: b.a, at }
    const live = s.active.map((e) => ({ e, i: strength(e, at) * (e.distract && at < e.distract ? 0.5 : 1), def: emotionOf(e.name) })).filter((x) => x.def)
    let tv = b.v
    let ta = b.a
    for (const { i, def } of live) { tv += def.v * i * 0.6; ta += def.a * i * 0.6 }
    if (body) {
      tv -= (Number(E('hungerMood')) || 0) * (body.hunger || 0)
      tv -= 0.2 * Math.max(0, (body.sleepiness || 0) - 0.5)
      ta += 0.6 * ((body.energy ?? 1) - 0.6) - 0.5 * Math.max(0, (body.sleepiness || 0) - 0.3)
    }
    tv = clamp(tv, -1, 1)
    ta = clamp(ta, -1, 1)
    const hours = Math.max(0, at - (m.at ?? at)) / HOUR
    const k = Math.pow(clamp(E('inertia'), 0, 0.99), hours)
    s.mood = { v: tv + (m.v - tv) * k, a: ta + (m.a - ta) * k, at }
    return s.mood
  }
  /** 此刻的情绪和心情。body 是身体状态（精力、困、饿），会影响心情。 */
  function state(body) {
    const s = load()
    const at = now()
    const mood = updateMood(s, at, body)
    const active = s.active.map((e) => ({ name: e.name, intensity: strength(e, at), target: e.target, why: e.why, hidden: e.hidden, window: e.window, source: e.source, eventId: e.eventId, at: e.at, def: emotionOf(e.name) }))
      .filter((e) => e.intensity >= 0.05)
      .sort((a, b) => b.intensity - a.intensity)
    return { mood: { ...mood, label: moodLabel(mood.v, mood.a) }, active }
  }

  /** 睡一觉，情绪淡一点（只做很弱的缓和；研究结论不一致）。 */
  function afterSleep() {
    const k = Number(E('sleepSoften')) || 0
    const s = load()
    const at = now()
    updateMood(s, at, deps.body?.())
    for (const e of s.active) {
      const i = strength(e, at) * (1 - k)
      e.i0 = i
      e.at = at
    }
    save(s)
  }

  /** 心情对说话方式的影响倍数（表情包、语音、回复快慢、群里插话），精力和困也算进去。 */
  function effects(body) {
    const { mood } = state(body)
    const energy = body?.energy ?? 1
    // 「想睡的程度」里有生物钟的底子，白天也不是 0；只有超出平时白天水平（0.4）的部分才算困
    const sleepy = Math.max(0, ((body?.sleepiness ?? 0) - 0.4) / 0.6)
    const up = 1 + 0.8 * mood.v + 0.3 * mood.a
    const tired = 0.4 + 0.6 * energy
    return {
      sticker: clamp(up * tired, 0.2, 1.8),
      voice: clamp(up * tired, 0.2, 1.6),
      delay: clamp(1 - 0.25 * mood.v + 0.5 * (1 - energy) + 0.6 * sleepy, 0.7, 2.5),
      chatty: clamp(up * tired * (1 - 0.6 * sleepy), 0.1, 1.8),
    }
  }

  /**
   * 给她看的情绪：心情 + 最强的几种情绪（带对象）。
   * 对象不是眼前的人的气，提醒她别带到眼前的人身上；气很大又很累时，按「迁怒倾向」偶尔压不住（越亲近越忍得住）。
   * @param {{ people?: string[], body?: any, name?: (id: string) => string }} o
   */
  function describe({ people = [], body, window, name = (x) => x } = {}) {
    const { mood, active } = state(body)
    const lines = [`【心情】${mood.label}`]
    const shown = active.filter((e) => e.intensity >= 0.12).slice(0, 5).map((e) =>
      window !== undefined && (e.source === 'deep' || e.window !== window) ? { ...e, target: '', why: '' } : e)
    if (shown.length) {
      lines.push('【此刻的感受】' + shown.map((e) => {
        const who = e.target && e.target !== 'self' ? `对${name(e.target)}` : ''
        return `${who}${degree(e.intensity)}${e.name}${e.why ? `（${e.why}）` : ''}${e.hidden ? '，你忍着没表现出来' : ''}`
      }).join('；'))
    }
    const here = new Set(people)
    const angryElsewhere = shown.filter((e) => e.def?.anger && e.target && !here.has(e.target))
    if (angryElsewhere.length) {
      lines.push(`（这些气是冲着${[...new Set(angryElsewhere.map((e) => name(e.target)))].join('、')}的，不是眼前的人；可以跟信得过的人吐槽，但别把气撒到眼前的人身上。）`)
      const top = angryElsewhere[0].intensity
      const worn = (body?.energy ?? 1) < 0.3 || (body?.sleepiness ?? 0) > 0.7
      // 越亲近越忍得住（亲近度来自关系）
      const close = Math.max(0, ...people.map((p) => (deps.isOwner(p) ? 0.8 : Number(deps.closeness?.(p)) || 0)))
      if (top >= 0.7 && worn && random() < Number(E('displacement')) * (1 - close)) {
        lines.push('（你气还没消，又累，这会儿可能压不住、语气冲一点、话少一点——不会骂人；察觉到了就说清楚不是冲对方，道个歉。）')
      }
    }
    return lines.join('\n')
  }

  function history(limit = 50) {
    return load().history.slice(0, limit)
  }

  function hasEvent(id) {
    return load().history.some((e) => e.eventId === id)
  }

  function forgetEvent(id) {
    const s = load()
    const active = s.active.filter((e) => e.eventId !== id)
    const history = s.history.filter((e) => e.eventId !== id)
    if (active.length === s.active.length && history.length === s.history.length) return
    save({ ...s, active, history })
  }

  function forgetAppraisals(person, windows) {
    const s = load()
    const keep = (e) => !['appraisal', 'observation'].includes(e.source) || (e.target !== person && !windows.includes(e.window))
    const active = s.active.filter(keep)
    const history = s.history.filter(keep)
    if (active.length === s.active.length && history.length === s.history.length) return
    updateMood(s, now(), deps.body?.())
    save({ ...s, active, history })
  }

  return { feel, rekindle, state, effects, describe, afterSleep, history, forgetAppraisals, forgetEvent, hasEvent, strength, EMOTIONS }
}
