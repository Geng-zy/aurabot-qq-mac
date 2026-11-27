// 动机的纯规则：16 项基本需要、需要与性格的对应，以及「这句话是不是想做某件事」的判定。
// 从 motivation/index.js 抽出来：那边是状态（加载/存盘/推进/满足/登记动作与结果学习），
// 这边只给输入算结果——不碰 store、不碰 now，可以直接单测。

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
export const NEED = new Map(NEEDS.map((n) => [n.id, n]))
export function matchesWant(action, want) {
  const target = explicitAction(want)
  return target ? target === action.id : action.matchWant ? action.matchWant(want.text) : (action.keywords || []).some((keyword) => want.text.includes(keyword))
}
export const availability = (action) => {
  try { return action.available ? action.available() : true } catch { return false }
}
export const retryDelay = (action, result) => {
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

export function explicitAction(want) {
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
