// 动机：她想要什么、做还是不做、从结果里学。
// 两层「想要」：16 项基本需要（清单固定，强弱是她自己的、会变）；具体想要的东西（没有上限，由她自己长出来）。
// 做还是不做用时间动机理论（Steel 2007）的结构：动力 ≈ 觉得能做成 × 做成了有多想要 ÷（1 + 容易分心 × 要等多久）；
// 再叠加有多费力、精力和心情。犯懒是从这里自然出现的，不是开关。
// 从结果里学：结果比预想好，下次更想做；差就没那么想了（奖励预测误差，Rescorla–Wagner 形式的更新）。

const HOUR = 3600000
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number(x) || 0))

/**
 * 16 项基本需要：综合自我决定理论（Deci & Ryan）、Reiss 的 16 种基本欲望、信息缺口理论（Loewenstein 1994）和生理需要。
 * rise：没被满足时每小时涨多少（经验值；陪伴约一整天没人理就涨满）。
 */
export const NEEDS = [
  { id: 'companion', name: '陪伴和归属', rise: 0.04 },
  { id: 'intimacy', name: '亲密和爱', rise: 0.02 },
  { id: 'safety', name: '安全感', rise: 0 },
  { id: 'autonomy', name: '自主', rise: 0 },
  { id: 'competence', name: '能力感', rise: 0.01 },
  { id: 'recognition', name: '被认可', rise: 0.01 },
  { id: 'curiosity', name: '好奇', rise: 0.03 },
  { id: 'fun', name: '新鲜和乐趣', rise: 0.08 },
  { id: 'beauty', name: '美', rise: 0.01 },
  { id: 'order', name: '秩序和掌控感', rise: 0 },
  { id: 'fairness', name: '公平和对错', rise: 0 },
  { id: 'care', name: '照顾别人', rise: 0.01 },
  { id: 'collect', name: '收集和存东西', rise: 0.005 },
  { id: 'rest', name: '安静和休息', rise: 0 },
  { id: 'body', name: '身体', rise: 0 },
  { id: 'meaning', name: '意义', rise: 0.003 },
]
const NEED = new Map(NEEDS.map((n) => [n.id, n]))

/**
 * 每项需要有多强，由性格定（0.5 = 一般人）：爱社交、依恋焦虑高的更需要陪伴，好奇的更想知道新东西……
 * 对应关系参考大五细分项和依恋维度的含义；权重是经验值。性格慢慢变，需要的强弱也跟着变。
 */
export const NEED_FROM_TRAITS = {
  companion: { sociability: 0.5, attachAnxiety: 0.3, attachAvoidance: -0.2 },
  intimacy: { attachAvoidance: -0.6, attachAnxiety: 0.4 },
  safety: { anxiety: 0.5, attachAnxiety: 0.5 },
  autonomy: { assertiveness: 1 },
  competence: { productiveness: 1 },
  recognition: { attachAnxiety: 0.5, honesty: -0.5 },
  curiosity: { curiosity: 1 },
  fun: { energy: 0.5, imagination: 0.5 },
  beauty: { aesthetic: 1 },
  order: { organization: 1 },
  fairness: { honesty: 0.5, respect: 0.5 },
  care: { compassion: 1 },
  rest: { energy: -1 },
  meaning: { imagination: 0.5, responsibility: 0.5 },
}
/** 按性格算需要的强弱（负权重表示「越低越需要」）。 */
export function needStrengths(trait) {
  const out = {}
  for (const n of NEEDS) {
    const w = NEED_FROM_TRAITS[n.id]
    if (!w) { out[n.id] = 0.5; continue }
    let v = 0
    let sum = 0
    for (const [t, k] of Object.entries(w)) {
      const x = Math.min(1, Math.max(0, Number(trait(t) ?? 0.5)))
      v += Math.abs(k) * (k >= 0 ? x : 1 - x)
      sum += Math.abs(k)
    }
    out[n.id] = Math.round((sum ? v / sum : 0.5) * 1000) / 1000
  }
  return out
}

/**
 * @param {{ store: any, now: () => number, setting: (k: string) => any, log?: any }} deps
 */
export function createMotivation(deps) {
  const { store, now, setting } = deps
  const M = (k) => setting('motivation.' + k)
  const actions = new Map() // id → 动作定义（模块和对接层登记，不进库）

  function load() {
    const s = store.get('motivation', null)
    if (s && s.needs) return s
    const at = now()
    return { at, needs: Object.fromEntries(NEEDS.map((n) => [n.id, { strength: 0.5, deficit: 0.3 }])), wants: [], learned: {}, log: [] }
  }
  function save(s) { store.set('motivation', s) }
  // 第一次有动机：从现在开始算
  if (!store.get('motivation', null)) save(load())

  /** 时间推进：没被满足的需要慢慢涨；身体和休息的需要直接看身体。 */
  function advance(s, body) {
    const at = now()
    const h = Math.max(0, at - (s.at || at)) / HOUR
    let strong = null
    try { strong = deps.trait ? needStrengths(deps.trait) : null } catch {}
    for (const n of NEEDS) {
      const x = s.needs[n.id] || (s.needs[n.id] = { strength: 0.5, deficit: 0.3 })
      if (strong) x.strength = strong[n.id]
      // 越需要的缺得越快（强弱 0.5 时按原来的速度）
      if (n.rise) x.deficit = clamp(x.deficit + n.rise * h * (0.5 + x.strength))
    }
    if (body) {
      s.needs.rest.deficit = clamp(1 - (body.energy ?? 1))
      s.needs.body.deficit = clamp(Math.max(body.hunger || 0, Math.max(0, ((body.sleepiness || 0) - 0.4) / 0.6)))
    }
    // 具体想要的：一周没动静就慢慢淡了（经验值）
    s.wants = s.wants.map((w) => ({ ...w, strength: w.strength * Math.pow(0.5, h / (7 * 24)) })).filter((w) => w.strength >= 0.05 && w.status === 'open')
    s.at = at
    return s
  }

  /** 某项需要被满足了一些（聊天、做了喜欢的事……）。 */
  function satisfy(id, amount) {
    const s = advance(load())
    if (s.needs[id]) s.needs[id].deficit = clamp(s.needs[id].deficit - amount)
    save(s)
  }

  /** 她长出一个具体的想要（从念头、经历里来，或者她自己写下）。很像的旧想要会加强而不是重复。 */
  function want(text, { need = '', strength = 0.5, action = '' } = {}) {
    const t = String(text || '').trim().slice(0, 80)
    if (!t) return null
    const s = advance(load())
    const same = s.wants.find((w) => w.text === t || (w.text.length > 4 && (t.includes(w.text) || w.text.includes(t))))
    if (same) { same.strength = clamp(same.strength + strength * 0.5); save(s); return same }
    const w = { id: 'w' + now().toString(36) + Math.floor(Math.random() * 1e4), text: t, need: NEED.has(need) ? need : '', action: String(action || ''), strength: clamp(strength), at: now(), status: 'open' }
    s.wants.unshift(w)
    s.wants = s.wants.slice(0, 50)
    save(s)
    return w
  }
  function closeWant(id, status = 'done') {
    const s = load()
    const w = s.wants.find((x) => x.id === id)
    if (w) w.status = status
    s.wants = s.wants.filter((x) => x.status === 'open')
    save(s)
    return Boolean(w)
  }

  /**
   * 登记一件她能做的事。模块用它把自己的能力交给她，由她决定什么时候做。
   * @param {{ id: string, label: string, needs: Record<string, number>, effort?: number, delayHours?: number,
   *   cooldownMinutes?: number, payoff?: number, keywords?: string[], available?: () => (true|string|false),
   *   run: () => Promise<{ ok: boolean, summary?: string, outcome?: number }> }} a
   */
  function offer(a) {
    if (!a || !a.id || typeof a.run !== 'function') throw new Error('动作要有 id 和 run')
    actions.set(a.id, { effort: 0.2, delayHours: 0.05, cooldownMinutes: 60, payoff: 0.6, keywords: [], needs: {}, ...a })
    return () => actions.delete(a.id)
  }

  /**
   * 每件事此刻的动力。
   * @param {{ body?: any, mood?: { v: number }, boredom?: number }} st
   */
  function motives(st = {}) {
    const s = advance(load(), st.body)
    save(s)
    const at = now()
    const energy = st.body?.energy ?? 1
    const valence = st.mood?.v ?? 0
    const gamma = (Number(M('distractibility')) || 1) * (Number(deps.distractScale?.()) || 1)
    const out = []
    for (const a of actions.values()) {
      let avail = true
      try { avail = a.available ? a.available() : true } catch { avail = false }
      const L = s.learned[a.id] || { expect: a.payoff, success: 0.8, runs: 0, lastAt: 0 }
      const cooling = L.lastAt && at - L.lastAt < a.cooldownMinutes * 60000
      let value = 0
      for (const [id, w] of Object.entries(a.needs || {})) {
        const n = s.needs[id]
        // 无聊（内心活动里攒的）也算「新鲜和乐趣」缺着
        const deficit = id === 'fun' ? Math.max(n?.deficit || 0, Number(st.boredom) || 0) : n?.deficit || 0
        if (n) value += deficit * (0.5 + n.strength) * w
      }
      const wants = s.wants.filter((w) => w.action === a.id || (a.keywords || []).some((k) => w.text.includes(k)))
      value += wants.reduce((x, w) => x + w.strength, 0)
      value *= 0.5 + L.expect // 以前做这件事有多开心（预想的满意度 0.5 时不加不减）
      let m = (L.success * value) / (1 + gamma * a.delayHours)
      m = m * (0.3 + 0.7 * energy) - a.effort * (1 - energy) * 0.5
      m *= 1 + 0.3 * valence
      out.push({ id: a.id, label: a.label, motive: Math.max(0, m), available: avail === true, why: avail === true ? (cooling ? '刚做过' : '') : (typeof avail === 'string' ? avail : '现在做不了'), cooling, wants: wants.map((w) => w.text) })
    }
    return out.sort((x, y) => y.motive - x.motive)
  }

  /** 挑一件去做：能做、不在冷却、动力最大而且过了门槛的那件；都不够就犯懒（返回 null）。 */
  function choose(st) {
    const th = Number(M('actThreshold')) || 0.5
    return motives(st).find((m) => m.available && !m.cooling && m.motive >= th) || null
  }

  /** 去做；做完按结果学。 */
  async function act(id) {
    const a = actions.get(id)
    if (!a) return { ok: false, summary: '没有这件事' }
    const s0 = load()
    const L = s0.learned[id] || { expect: a.payoff, success: 0.8, runs: 0, lastAt: 0 }
    L.lastAt = now()
    s0.learned[id] = L
    save(s0)
    let r
    try { r = (await a.run()) || { ok: false } } catch (error) { r = { ok: false, summary: error.message } }
    const lr = Number(M('rewardLearning')) || 0
    const s = load()
    const l = s.learned[id] || L
    const outcome = r.ok ? clamp(r.outcome ?? 0.6) : 0
    l.expect = clamp(l.expect + lr * (outcome - l.expect), 0.05, 1)
    l.success = clamp(l.success + lr * ((r.ok ? 1 : 0) - l.success), 0.05, 1)
    l.runs = (l.runs || 0) + 1
    s.learned[id] = l
    if (r.ok) for (const [need, w] of Object.entries(a.needs || {})) if (s.needs[need]) s.needs[need].deficit = clamp(s.needs[need].deficit - 0.5 * w * outcome)
    for (const w of s.wants) if (w.action === id || (a.keywords || []).some((k) => w.text.includes(k))) w.status = r.ok ? 'done' : w.status
    s.wants = s.wants.filter((w) => w.status === 'open')
    s.log.unshift({ at: now(), id, label: a.label, ok: Boolean(r.ok), summary: String(r.summary || '').slice(0, 120), outcome })
    s.log = s.log.slice(0, 100)
    save(s)
    return r
  }

  /** 结果要过一阵才知道（比如主动找你之后你回没回）：按真实结果再学一次。 */
  function feedback(id, outcome) {
    const lr = Number(M('rewardLearning')) || 0
    const s = load()
    const l = s.learned[id]
    if (!l) return
    l.expect = clamp(l.expect + lr * (clamp(outcome) - l.expect), 0.05, 1)
    save(s)
  }

  function state(body) {
    const s = advance(load(), body)
    save(s)
    return {
      needs: NEEDS.map((n) => ({ id: n.id, name: n.name, ...s.needs[n.id] })),
      wants: s.wants,
      learned: s.learned,
      log: s.log.slice(0, 30),
      actions: [...actions.values()].map((a) => ({ id: a.id, label: a.label })),
    }
  }

  return { offer, motives, choose, act, feedback, satisfy, want, closeWant, state, NEEDS }
}
