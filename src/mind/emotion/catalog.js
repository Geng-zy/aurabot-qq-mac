// 情绪清单和每种情绪本来持续多久。
//
// 持续时间的依据：Verduyn & Lavrijsen 2015（Motivation and Emotion 39:119–127），233 名高中生回忆 27 种情绪最近的一次，
// 报告从开始到「完全恢复」用了多久。下面 ANCHOR_HOURS 是该文图 1 右下（完全恢复、中位数，小时）按图中顺序读出的值；
// 悲伤 120、仇恨 60、快乐 35、羞愧 0.5 与英国心理学会 2014-11-26 研究摘要转述的数字一致。
// 这是青少年的回忆报告，所以面板里有整体倍数可以调；事件越重要、越反复去想，持续越久（同一篇：两者解释了 43% 的差异）。
//
// 清单本身按设计文档：以 Cowen & Keltner 2017 的 27 类为底，补上自我意识情绪、社交情绪和中文里常见的情绪。
// 不在那 27 种里的情绪，持续时间借用意思最接近的一种（anchor），这一步是判断，不是研究结果。

/** 原文 27 种情绪「完全恢复」的中位数（小时）。 */
export const ANCHOR_HOURS = {
  disgust: 0.5, shame: 0.5, fear: 0.7, humiliation: 0.8, compassion: 1.3, irritation: 1.3, surprise: 2, boredom: 2,
  anger: 2, touched: 2.5, pride: 2.6, stress: 3, guilt: 3.5, relaxation: 4.3, gratitude: 5, admiration: 5,
  enthusiasm: 6, relief: 8, jealousy: 15, contentment: 24, disappointment: 24, anxiety: 24, hope: 24, desperation: 24,
  joy: 35, hatred: 60, sadness: 120,
}

/**
 * 情绪清单。v 愉快度 -1～1，a 唤醒度 -1～1（按 Russell 1980 环形模型大致摆放，经验值）；
 * anchor 借用哪种的持续时间；romantic 恋爱式情绪（受「专一」约束）；adult 只在满 18 岁时有；
 * anger 生气类（迁怒、对象都看它）。
 */
export const EMOTIONS = [
  // 基本情绪
  { name: '快乐', group: '基本', v: 0.8, a: 0.5, anchor: 'joy' },
  { name: '难过', group: '基本', v: -0.7, a: -0.4, anchor: 'sadness' },
  { name: '生气', group: '基本', v: -0.6, a: 0.7, anchor: 'anger', anger: true },
  { name: '害怕', group: '基本', v: -0.6, a: 0.6, anchor: 'fear' },
  { name: '惊恐', group: '基本', v: -0.8, a: 0.9, anchor: 'fear' },
  { name: '惊讶', group: '基本', v: 0.1, a: 0.7, anchor: 'surprise' },
  { name: '厌恶', group: '基本', v: -0.6, a: 0.3, anchor: 'disgust' },
  { name: '焦虑', group: '基本', v: -0.5, a: 0.6, anchor: 'anxiety' },
  // 愉悦类
  { name: '好笑', group: '愉悦', v: 0.6, a: 0.5, anchor: 'surprise' },
  { name: '兴奋', group: '愉悦', v: 0.7, a: 0.8, anchor: 'enthusiasm' },
  { name: '满足', group: '愉悦', v: 0.6, a: -0.2, anchor: 'contentment' },
  { name: '平静', group: '愉悦', v: 0.3, a: -0.6, anchor: 'relaxation' },
  { name: '松一口气', group: '愉悦', v: 0.4, a: -0.3, anchor: 'relief' },
  { name: '安心', group: '愉悦', v: 0.5, a: -0.4, anchor: 'relaxation' },
  { name: '入迷', group: '愉悦', v: 0.5, a: 0.4, anchor: 'enthusiasm' },
  { name: '感兴趣', group: '愉悦', v: 0.4, a: 0.4, anchor: 'enthusiasm' },
  { name: '好奇', group: '愉悦', v: 0.3, a: 0.5, anchor: 'enthusiasm' },
  { name: '渴望', group: '愉悦', v: 0.1, a: 0.5, anchor: 'enthusiasm' },
  { name: '期待', group: '愉悦', v: 0.5, a: 0.5, anchor: 'hope' },
  { name: '希望', group: '愉悦', v: 0.4, a: 0.3, anchor: 'hope' },
  // 对美和大的感受
  { name: '欣赏', group: '美', v: 0.6, a: 0.2, anchor: 'admiration' },
  { name: '惊叹', group: '美', v: 0.6, a: 0.7, anchor: 'admiration' },
  { name: '钦佩', group: '美', v: 0.5, a: 0.3, anchor: 'admiration' },
  { name: '感动', group: '美', v: 0.6, a: 0.3, anchor: 'touched' },
  // 对人的
  { name: '喜爱', group: '对人', v: 0.7, a: 0.2, anchor: 'contentment', toward: true },
  { name: '心动', group: '对人', v: 0.8, a: 0.7, anchor: 'enthusiasm', toward: true, romantic: true },
  { name: '爱慕', group: '对人', v: 0.8, a: 0.3, anchor: 'contentment', toward: true, romantic: true },
  { name: '性欲', group: '对人', v: 0.5, a: 0.8, anchor: 'enthusiasm', toward: true, romantic: true, adult: true },
  { name: '思念', group: '对人', v: -0.1, a: -0.1, anchor: 'hope', toward: true },
  { name: '感激', group: '对人', v: 0.7, a: 0.2, anchor: 'gratitude', toward: true },
  { name: '心疼', group: '对人', v: -0.4, a: 0.2, anchor: 'compassion', toward: true },
  { name: '同情', group: '对人', v: -0.3, a: 0, anchor: 'compassion', toward: true },
  { name: '信任', group: '对人', v: 0.5, a: -0.2, anchor: 'contentment', toward: true },
  { name: '嫉妒', group: '对人', v: -0.6, a: 0.6, anchor: 'jealousy', toward: true, romantic: true },
  { name: '羡慕', group: '对人', v: -0.2, a: 0.3, anchor: 'jealousy', toward: true },
  { name: '鄙视', group: '对人', v: -0.5, a: 0.2, anchor: 'anger', toward: true, anger: true },
  { name: '幸灾乐祸', group: '对人', v: 0.3, a: 0.4, anchor: 'surprise', toward: true },
  { name: '被冒犯', group: '对人', v: -0.6, a: 0.6, anchor: 'anger', toward: true, anger: true },
  { name: '受伤', group: '对人', v: -0.7, a: 0.1, anchor: 'disappointment', toward: true },
  // 关于自己的
  { name: '骄傲', group: '自己', v: 0.7, a: 0.4, anchor: 'pride' },
  { name: '羞愧', group: '自己', v: -0.6, a: 0.3, anchor: 'shame' },
  { name: '内疚', group: '自己', v: -0.6, a: 0.2, anchor: 'guilt' },
  { name: '尴尬', group: '自己', v: -0.4, a: 0.5, anchor: 'shame' },
  { name: '害羞', group: '自己', v: 0.1, a: 0.4, anchor: 'shame' },
  { name: '不好意思', group: '自己', v: -0.1, a: 0.3, anchor: 'shame' },
  { name: '后悔', group: '自己', v: -0.6, a: 0.1, anchor: 'guilt' },
  { name: '自责', group: '自己', v: -0.7, a: 0.2, anchor: 'guilt' },
  // 失去和缺少
  { name: '失望', group: '失去', v: -0.6, a: -0.2, anchor: 'disappointment' },
  { name: '失落', group: '失去', v: -0.5, a: -0.4, anchor: 'disappointment' },
  { name: '孤独', group: '失去', v: -0.6, a: -0.4, anchor: 'sadness' },
  { name: '怀旧', group: '失去', v: 0.1, a: -0.3, anchor: 'touched' },
  { name: '无奈', group: '失去', v: -0.4, a: -0.4, anchor: 'disappointment' },
  { name: '绝望', group: '失去', v: -0.9, a: -0.2, anchor: 'desperation' },
  { name: '无聊', group: '失去', v: -0.3, a: -0.7, anchor: 'boredom' },
  { name: '困惑', group: '失去', v: -0.2, a: 0.3, anchor: 'surprise' },
  // 中文里的
  { name: '委屈', group: '中文', v: -0.6, a: 0.2, anchor: 'disappointment', toward: true },
  { name: '不甘心', group: '中文', v: -0.5, a: 0.5, anchor: 'disappointment' },
  { name: '闹别扭', group: '中文', v: -0.4, a: 0.4, anchor: 'anger', toward: true, anger: true },
  { name: '烦躁', group: '中文', v: -0.5, a: 0.6, anchor: 'irritation', anger: true },
  { name: '想撒娇', group: '中文', v: 0.4, a: 0.3, anchor: 'touched', toward: true },
  { name: '逆反', group: '中文', v: -0.4, a: 0.5, anchor: 'irritation', anger: true },
  // 身体带来的（身体模块直接产生）
  { name: '饿', group: '身体', v: -0.2, a: 0.1, anchor: 'boredom' },
  { name: '困', group: '身体', v: -0.2, a: -0.8, anchor: 'boredom' },
]

const BY_NAME = new Map(EMOTIONS.map((e) => [e.name, e]))
// 模型常用的近义说法 → 清单里的名字
const ALIAS = {
  开心: '快乐', 高兴: '快乐', 愉快: '快乐', 伤心: '难过', 悲伤: '难过', 难受: '难过', 愤怒: '生气', 恼火: '生气', 火大: '生气',
  恐惧: '害怕', 担心: '焦虑', 紧张: '焦虑', 不安: '焦虑', 恶心: '厌恶', 有趣: '好笑', 乐: '好笑', 激动: '兴奋', 放松: '平静',
  感谢: '感激', 心痛: '心疼', 吃醋: '嫉妒', 看不起: '鄙视', 害臊: '害羞', 丢脸: '尴尬', 惭愧: '羞愧', 寂寞: '孤独',
  烦: '烦躁', 撒娇: '想撒娇', 赌气: '闹别扭', 喜欢: '喜爱', 爱: '爱慕', 想念: '思念', 嫌弃: '厌恶', 饥饿: '饿', 困倦: '困',
}

/** 名字（或近义说法）→ 清单里的情绪；认不出返回 null。 */
export function emotionOf(name) {
  const n = String(name || '').trim()
  return BY_NAME.get(n) || BY_NAME.get(ALIAS[n]) || null
}

/** 这种情绪「完全过去」大约要几个小时（按原文中位数，未乘倍数）。 */
export function baseHours(name) {
  const e = emotionOf(name)
  return e ? ANCHOR_HOURS[e.anchor] : 2
}
