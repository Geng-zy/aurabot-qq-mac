// 人格：状态记录 → 习惯 → 特质（设计文档「人格与自我」）。
// 不知不觉的变化由这里计算（相当于她的「大脑生理」），她自己决定的变化在 self/ 里。
//
// - 状态记录：每段对话记成经历时，模型顺便回答「她这次比平时更……还是更……、依据是哪句、对方什么反应」，
//   依据由程序核对（必须是她自己说的那一行）。只是记录，不改人格。
// - 特质：每晚睡觉时检查一次。同一种变化要在「独立的场合」（不同的日子）出现够多次才算数（门槛），
//   过了门槛也只走一小步（步子），离本来的样子越远往外越难、往回越容易（拉力），同一项两步之间至少隔几天；
//   没有经历支撑就很慢地往回落一些，但不完全回去。管理员一个人推动的部分有上限（影响力上限）。
// - 习惯：同一类场合里反复出现、并且被正面回应的反应变成习惯；被冷落或责怪的慢慢消失。
// - 影子模式：特质只计算不生效。

import { TRAITS, TRAIT, TRAIT_IDS, bandOf, bandMid, bandText } from './traits.js'
import { dayKey } from '../clock.js'
import { parseJson } from '../memory/index.js'

export { TRAITS, TRAIT, TRAIT_IDS, bandOf, bandMid, bandText } from './traits.js'

const DAY = 86400000
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number(x) || 0))
const r2 = (x) => Math.round(x * 1000) / 1000

/** 两段短文字像不像（按两个字一组的重合度，0～1）。 */
export { similar } from './similar.js'

/**
 * @param {{ store: any, now: () => number, setting: (k: string) => any, tz: () => string, log?: any,
 *   isOwner: (id: string) => boolean, addVersion: Function, listVersions: Function, goals?: () => Array<{ trait?: string, dir?: number }> }} deps
 */
import { createHabits } from './habits.js'
import { createNightly } from './nightly.js'

export function createPersonality(deps) {
  const { store, now, setting } = deps
  const P = (k) => setting('personality.' + k)
  const log = deps.log || { info() {}, warn() {}, debug() {} }

  function load() {
    const s = store.get('personality', null)
    if (s && s.cur) {
      // kv 没有 SQL 迁移：旧结构缺字段时补默认值，避免人格页/每轮工具构建直接 TypeError。
      const mid = Object.fromEntries(TRAIT_IDS.map((id) => [id, 0.5]))
      const d = { base: { ...mid }, cur: { ...mid }, shadow: null, confirmed: false, inferred: null, lastStep: {}, consumed: {}, run: {}, peak: {}, alerts: [], obs: [], habitObs: [], habits: [], pending: [] }
      return { ...d, ...s, base: { ...d.base, ...(s.base || {}) }, cur: { ...d.cur, ...(s.cur || {}) }, lastStep: s.lastStep || {}, consumed: s.consumed || {}, run: s.run || {}, peak: s.peak || {}, alerts: Array.isArray(s.alerts) ? s.alerts : [], obs: Array.isArray(s.obs) ? s.obs : [], habitObs: Array.isArray(s.habitObs) ? s.habitObs : [], habits: Array.isArray(s.habits) ? s.habits : [], pending: Array.isArray(s.pending) ? s.pending : [] }
    }
    const mid = Object.fromEntries(TRAIT_IDS.map((id) => [id, 0.5]))
    return { base: { ...mid }, cur: { ...mid }, shadow: null, confirmed: false, inferred: null, lastStep: {}, consumed: {}, run: {}, peak: {}, alerts: [], obs: [], habitObs: [], habits: [], pending: [] }
  }
  function save(s) { store.set('personality', s) }
  // 第一次：先存一份（还没确认的一般人水平），之后从人格卡推、由管理员确认
  if (!store.get('personality', null)) save(load())

  /** 此刻生效的特质（影子模式下也是这份，影子里算出来的另外存着）。 */
  function values() {
    return { ...load().cur }
  }
  function value(id) {
    const v = load().cur[id]
    return typeof v === 'number' ? v : 0.5
  }

  // ---------- 从人格卡推初始数值 ----------
  const INFER_SYSTEM = `你在读一个聊天角色的人格卡，推断她天生的性格在 19 项上各是多少（0～1，0.5 是一般人的平均水平）。
只根据人格卡里写到的说话方式、做法、经历来推，没写到的就给 0.5，不要凭名字或身份想当然。
项目（id：名称）：
${TRAITS.map((t) => `${t.id}：${t.label}（低：${t.bands[0]} 高：${t.bands[6]}）`).join('\n')}
只输出 JSON：{"traits":{"id":数值},"why":{"id":"依据（人格卡里的哪句话，十五个字以内）"}}`

  /** 让模型从人格卡推一份初始数值；没确认之前先用着，面板里列出依据由管理员确认或修改。 */
  async function infer(card, ask) {
    if (!String(card || '').trim() || typeof ask !== 'function') return null
    const j = parseJson(await ask('traits', INFER_SYSTEM, `人格卡：\n${String(card).slice(0, 6000)}`, 1500))
    const got = j && typeof j.traits === 'object' ? j.traits : null
    if (!got) return null
    const v = Object.fromEntries(TRAIT_IDS.map((id) => [id, r2(clamp(got[id] ?? 0.5, 0.02, 0.98))]))
    const why = Object.fromEntries(TRAIT_IDS.map((id) => [id, String(j.why?.[id] || '').slice(0, 40)]))
    const s = load()
    s.inferred = { at: now(), values: v, why }
    // 还没确认过：先拿推出来的当本来的样子
    if (!s.confirmed) {
      s.base = { ...v }
      s.cur = { ...v }
      s.shadow = null
      delete s.shadowProgress
      deps.addVersion('traits', { base: s.base, cur: s.cur }, { by: 'migration', reason: '从人格卡推出初始特质（待管理员确认）' })
    }
    save(s)
    return s.inferred
  }

  /**
   * 管理员确认或修改「本来的样子」。已经走过的变化保留（现在的值跟着平移同样的量）。
   * @param {Record<string, number>} base
   */
  function confirm(base) {
    const s = load()
    for (const id of TRAIT_IDS) {
      if (base?.[id] === undefined) continue
      const nb = r2(clamp(base[id], 0.02, 0.98))
      const moved = (s.cur[id] ?? 0.5) - (s.base[id] ?? 0.5)
      s.base[id] = nb
      s.cur[id] = r2(clamp(nb + moved, 0.02, 0.98))
      s.peak[id] = Math.abs(moved)
    }
    s.confirmed = true
    s.shadow = null
    delete s.shadowProgress
    deps.addVersion('traits', { base: s.base, cur: s.cur }, { by: 'owner', reason: '管理员确认了本来的样子' })
    save(s)
    return s
  }

  /** 退回到某个特质版本。 */
  function restore(id) {
    const v = deps.getVersion(id)
    if (v?.kind !== 'traits') throw new Error('没有这个版本')
    const s = load()
    s.base = { ...s.base, ...(v.data.base || {}) }
    s.cur = { ...s.cur, ...(v.data.cur || {}) }
    s.shadow = null
    delete s.shadowProgress
    s.run = {}
    s.traitSteps = (s.traitSteps || []).filter((step) => step.at <= v.at)
    deps.addVersion('traits', { base: s.base, cur: s.cur }, { by: 'owner', reason: `退回到版本 ${id}` })
    save(s)
    return s
  }

  // ---------- 状态记录（记经历时顺带） ----------
  /** 记经历时附加给模型的说明：只对有依据的几项打分，和「她平时」比。 */
  function encodeAsk() {
    const s = load()
    const usual = TRAITS.map((t) => `${t.id} ${t.label}：${bandText(t.id, s.cur[t.id])}`).join('\n')
    return `另外两项（可选，只写这段里确实有依据的，没有就空数组）：
- "self"：你（self）这段里的表现，和你平时的样子比，在哪几项上明显更高（d=1）或更低（d=-1）；和平时差不多的不写。
  每项 {"t":"项目id","d":1,"line":你自己说的那句的行号,"react":"对方对这句的反应：good（接住了、笑了、夸了）/ bad（冷落、责怪、反感）/ none（没反应）","by":"做出反应的人的id"}
  你平时的样子：
${usual}
- "habit"：这段里你在某类场合的固定反应，例如被开玩笑时反怼回去。每项 {"sit":"什么场合（十字以内）","act":"你的反应（十字以内）","line":行号,"react":"good/bad/none","by":"id"}`
  }

  /**
   * 收下模型给的状态记录。依据必须是她自己说的那一行（程序核对），做出反应的人必须在这段里出现过。
   * @param {any} parsed 模型的整段输出
   * @param {{ window: string, rows: Array<{ id: number, at: number, who: string, dir: string }> }} o
   */
  function observe(parsed, { window, rows, shareableHabits = true, evidence = [] }) {
    const self = Array.isArray(parsed?.self) ? parsed.self : []
    const habit = Array.isArray(parsed?.habit) ? parsed.habit : []
    if (!self.length && !habit.length) return { traits: 0, habits: 0 }
    const s = load()
    const people = new Set(rows.filter((r) => r.dir === 'in').map((r) => String(r.who)))
    const lineOf = (n) => rows[Number(n) - 1]
    const react = (x) => (['good', 'bad', 'none'].includes(x) ? x : 'none')
    const by = (x) => (people.has(String(x || '')) ? String(x) : '')
    const sourceOf = (row) => ({
      perception: row.id,
      episodes: evidence.filter((e) => e.sources.includes(row.id)).map((e) => e.id),
    })
    let nt = 0
    let nh = 0
    for (const o of self) {
      const row = lineOf(o?.line)
      if (!row || row.dir !== 'out' || !TRAIT.has(o?.t)) continue
      const d = Number(o.d) > 0 ? 1 : Number(o.d) < 0 ? -1 : 0
      if (!d) continue
      s.obs.push({ at: row.at, day: dayKey(row.at, deps.tz()), t: o.t, d, react: react(o.react), by: by(o.by), window, ...sourceOf(row) })
      nt++
    }
    for (const o of habit) {
      const row = lineOf(o?.line)
      const sit = String(o?.sit || '').trim().slice(0, 20)
      const act = String(o?.act || '').trim().slice(0, 20)
      if (!row || row.dir !== 'out' || !sit || !act) continue
      s.habitObs.push({ at: row.at, day: dayKey(row.at, deps.tz()), sit, act, react: react(o.react), by: by(o.by), window, shareable: shareableHabits, ...sourceOf(row) })
      nh++
    }
    const keepFrom = now() - 120 * DAY
    s.obs = s.obs.filter((x) => x.at >= keepFrom).slice(-3000)
    s.habitObs = s.habitObs.filter((x) => x.at >= keepFrom).slice(-1000)
    save(s)
    return { traits: nt, habits: nh }
  }

  // 「每晚走一步」在 nightly.js
  const nightlyApi = createNightly({
    load, save, now, P, setting, TRAIT, TRAIT_IDS, bandOf, r2, clamp, deps, log,
    habitsNightly: (...a) => habitsNightly(...a),
    saveHabitsVersion: (...a) => saveHabitsVersion(...a),
    alert: (...a) => alert(...a),
  })

  // 习惯这一支（习惯夜间更新、版本、证据遗忘）在 habits.js
  // 习惯用到 movement（证据被删后要重算），由 nightly 提供；所以先建 nightly 的纯函数部分
  const habitsApi = createHabits({
    store, load, save, now, r2, clamp, P, DAY, deps,
    movement: (...a) => nightlyApi.movement(...a),
  })
  const { saveHabitsVersion, forgetEvidence, restoreHabits, habitsNightly, alert } = habitsApi

  // ---------- 给她看 ----------
  /** 和本来的样子差得明显的几项（跨了档），用「你最近比以前更……」的说法。 */
  function changed() {
    const s = load()
    return TRAIT_IDS.filter((id) => bandOf(s.cur[id]) !== bandOf(s.base[id])).map((id) => {
      const t = TRAIT.get(id)
      const up = s.cur[id] > s.base[id]
      return { id, label: t.label, text: `你最近比以前更${up ? t.up : t.down}：${bandText(id, s.cur[id])}` }
    })
  }
  function habits() {
    return load().habits.filter((h) => h.active)
  }

  /** 放在系统提示词里的那部分（很少变：只在睡觉时走了一步、或习惯变了时才变）。 */
  function selfText({ shareableOnly = false, isVisible = () => true } = {}) {
    const parts = []
    const ch = changed()
    if (ch.length) parts.push('【你最近的变化（不知不觉的）】\n' + ch.map((x) => '- ' + x.text).join('\n'))
    const hb = habits().filter((h) => (!shareableOnly || h.shareable) && h.seen.every((o) => (o.episodes || []).every(isVisible))).slice(0, 5)
    if (hb.length) parts.push('【你的小习惯】\n' + hb.map((h) => `- ${h.sit}时，你会${h.act}`).join('\n'))
    return parts.join('\n')
  }

  /** 跟眼前场合有关的几项（每轮放在工作记忆里，很短）。 */
  function sceneText({ group = false, withOwner = false } = {}) {
    const s = load()
    const ids = group ? ['sociability', 'assertiveness'] : withOwner ? ['attachAnxiety', 'attachAvoidance'] : ['sociability']
    const skip = new Set(changed().map((x) => x.id))
    const lines = ids.filter((id) => !skip.has(id)).map((id) => `${TRAIT.get(id).label}：${bandText(id, s.cur[id])}`)
    return lines.length ? `（你的性格在这种场合：${lines.join(' ')}）` : ''
  }

  function state() {
    const s = load()
    return {
      confirmed: s.confirmed,
      inferred: s.inferred,
      shadowMode: setting('personality.shadowMode') === true,
      traits: TRAITS.map((t) => ({
        id: t.id, group: t.group, label: t.label, base: s.base[t.id], cur: s.cur[t.id], shadow: s.shadow ? s.shadow[t.id] : null,
        band: bandOf(s.cur[t.id]), baseBand: bandOf(s.base[t.id]), text: bandText(t.id, s.cur[t.id]), lastStep: s.lastStep[t.id] || 0,
        evidence: s.obs.filter((o) => o.t === t.id).slice(-8).reverse(),
      })),
      habits: s.habits.map((h) => ({ id: h.id, sit: h.sit, act: h.act, active: h.active, since: h.since, count: h.seen.length })),
      alerts: s.alerts,
    }
  }
  function readAlerts() {
    const s = load()
    for (const a of s.alerts) a.read = true
    save(s)
  }

  const { nightly } = nightlyApi

  return { values, value, infer, confirm, restore, restoreHabits, encodeAsk, observe, forgetEvidence, nightly, changed, habits, selfText, sceneText, state, readAlerts, bandMid }
}
