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
function matchesWant(action, want) {
  const target = explicitAction(want)
  return target ? target === action.id : action.matchWant ? action.matchWant(want.text) : (action.keywords || []).some((keyword) => want.text.includes(keyword))
}
const availability = (action) => {
  try { return action.available ? action.available() : true } catch { return false }
}
const retryDelay = (action, result) => {
  try { return result?.ok === false ? Math.max(0, Number(action.retryMinutes?.(result)) || 0) * 60000 : 0 } catch { return 0 }
}

export function hasActionPhrase(text, pattern) {
  return String(text || '').split(/[，、；。！？\n]/u).some((clause) => {
    const match = clause.match(pattern)
    return match && !/(?:不|别|没|算了|放弃|要不要).{0,6}$/u.test(clause.slice(0, match.index))
  })
}

export const wantsMeal = (text) => hasActionPhrase(text, /点.{0,8}外卖|吃(?:饭|点东西|点吃的|些东西|一顿)|找点吃的|填饱肚子|去吃|给自己弄点吃的/u)
export const wantsOwnerChat = (text) => hasActionPhrase(text, /(?:去|想|主动)?找(?:管理员|他|你)(?![画唱买做])|(?:跟|和|对)(?:管理员|他|你)(?:说|聊)|(?:私聊|联系|问候)(?:管理员|他|你)|给管理员发(?:消息|一句话)/u)

function explicitAction(want) {
  // 旧版见到「管理员」就填 reach_owner。只有能核对出联系意图的旧条目保留指定动作。
  if (want.action === 'reach_owner' && !wantsOwnerChat(want.text)) return ''
  return want.action || ''
}

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
 * @param {{ store: any, now: () => number, setting: (k: string) => any, log?: any, budget?: any }} deps
 */
export function createMotivation(deps) {
  const { store, now, setting } = deps
  const random = deps.random || Math.random
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
  function want(text, { need = '', strength = 0.5, action = '', internal = false } = {}) {
    const t = String(text || '').trim().slice(0, 80)
    if (!t) return null
    const s = advance(load())
    const same = s.wants.find((w) => Boolean(w.internal) === internal && explicitAction(w) === explicitAction({ text: t, action })
      && (w.text === t || (w.text.length > 4 && (t.includes(w.text) || w.text.includes(t)))))
    if (same) { same.strength = clamp(same.strength + strength * 0.5); save(s); return same }
    const w = { id: 'w' + now().toString(36) + Math.floor(Math.random() * 1e4), text: t, need: NEED.has(need) ? need : '', action: String(action || ''), strength: clamp(strength), at: now(), status: 'open' }
    if (internal) w.internal = true
    s.wants.unshift(w)
    s.wants = s.wants.slice(0, 100)
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

  function satisfyWants(id, at = now()) {
    const a = actions.get(id)
    if (!a) return
    const s = load()
    const remaining = s.wants.filter((w) => w.at > at || !matchesWant(a, w))
    if (remaining.length !== s.wants.length) save({ ...s, wants: remaining })
  }

  /**
   * 登记一件她能做的事。模块用它把自己的能力交给她，由她决定什么时候做。
   * @param {{ id: string, label: string, needs: Record<string, number>, effort?: number, delayHours?: number,
   *   cooldownMinutes?: number, retryMinutes?: (result: { ok: boolean, summary?: string }) => number,
   *   payoff?: number, keywords?: string[], matchWant?: (text: string) => boolean, available?: () => (true|string|false),
   *   run: () => Promise<{ ok: boolean, summary?: string, outcome?: number }> }} a
   */
  function offer(a) {
    if (!a || !a.id || typeof a.run !== 'function') throw new Error('动作要有 id 和 run')
    actions.set(a.id, { effort: 0.2, delayHours: 0.05, cooldownMinutes: 60, payoff: 0.6, keywords: [], needs: {}, record: true, ...a })
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
      const avail = availability(a)
      const L = s.learned[a.id] || { expect: a.payoff, success: 0.8, runs: 0, lastAt: 0 }
      const waitingForBudget = Boolean(L.budgetDay && L.budgetDay === deps.today?.() &&
        (!L.budgetEstimate || !deps.budget?.allow('action', L.budgetEstimate)))
      // 行动日志也能识别升级前未实际开始的尝试。
      const lastResult = L.retryAt === undefined && a.retryMinutes && s.log.find((entry) => entry.id === a.id && entry.at >= L.lastAt)
      const delay = retryDelay(a, lastResult)
      const retryAt = L.retryAt ?? (delay ? lastResult.at + delay : 0)
      const cooling = waitingForBudget || (retryAt ? at < retryAt : Boolean(L.lastAt && at - L.lastAt < a.cooldownMinutes * 60000))
      let value = 0
      for (const [id, w] of Object.entries(a.needs || {})) {
        const n = s.needs[id]
        // 无聊（内心活动里攒的）也算「新鲜和乐趣」缺着
        const deficit = id === 'fun' ? Math.max(n?.deficit || 0, Number(st.boredom) || 0) : n?.deficit || 0
        if (n) value += deficit * (0.5 + n.strength) * w
      }
      const wants = s.wants.filter((w) => matchesWant(a, w))
      value += wants.reduce((x, w) => x + w.strength, 0)
      value *= 0.5 + L.expect // 以前做这件事有多开心（预想的满意度 0.5 时不加不减）
      let m = (L.success * value) / (1 + gamma * a.delayHours)
      m = m * (0.3 + 0.7 * energy) - a.effort * (1 - energy) * 0.5
      m *= 1 + 0.3 * valence
      const reason = L.budgetEstimate ? '等待后台模型预算' : '等待次日的后台模型预算'
      const why = avail === true ? (waitingForBudget ? reason : cooling ? (retryAt ? '上次未开始，稍后再试' : '刚做过') : '') : (typeof avail === 'string' ? avail : '现在做不了')
      out.push({ id: a.id, label: a.label, motive: Math.max(0, m), available: avail === true, why, cooling, wants: wants.map((w) => w.text), wantIds: wants.map((w) => w.id) })
    }
    return out.sort((x, y) => y.motive - x.motive)
  }

  /**
   * 挑一件去做：能做、不在冷却、动力过了门槛。
   * 默认取动力最高的一件；soft=true 时在几件够想做的事之间按动力加权摇摆，
   * 让「临时改主意 / 再躺一会儿」自然出现，而不是永远执行最高分。
   */
  function choose(st, { soft = false } = {}) {
    const th = Number(M('actThreshold')) || 0.5
    const pool = motives(st).filter((m) => m.available && !m.cooling && m.motive >= th)
    if (!pool.length) return null
    const temperature = clamp(M('pickTemperature'), 0, 1)
    if (!soft || temperature <= 0) return pool[0]
    const top = pool[0].motive
    const weights = pool.map((m) => Math.exp((m.motive - top) / Math.max(0.05, temperature * 2)))
    const total = weights.reduce((a, b) => a + b, 0)
    let r = random() * total
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i]
      if (r <= 0) return pool[i]
    }
    return pool[0]
  }

  /** 去做；做完按结果学。 */
  async function act(id, context = {}) {
    const a = actions.get(id)
    if (!a) return { ok: false, summary: '没有这件事' }
    const avail = availability(a)
    if (avail !== true) return { ok: false, summary: typeof avail === 'string' ? avail : '现在做不了' }
    const s0 = load()
    const L = s0.learned[id] || { expect: a.payoff, success: 0.8, runs: 0, lastAt: 0 }
    const lastAt = L.lastAt
    L.lastAt = now()
    s0.learned[id] = L
    save(s0)
    let r
    // 内心活动看得到私密会话。它的打算可以影响动力，原文只供心智和面板查看。
    const matched = s0.wants.filter((w) => matchesWant(a, w))
    const wants = matched.filter((w) => !w.internal).map((w) => w.text)
    try { r = (await a.run({ ...context, wants })) || { ok: false } } catch (error) { r = { ok: false, summary: error.message, deferred: error.code === 'BUDGET', budgetEstimate: error.budgetEstimate } }
    if (context.signal?.aborted) return { ok: false, summary: '这件事已停止' }
    const lr = Number(M('rewardLearning')) || 0
    const s = load()
    const l = s.learned[id] || L
    if (!r.ok && (r.deferred || context.budgetBlocked)) {
      l.lastAt = lastAt
      l.budgetDay = deps.today?.()
      l.budgetEstimate = context.budgetBlocked || r.budgetEstimate || 0
      s.learned[id] = l
      save(s)
      return { ...r, deferred: true }
    }
    delete l.budgetDay
    delete l.budgetEstimate
    const outcome = r.ok ? clamp(r.outcome ?? 0.6) : 0
    const delay = retryDelay(a, r)
    if (a.retryMinutes) {
      l.retryAt = delay ? now() + delay : 0
      if (r.ok) l.lastAt = now()
    }
    if (!delay) {
      l.expect = clamp(l.expect + lr * (outcome - l.expect), 0.05, 1)
      l.success = clamp(l.success + lr * ((r.ok ? 1 : 0) - l.success), 0.05, 1)
    }
    l.runs = (l.runs || 0) + 1
    s.learned[id] = l
    if (r.ok) for (const [need, w] of Object.entries(a.needs || {})) if (s.needs[need]) s.needs[need].deficit = clamp(s.needs[need].deficit - 0.5 * w * outcome)
    if (r.ok) {
      const handled = new Set(matched.map((w) => w.id))
      s.wants = s.wants.filter((w) => !handled.has(w.id))
    }
    s.log.unshift({ at: now(), id, label: a.label, ok: Boolean(r.ok), summary: String(r.summary || '').slice(0, 120), outcome })
    s.log = s.log.slice(0, 300)
    save(s)
    if (a.record === true && r?.ok) r.record = true
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

  /** 给聊天用的自然提示：最近做过什么、心里想做什么；只给管理员私聊。 */
  function prompt({ owner = false, body } = {}) {
    const s = advance(load(), body)
    const recent = s.log.find((x) => x.ok && now() - x.at <= 3 * HOUR)
    const want = owner ? s.wants.find((w) => !w.internal && w.strength >= 0.5) : null
    const bits = []
    if (recent) bits.push(`你刚${recent.label}${recent.summary ? `，${recent.summary}` : ''}`)
    if (want) bits.push(`你心里还有点想${want.text}，但不着急`)
    return bits.length ? `（${bits.join('；')}）` : ''
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

  return { offer, motives, choose, act, feedback, satisfy, want, closeWant, satisfyWants, state, prompt, NEEDS }
}
