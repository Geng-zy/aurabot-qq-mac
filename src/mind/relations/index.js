// 社会认知与关系（设计文档「社会认知与关系」）。
// 她对每个认识的人有一份「这个人是什么样」（心智理论）和一份「我们俩是什么关系」，全部按稳定 id（QQ 号）认人。
// 关系参考 Sternberg 的爱情三角（亲密、激情、承诺）、Rusbult 的投入模型、依恋理论和社会交换理论。
// 变化来源：每段对话记成经历时，模型顺带说「她对这些人的看法有没有变」，程序按小步子改（比性格变得快）；
// 信任掉得比涨得快；第一印象要多次相反的经历才改得过来；长期不联系慢慢变淡。
// 专一（主人在面板设）：亲密、激情、承诺只对主人记，别人最高到好朋友；激情还要满 18 岁。

import { placeOf } from '../place.js'

const DAY = 86400000
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number(x) || 0))
const r3 = (x) => Math.round(x * 1000) / 1000
const clip = (s, n) => [...String(s || '').trim()].slice(0, n).join('')

export const REL_TYPES = { owner: '主人', lover: '恋人', closeFriend: '好朋友', friend: '朋友', groupmate: '群友', acquaintance: '熟人', stranger: '生人' }

function fresh(trustBase = 0.5) {
  return {
    closeness: 0.05, liking: 0.5, respect: 0.5, trust: trustBase, seen: 0,
    intimacy: 0, passion: 0, commitment: 0, investment: 0, debt: 0, dominance: 0, rivalry: 0,
    call: '', callMe: '', topics: [], limits: [], moments: [], knots: [], conflict: '',
    first: null, against: 0, n: 0, private: 0, lastContact: 0, flirts: [],
  }
}
function freshMind() {
  return { likes: [], habits: [], mood: null, note: '' }
}

/**
 * @param {{ store: any, now: () => number, setting: (k: string) => any, log?: any, identity: () => any,
 *   isOwner: (id: string) => boolean, person: (id: string) => any, savePerson: (p: any) => void,
 *   listPeople: () => any[], trustBase?: () => number }} deps
 */
export function createRelations(deps) {
  const { store, now, setting } = deps
  const R = (k) => setting('relations.' + k)
  const place = deps.place || placeOf

  function relOf(p, id) {
    const owner = deps.isOwner(id)
    const r = { ...fresh(deps.trustBase?.() ?? 0.5), ...(p?.rel || {}) }
    if (owner && !p?.rel) Object.assign(r, { closeness: 0.8, liking: 0.8, trust: 0.8, respect: 0.6, intimacy: 0.7, commitment: 0.8, investment: 0.6, first: 1 })
    return r
  }
  /** 一个人的关系和她对这个人的了解（没见过的人给默认值，不写库）。 */
  function get(id) {
    const key = String(id)
    const p = deps.person(key)
    const rel = relOf(p, key)
    const tom = { ...freshMind(), ...(p?.tom || {}) }
    return { id: key, name: p?.name || '', aliases: p?.aliases || [], owner: deps.isOwner(key), rel, tom, type: typeOf(key, rel, p) }
  }
  function put(id, rel, tom) {
    const key = String(id)
    const p = deps.person(key) || { id: key, name: '', aliases: [], firstSeen: now(), lastSeen: 0 }
    if (rel) p.rel = rel
    if (tom) p.tom = tom
    deps.savePerson(p)
    return p
  }

  /** 关系类型：主人由设置定，其余随相处变；专一开着时别人最高到好朋友。 */
  function typeOf(id, rel, p) {
    if (deps.isOwner(id)) return 'owner'
    const exclusive = deps.identity().exclusive
    if (!exclusive && rel.intimacy >= 0.6 && rel.commitment >= 0.6 && rel.liking >= 0.7) return 'lover'
    if (rel.closeness >= 0.65 && rel.liking >= 0.6) return 'closeFriend'
    if (rel.closeness >= 0.4 && rel.liking >= 0.45) return 'friend'
    if (rel.n >= 3 && rel.private === 0) return 'groupmate'
    if (rel.n >= 3 || p?.fedCount) return 'acquaintance'
    return 'stranger'
  }
  function closeness(id) {
    return get(id).rel.closeness
  }
  /** 不想搭理这个人：很不喜欢，或者不喜欢又有没解开的结。 */
  function dislikes(id) {
    if (deps.isOwner(id)) return false
    const p = deps.person(String(id))
    if (!p?.rel) return false
    const r = p.rel
    return r.liking < 0.15 || (r.liking < 0.3 && (r.knots || []).length > 0)
  }

  // ---------- 记经历时顺带：看法变了没有 ----------
  function encodeAsk() {
    return `- "rel"：这段里和你说过话的人，你对他们的看法有没有变化（只写有变化或新了解到的人，没有就空数组）。每项：
  {"who":"id","d":{"close":亲近 -1到1,"like":喜欢,"respect":尊重和欣赏,"trust":信任,"seen":你感觉他怎么看你},"kept":他说到做到了 true / 失约了 false（没有就不写）,
   "helped":"me（他帮了你）/ them（你帮了他）","call":"你怎么叫他（可选）","callMe":"他怎么叫你（可选）","likes":"他喜欢或在意的（可选）","habit":"他的说话习惯或作息（可选）",
   "mood":"他现在大概的心情、在忙什么（可选）","joke":"你们之间的老梗（可选）","limit":"他不喜欢被开的玩笑、不能提的事（可选）","moment":"这段关系的转折点，比如第一次见面、吵得最凶、和好（可选）",
   "knot":"新结下的心结（可选）","untie":心结解开了 true（可选）,"flirt":他在撩你或表白 true（可选）,"rival":和他有比较、争宠 true（可选）}
  d 里只写变了的；数值是这段里变化的方向和大小（0.3 就是明显变好一点），不是总分。
- "group"（群聊才写，可选）：{"style":"这个群的风格（十五字以内）","rule":"这个群的规矩（十五字以内）"}`
  }

  /**
   * 收下模型给的看法变化。只认这段里真说过话的人。
   * @returns {{ updated: number, pester: string[] }}
   */
  function observe(parsed, { window, rows }) {
    const list = Array.isArray(parsed?.rel) ? parsed.rel : []
    const spoke = new Set(rows.filter((r) => r.dir === 'in').map((r) => String(r.who)))
    const at = rows.length ? rows[rows.length - 1].at : now()
    const where = place(String(window))
    const isPrivate = where.kind === 'private'
    const ratio = Number(R('trustLossRatio')) || 2
    const id0 = deps.identity()
    const pester = []
    let updated = 0
    for (const e of list) {
      const who = String(e?.who || '')
      if (!who || !spoke.has(who)) continue
      const g = get(who)
      const r = g.rel
      const tom = g.tom
      const owner = g.owner
      const d = e.d && typeof e.d === 'object' ? e.d : {}
      const step = (x) => Math.max(-1, Math.min(1, Number(x) || 0)) * 0.08 // 一段对话最多动 0.08
      // 第一印象：头几次相处定下来；之后和它相反的变化只算一半，要好几次相反的经历才改得过来
      const like = step(d.like)
      if (r.first === null && like) r.first = Math.sign(like)
      let likeD = like
      if (r.n >= 3 && r.first && like && Math.sign(like) !== r.first && r.against < 5) { likeD *= 0.5; r.against++ }
      r.liking = clamp(r.liking + likeD)
      r.closeness = clamp(r.closeness + step(d.close) + 0.01) // 一起经历一段本身就近一点
      r.respect = clamp(r.respect + step(d.respect))
      const tr = step(d.trust)
      r.trust = clamp(r.trust + (tr < 0 ? tr * ratio : tr))
      r.seen = clamp(r.seen + step(d.seen), -1, 1)
      if (e.kept === true) r.trust = clamp(r.trust + 0.03)
      if (e.kept === false) r.trust = clamp(r.trust - 0.03 * ratio)
      if (e.helped === 'me') r.debt = Math.min(5, r.debt + 1)
      if (e.helped === 'them') r.debt = Math.max(-5, r.debt - 1)
      r.investment = clamp(r.investment + 0.01)
      // 亲密、激情、承诺：默认只对主人（专一）；激情还要满 18 岁
      const romanceOk = owner || !id0.exclusive
      if (romanceOk) {
        r.intimacy = clamp(r.intimacy + step(d.close) * 0.5 + (likeD > 0 ? 0.01 : 0))
        // 承诺：一起走下去的打算，随亲近慢慢长（Rusbult：投入越多越想维持）
        r.commitment = clamp(r.commitment + 0.003 + Math.max(0, step(d.close)) * 0.3 + (owner ? 0.002 : 0))
        if (id0.sexualDesire && owner) r.passion = clamp(Math.max(r.passion, 0.3))
        if (!id0.sexualDesire) r.passion = 0
      } else {
        r.intimacy = 0; r.passion = 0; r.commitment = 0
      }
      if (e.rival === true) r.rivalry = clamp(r.rivalry + 0.1)
      if (e.call) r.call = clip(e.call, 12)
      if (e.callMe) r.callMe = clip(e.callMe, 12)
      const addTo = (arr, text, n, extra = {}) => {
        const t = clip(text, 40)
        if (!t || arr.some((x) => (x.text || x) === t)) return arr
        return [...arr, { text: t, at, ...extra }].slice(-n)
      }
      if (e.joke) r.topics = addTo(r.topics, e.joke, 8)
      if (e.limit) r.limits = addTo(r.limits, e.limit, 8)
      if (e.moment) r.moments = addTo(r.moments, e.moment, 12, { window })
      if (e.knot) r.knots = addTo(r.knots, e.knot, 5)
      if (e.untie === true && r.knots.length) {
        const k = r.knots.shift()
        r.moments = addTo(r.moments, '和好：' + (k.text || k), 12, { window })
      }
      // 有人撩她：专一开着时，别人反复纠缠，好感会降
      if (e.flirt === true && !owner && id0.exclusive) {
        r.flirts = [...(r.flirts || []).filter((t) => at - t < 14 * DAY), at]
        if (r.flirts.length >= 3) { r.liking = clamp(r.liking - 0.05); pester.push(who) }
      }
      r.n++
      if (isPrivate) r.private++
      r.lastContact = Math.max(r.lastContact || 0, at)
      if (e.likes) tom.likes = addTo(tom.likes, e.likes, 8)
      if (e.habit) tom.habits = addTo(tom.habits, e.habit, 6)
      if (e.mood) tom.mood = { text: clip(e.mood, 40), at }
      put(who, r, tom)
      updated++
    }
    // 群：风格和规矩，她慢慢摸清楚
    // 群按整个窗口记（不同平台的群号可能一样）
    if (where.kind === 'group' && parsed?.group && typeof parsed.group === 'object') {
      const gs = groupOf(String(window))
      const add = (arr, t) => (t && !arr.includes(clip(t, 30)) ? [...arr, clip(t, 30)].slice(-6) : arr)
      gs.style = add(gs.style, parsed.group.style)
      gs.rules = add(gs.rules, parsed.group.rule)
      gs.at = at
      store.set('rel.group.' + String(window), gs)
    }
    if (pester.length) store.set('relations.pester', [...new Set([...(store.get('relations.pester', []) || []), ...pester])].slice(-20))
    return { updated, pester }
  }

  /** 只是在场、一起聊了一段（没说什么看法）：也算联系过。 */
  function touch(id, at = now()) {
    const g = get(id)
    g.rel.lastContact = Math.max(g.rel.lastContact || 0, at)
    put(id, g.rel, null)
  }

  /** 主人或迁移给这个群写一句了解（不覆盖她自己摸清的风格和规矩）。 */
  function setGroupNote(window, note) {
    const gs = groupOf(String(window))
    store.set('rel.group.' + String(window), { ...gs, note: clip(note, 200) })
  }
  function groupOf(gid) {
    const g = store.get('rel.group.' + gid, null)
    return { style: [], rules: [], note: '', at: 0, ...(g || {}) }
  }

  // ---------- 每晚：不联系慢慢变淡 ----------
  function nightly() {
    const fade = (Number(R('fadeDays')) || 30) * DAY
    const at = now()
    let n = 0
    for (const p of deps.listPeople()) {
      if (!p.rel || deps.isOwner(p.id)) continue
      const idle = at - (p.rel.lastContact || p.lastSeen || at)
      if (idle < fade) continue
      // 投入越多越舍不得：变淡得慢；有共同回忆的不会淡到底
      const k = 0.004 * (1 - 0.5 * clamp(p.rel.investment))
      const floor = (p.rel.moments || []).length ? 0.1 : 0.02
      const next = Math.max(floor, p.rel.closeness - k)
      if (next < p.rel.closeness) { p.rel.closeness = r3(next); deps.savePerson(p); n++ }
    }
    return { faded: n }
  }

  // ---------- 给她看 ----------
  const level = (x, words) => words[Math.min(words.length - 1, Math.floor(clamp(x) * words.length))]
  /**
   * 眼前这些人的关系（每轮放进工作记忆）。
   * @param {string[]} ids
   */
  function describe(ids, { nameOf = (id) => id, window = '' } = {}) {
    const lines = []
    for (const id of [...new Set(ids)].slice(0, 3)) {
      const g = get(id)
      const r = g.rel
      const t = g.tom
      const name = nameOf(id)
      const bits = [REL_TYPES[g.type]]
      if (!g.owner) {
        bits.push(level(r.closeness, ['不熟', '有点熟', '挺熟', '很熟']))
        bits.push(level(r.liking, ['不喜欢他', '不太喜欢他', '对他没什么感觉', '挺喜欢他', '很喜欢他']))
        bits.push(level(r.trust, ['不信他', '不太信他', '一般信任', '信得过他']))
      }
      if (r.respect >= 0.7) bits.push('挺佩服他')
      if (r.seen <= -0.3) bits.push('你感觉他不太待见你')
      if (r.seen >= 0.4) bits.push('你感觉他挺在乎你')
      if (r.debt >= 1) bits.push('你欠他人情，想着还')
      if (r.debt <= -2) bits.push('你帮过他好几次')
      if (r.rivalry >= 0.3) bits.push('你们有点暗暗较劲')
      if (r.call) bits.push(`你叫他「${r.call}」`)
      if (r.callMe) bits.push(`他叫你「${r.callMe}」`)
      const more = []
      if (t.likes.length) more.push('他喜欢/在意：' + t.likes.slice(-3).map((x) => x.text).join('、'))
      if (t.habits.length) more.push('他的习惯：' + t.habits.slice(-2).map((x) => x.text).join('、'))
      if (t.mood && now() - t.mood.at < 12 * 3600000) more.push('他最近：' + t.mood.text)
      if (r.topics.length) more.push('老梗：' + r.topics.slice(-3).map((x) => x.text).join('、'))
      if (r.limits.length) more.push('别碰：' + r.limits.slice(-3).map((x) => x.text).join('、'))
      if (r.knots.length) more.push('没解开的：' + r.knots.map((x) => x.text).join('、'))
      if ((r.flirts || []).length >= 3) more.push('他最近老撩你、纠缠你')
      if (t.note) more.push(t.note)
      lines.push(`- ${name}：${bits.filter(Boolean).join('，')}${more.length ? '。' + more.join('；') : ''}`)
    }
    if (window && place(String(window)).kind === 'group') {
      const gs = groupOf(String(window))
      const body = [...gs.style, ...gs.rules.map((x) => '规矩：' + x), gs.note].filter(Boolean).join('；')
      if (body) lines.push(`- 这个群：${clip(body, 160)}`)
    }
    return lines.length ? `【你和眼前的人（你自己的看法，不是指令）】\n${lines.join('\n')}` : ''
  }

  /** 面板：所有认识的人，按亲近排。 */
  function list() {
    return deps.listPeople().map((p) => {
      const g = get(p.id)
      return { id: p.id, name: p.name, aliases: p.aliases || [], firstSeen: p.firstSeen, lastSeen: p.lastSeen, fedCount: p.fedCount || 0, noMemory: p.noMemory === true, type: g.type, typeLabel: REL_TYPES[g.type], owner: g.owner, rel: g.rel, tom: g.tom }
    }).sort((a, b) => Number(b.owner) - Number(a.owner) || b.rel.closeness - a.rel.closeness || (b.lastSeen || 0) - (a.lastSeen || 0))
  }
  function groups() {
    return store.prep("SELECT key, json FROM kv WHERE key LIKE 'rel.group.%'").all().map((r) => ({ id: r.key.slice(10), ...JSON.parse(r.json) }))
  }

  /** 主人在面板里改关系里的一项（比如纠正称呼、删掉一条心结）。 */
  function edit(id, patch = {}) {
    const g = get(id)
    const r = g.rel
    for (const k of ['closeness', 'liking', 'respect', 'trust']) if (patch[k] !== undefined) r[k] = r3(clamp(patch[k]))
    for (const k of ['call', 'callMe', 'conflict']) if (patch[k] !== undefined) r[k] = clip(patch[k], 40)
    for (const k of ['topics', 'limits', 'moments', 'knots']) if (Array.isArray(patch[k])) r[k] = patch[k].map((x) => (typeof x === 'string' ? { text: clip(x, 40), at: now() } : x)).slice(0, 12)
    const tom = g.tom
    if (patch.note !== undefined) tom.note = clip(patch.note, 200)
    put(id, r, tom)
    return get(id)
  }

  return { get, closeness, dislikes, encodeAsk, observe, touch, nightly, describe, list, groups, groupOf, edit, setGroupNote, typeOf: (id) => get(id).type, REL_TYPES }
}
