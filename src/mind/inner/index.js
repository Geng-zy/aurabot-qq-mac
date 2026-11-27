// 内心活动：她醒着、没人找时，一步一步地想（意识流）；想着想着会冒出感受和打算，打算够强就去做。
//
// 规矩（设计文档「注意与意识流」「本地小模型的规矩」）：
// - 日常念头用本地小模型，只耗电不耗钱；没装本地小模型时用聊天模型，但想得慢得多（省钱）。
// - 小模型念头里的「事实」一律不进记忆，只留感受和打算。
// - 连续几步越想越难受，或者涉及和管理员的关系又是负面的：按硬规则交给聊天模型认真想一次（深想，每天有次数上限）。
// - 连续几步在重复：停下来放空，无聊感上升。
// - 走神比例：闲着时有多少时间在想、多少在发呆（Killingsworth & Gilbert 2010 等，默认 0.4）。

import { parseJson } from '../memory/index.js'
import { buildSystem, factualRules, fitLines, overlap, parseThought } from './text.js'
import { createDeepThink } from './deep.js'

export { overlap, parseThought, fitLines, factualRules } from './text.js'
import { emotionOf } from '../emotion/catalog.js'
import { describeNow, shortTime, dayKey } from '../clock.js'
import { placeOf, shortId } from '../place.js'

const MIN = 60000
const RECENT_MINUTES = 30
const OWNER_MINUTES = 120
const LOCAL_CONTEXT = { owner: 12_000, other: 16_000, line: 500 }
const REMOTE_CONTEXT = { owner: 2400, other: 3600, line: 180 }
const AFFECT_WINDOW = 30 * MIN
const ROUTINE_CORRECTION = /(?:看|读|认|算)(?:错|串|反)|(?:只是|就是).{0,8}(?:玩笑|纠正)/u
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number(x) || 0))
const clip = (x, n) => [...String(x || '').toWellFormed()].slice(0, n).join('')

/**
 * @param {{
 *   store: any, now: () => number, setting: (k: string) => any, tz: () => string, identity: () => any, isOwner: (id: string) => boolean,
 *   person: (id: string) => any, memory: any, emotion: any, body: any, motivation: any, budget: any, log?: any, random?: () => number,
 * }} deps
 */
export function createInner(deps) {
  const { store, now, setting } = deps
  const log = deps.log || { debug() {}, info() {}, warn() {}, error() {} }
  const A = (k) => setting('attention.' + k)
  let local = null // { chat(messages, opts) }
  let ask = null // 聊天模型：({ scene, system, text, maxTokens }) => string
  function connect(o = {}) {
    if (o.local !== undefined) local = o.local
    if (o.ask !== undefined) ask = o.ask
  }

  function load() {
    const s = store.get('inner', null)
    return s && Array.isArray(s.log) ? s : { log: [], nextAt: 0, boredom: 0, idleSince: 0, deepToday: { day: '', n: 0 } }
  }
  function save(s) { store.set('inner', s) }

  // 她心里怎么叫管理员：她自己改过的称呼优先
  const ownerName = () => String(deps.ownerCall?.() || '管理员')
  const place = deps.place || placeOf
  const nameOf = (pid) => (deps.isOwner(pid) ? ownerName() : deps.person(pid)?.name || shortId(pid))

  /** 私聊和实际参与的群聊进入近况；群里旁听的原话仍留在记忆库。 */
  function recentHappenings(at, zone, budget) {
    const since = at - RECENT_MINUTES * MIN
    const candidates = store.prep(`SELECT id, at, window, who, dir, text, addressed FROM (
      SELECT id, at, window, who, dir, text, addressed,
        ROW_NUMBER() OVER (PARTITION BY window ORDER BY at DESC, id DESC) AS pos
      FROM (
        SELECT id, at, window, who, dir, text,
          CASE WHEN json_valid(json) THEN json_extract(json, '$.addressed') = 1 ELSE 0 END AS addressed
        FROM perception WHERE at > ? AND at <= ? AND LENGTH(TRIM(text)) > 0
      ) WHERE dir = 'out' OR addressed OR instr(window, ':group:') = 0
    ) ORDER BY pos, at DESC, id DESC LIMIT 1024`).all(since, at)
    const ownerId = deps.identity().ownerId
    const ownerWindows = ownerId ? store.prep(`SELECT DISTINCT window FROM perception WHERE who = ? AND dir = 'in' AND at > ? AND at <= ?`)
      .all(ownerId, at - OWNER_MINUTES * MIN, at).map((r) => r.window).filter((window) => deps.isOwnerWindow?.(window)) : []
    const ownerWindowSet = new Set(ownerWindows)
    const ownerRows = ownerWindows.flatMap((window) => store.prep(`SELECT id, at, window, who, dir, text FROM perception
      WHERE window = ? AND at > ? AND at <= ? AND LENGTH(TRIM(text)) > 0 ORDER BY at DESC, id DESC LIMIT 512`)
      .all(window, at - OWNER_MINUTES * MIN, at)).sort((a, b) => b.at - a.at || b.id - a.id)
    const lineOf = (r) => {
      const kind = place(r.window).kind
      const where = kind === 'group' ? '群里' : kind === 'private' ? '私聊里' : '其他会话'
      return `[原话 ${r.id}] ${shortTime(r.at, zone)} ${where}（${r.window}） ${r.dir === 'out' ? '你' : nameOf(r.who)}说：${clip(r.text.replace(/\s+/g, ' '), budget.line)}`
    }
    const otherRows = candidates.filter((r) => !ownerWindowSet.has(r.window)
      && (place(r.window).kind !== 'group' || r.dir === 'out' || r.addressed === 1))
    const owner = ownerId && store.prep(`SELECT COUNT(*) AS count, MAX(at) AS latest FROM perception
      WHERE dir = 'in' AND who = ? AND at > ? AND at <= ?`).get(ownerId, since, at)
    const contact = owner?.count
      ? `最近 ${RECENT_MINUTES} 分钟在各会话共收到${ownerName()} ${owner.count} 条消息，最新一条在 ${shortTime(owner.latest, zone)}。`
      : `最近 ${RECENT_MINUTES} 分钟的感知记录里没有${ownerName()}的新消息，无法据此推断对方的原因或态度。`
    const cue = ownerRows.find((r) => r.dir === 'in' && r.who === ownerId)
      || otherRows.find((r) => r.dir === 'in')
    const ownerShown = fitLines(ownerRows, lineOf, budget.owner)
    const otherShown = fitLines(otherRows, lineOf, budget.other)
    return { ownerLines: ownerShown.map((x) => x.line), lines: otherShown.map((x) => x.line),
      evidence: new Map([...ownerShown, ...otherShown].filter(({ row }) => row.dir === 'in' && at - row.at <= AFFECT_WINDOW).map(({ row }) => [row.id, row])),
      contact: ownerId ? contact : '', cue: clip(cue?.text, 160) }
  }

  function currentContext(budget) {
    const at = now()
    const zone = deps.tz()
    const { lines, contact, ownerLines, cue, evidence } = recentHappenings(at, zone, budget)
    return {
      cue,
      evidence,
      clock: `【当前时间】${describeNow(at, zone)}（${zone}，24 小时制）`,
      recent: [contact && `【最近联系】${contact}`,
        ownerLines.length && `【你和${ownerName()}的最近互动（两小时内节选）】\n${ownerLines.join('\n')}`,
        lines.length && `【其他近期互动（节选）】\n${lines.join('\n')}`].filter(Boolean).join('\n'),
    }
  }

  const deep = createDeepThink({
    getAsk: () => ask, budgetAllow: (kind, tokens) => deps.budget.allow(kind, tokens), memory: deps.memory, emotion: deps.emotion,
    motivation: deps.motivation, body: deps.body, identity: () => deps.identity(), now, tz: () => deps.tz(),
    ownerName, currentContext, parseJson, dayKey, shortTime, factualRules, affectWindow: AFFECT_WINDOW,
    remoteContext: REMOTE_CONTEXT, log,
  })
  const needsDeep = (s, step) => deep.needsDeep(s, step)
  const deepThink = (...a) => deep.deepThink(...a)

  const SYSTEM = () => buildSystem({ name: deps.identity().name || '她', owner: ownerName() })

  function material(s, recalled, current) {
    const b = deps.body.state()
    const e = deps.emotion.state(b)
    const parts = [current.clock, current.recent, deps.body.describe(b), `【心情】${e.mood.label}`]
    const feelings = e.active.filter((x) => x.intensity >= 0.1 && !x.hidden && !['thought', 'deep', 'recall'].includes(x.source) && now() - x.at < AFFECT_WINDOW)
    const lived = [feelings.find((x) => x.def?.v > 0), feelings.find((x) => x.def?.v <= 0)].filter(Boolean)
    if (lived.length) parts.push('【刚经历过的感受】' + lived.map((x) => x.name + (x.why ? '（' + x.why + '）' : '')).join('；'))
    if (recalled.length) parts.push('【想起的往事】\n' + recalled.map((m) => `- ${shortTime(m.at, deps.tz())} ${m.text}`).join('\n'))
    const todo = deps.memory.dueIntentions({ within: 12 * 60 * MIN }).map((x) => x.gist)
    if (todo.length) parts.push('【惦记着要做的】' + todo.join('；'))
    // 管理员的、自己的生日和纪念日：想着想着可能就想去说一声
    const days = (deps.memory.specialDays?.({ within: 3 }) || []).filter((d) => d.owner || d.self)
    if (days.length) parts.push('【日子】' + days.map((d) => d.text).join('；'))
    const ms = deps.motivation.state(b)
    if (ms.wants.length) parts.push(`（你心里有点想${ms.wants.slice(0, 3).map((w) => w.text).join('；')}，但不着急。）`)
    const lastAction = (ms.log || []).find((x) => x.ok && now() - x.at < AFFECT_WINDOW)
    if (lastAction) parts.push(`（你刚做完：${lastAction.label}${lastAction.summary ? `，${String(lastAction.summary).slice(0, 120)}` : ''}。）`)
    const can = deps.motivation.motives({ body: b, mood: e.mood }).filter((m) => m.available).map((m) => m.label)
    if (can.length) parts.push(`（现在能做的：${can.slice(0, 5).join('、')}。）`)
    if (s.boredom >= 0.5) parts.push('（有点无聊了）')
    const last = s.log.filter((x) => !x.repeated && now() - x.at < AFFECT_WINDOW && (x.deep || !x.feel || emotionOf(x.feel.name)?.v >= 0)).slice(0, 1)
      .map((x) => `${shortTime(x.at, deps.tz())} ${x.deep?.thought || x.thought}`)
    if (last.length) parts.push('【前几步在想】\n' + last.join('\n') + '\n（不要重复这几句。可以换个话题。）')
    return parts.filter(Boolean).join('\n')
  }

  /** 硬规则：要不要交给聊天模型深想。 */
  /**
   * 想一步。返回这一步（或 null：发呆、没模型、预算用完）。
   * 有本地小模型就用它；没有时用聊天模型（低思考深度），由外面拉长间隔。
   */
  let thinking = false
  async function step({ canCommit = () => true } = {}) {
    if (thinking || !canCommit()) return null
    thinking = true
    try { return await thinkStep(canCommit) } finally { thinking = false }
  }

  async function thinkStep(canCommit) {
    const s = load()
    const today = dayKey(now(), deps.tz())
    const pending = (s.deferred || []).filter((item) => now() - item.step.at < 7 * 24 * 60 * MIN)
    s.deferred = pending
    const due = pending.filter((item) => item.day !== today).sort((a, b) => b.priority - a.priority || a.step.at - b.step.at)[0]
    if (due && ask && deps.budget.allow('deep', 3000)) {
      const deep = await deepThink(s, due.step, due.reason, canCommit)
      if (!canCommit()) return null
      if (!deep?.deferred) {
        s.deferred = pending.flatMap((item) => item !== due ? [item] : deep || (due.attempts || 0) >= 2
          ? [] : [{ ...due, day: today, attempts: (due.attempts || 0) + 1 }])
        if (deep) {
          const resumed = { ...due.step, at: now(), deep, resumed: true }
          s.log = [resumed, ...s.log].slice(0, 300)
          save(s)
          return resumed
        }
        save(s)
      }
    }
    const initial = currentContext(LOCAL_CONTEXT)
    const cue = initial.cue
    const recalled = cue ? await deps.memory.recall({ cue, limit: 2 }).catch(() => []) : []
    if (!canCommit()) return null
    let out = null
    let current = initial
    let by = 'local'
    if (local) {
      const text = material(s, recalled, current)
      out = await local.chat([{ role: 'system', content: SYSTEM() }, { role: 'user', content: text }], { maxTokens: 160, temperature: 0.95 })
    }
    if (out === null && ask && A('thinkWithoutLocal') !== false && deps.budget.allow('think', 1500)) {
      by = 'model'
      current = currentContext(REMOTE_CONTEXT)
      const text = material(s, recalled, current)
      try { out = await ask({ scene: 'think', system: SYSTEM(), text, maxTokens: 300 }) } catch { out = null }
    }
    if (!out || !canCommit()) return null
    const p = parseThought(out)
    if (!p.thought) return null
    const st = { at: now(), thought: p.thought, feel: p.feel, plan: p.plan, by }
    const evidence = current.evidence.get(p.evidence)
    if (evidence) {
      st.evidence = evidence.id
      st.ownerEvidence = evidence.who === deps.identity().ownerId
    }
    if (st.feel && emotionOf(st.feel.name)?.v < 0) {
      st.rawFeelIntensity = st.feel.intensity
      st.feel = { ...st.feel, intensity: Math.min(st.feel.intensity, evidence ? 0.5 : 0.18) }
    }
    // 重复：和前几步很像 → 停下来放空，无聊感上升
    const repeated = s.log.slice(0, 3).some((x) => overlap(x.thought, p.thought) >= 0.7)
    if (repeated) st.repeated = true
    const routineCorrection = evidence && place(evidence.window).kind === 'group' && ROUTINE_CORRECTION.test(evidence.text)
    if (routineCorrection && st.rawFeelIntensity !== undefined) {
      st.feel.intensity = Math.min(st.feel.intensity, 0.25)
      delete st.rawFeelIntensity
    }
    const reason = repeated || routineCorrection ? '' : needsDeep(s, { ...st, deep: p.deep })
    if (reason) {
      const d = await deepThink(s, st, reason, canCommit)
      if (d?.deferred) {
        const queue = s.deferred || pending
        const priority = reason === '越想越难受' ? 3 : reason === '涉及管理员和你们的关系' ? 2 : 1
        if (!queue.some((item) => overlap(item.step.thought, st.thought) >= 0.7)) {
          s.deferred = [...queue, { day: today, step: st, reason, priority }]
            .sort((a, b) => b.priority - a.priority || a.step.at - b.step.at).slice(0, 50)
        }
      } else if (d) st.deep = d
    }
    if (!canCommit()) return null
    s.boredom = clamp(load().boredom + (repeated ? 0.25 : -0.05))
    // 只留感受和打算；念头本身只进内心日记，不进记忆
    if (st.feel && !repeated && !st.deep?.reappraised) {
      const recent = s.log.filter((x) => !x.repeated && st.at - x.at < AFFECT_WINDOW)
      const negative = emotionOf(st.feel.name)?.v < 0
      const alreadyFelt = negative && recent.some((x) => evidence
        ? x.evidence === st.evidence
        : !x.evidence && emotionOf(x.feel?.name)?.v < 0)
      if (!alreadyFelt) deps.emotion.feel([{ name: st.feel.name, intensity: st.feel.intensity * 0.7, why: '想着想着', importance: 0.3 }], { source: 'thought' })
    }
    if (p.plan && !repeated) deps.motivation.want(p.plan, { strength: 0.4, internal: true })
    s.log.unshift(st)
    s.log = s.log.slice(0, 300)
    save(s)
    return st
  }

  /** 无聊感：闲得越久越高（每小时 +0.15，经验值），做了事、聊了天就降。 */
  function idleTick(minutes) {
    const s = load()
    s.boredom = clamp(s.boredom + 0.15 * minutes / 60)
    save(s)
    return s.boredom
  }
  function relieve(amount = 0.5) {
    const s = load()
    s.boredom = clamp(s.boredom - amount)
    save(s)
  }
  function diary(limit = 50) { return load().log.slice(0, limit) }
  function clearDeferred() {
    const s = load()
    s.deferred = []
    save(s)
  }
  function deferredCount() { return (load().deferred || []).length }
  function boredom() { return load().boredom }
  /** 聊天时自然提起「我刚才还在想……」：最近 30 分钟里最后一个念头。 */
  function lastThought() {
    const x = load().log[0]
    return x && now() - x.at < 30 * MIN && !x.repeated ? x : null
  }

  return { connect, step, idleTick, relieve, diary, boredom, lastThought, clearDeferred, deferredCount, parseThought }
}
