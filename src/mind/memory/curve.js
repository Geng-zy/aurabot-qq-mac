// 遗忘和加强的数学：幂函数遗忘曲线 + 回忆时的间隔效应。
// 形状和参数取自 FSRS-4.5（开源间隔重复算法，open-spaced-repetition，用数亿次复习记录拟合）：
//   R(t) = (1 + F·t/S)^C，F = 19/81，C = -0.5；S（稳定性）= 记得还有九成把握的天数。
// 幂函数和 Rubin & Wenzel 1996、Wixted & Ebbesen 1997 的结论一致（开始忘得快、后来慢）。
// 回忆成功后 S 变大，回忆时 R 越低（隔得越久）加得越多，这就是间隔效应（Cepeda 等 2006、2008）。

const F = 19 / 81
const C = -0.5
// FSRS-4.5 默认权重里管「回忆成功后加强」的三个：w8、w9、w10；难度固定取中间（D = 5）。
const W8 = 1.6474
const W9 = 0.1367
const W10 = 1.0461
const D = 5
const DAY = 86400000

/** 过了 elapsedMs 后还记得多少（0～1）。forgetting > 1 记得更久。 */
export function retention(stabilityDays, elapsedMs, forgetting = 1) {
  const s = Math.max(0.01, Number(stabilityDays) || 0.01)
  const t = Math.max(0, Number(elapsedMs) || 0) / DAY / Math.max(0.01, Number(forgetting) || 1)
  return Math.pow(1 + F * t / s, C)
}

/**
 * 刚记下时的稳定性（天）。
 * intensity 情绪强度 0～1、importance 重要程度 0～1、attention 专心程度 0～1、energy 精力 0～1。
 */
export function initialStability({ base = 0.6, intensity = 0, importance = 0.5, attention = 1, energy = 1, emotionBoost = 1 } = {}) {
  const clamp = (x) => Math.min(1, Math.max(0, Number(x) || 0))
  const s = base
    * (1 + 2 * emotionBoost * clamp(intensity))
    * (0.5 + clamp(importance))
    * (0.4 + 0.6 * clamp(attention))
    * (0.6 + 0.4 * clamp(energy))
  return Math.max(0.05, s)
}

/** 回忆成功后的新稳定性。r 是回忆那一刻的记得程度；spacingBonus 是面板里的倍数。 */
export function afterRecall(stabilityDays, r, spacingBonus = 1) {
  const s = Math.max(0.01, Number(stabilityDays) || 0.01)
  const gain = Math.exp(W8) * (11 - D) * Math.pow(s, -W9) * (Math.exp(W10 * (1 - Math.min(1, Math.max(0, r)))) - 1)
  return s * (1 + Math.max(0, spacingBonus) * gain)
}

/**
 * 记得的程度 → 想起来是什么样：clear 清楚、vague 只记得大概、tip 话到嘴边（要很强的线索）、null 想不起来。
 */
export function levelOf(r, cueSim, { clear = 0.5, vague = 0.2, tip = 0.05, strongCue = 0.75 } = {}) {
  if (r >= clear) return 'clear'
  if (r >= vague) return 'vague'
  if (r >= tip && cueSim >= strongCue) return 'tip'
  return null
}
