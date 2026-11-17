// 记忆里的纯文本工具：相对日期定锚、JSON 提取、经历种类。
const DAY = 86400000
const relativeDays = { 大前天: -3, 前天: -2, 昨天: -1, 昨晚: -1, 昨夜: -1, 今天: 0, 今日: 0, 今晚: 0, 明天: 1, 明晚: 1, 后天: 2, 大后天: 3 }
export const relativeDayWords = /大前天|大后天|前天|后天|昨天|昨晚|昨夜|今天|今日|今晚|明天|明晚/
const relativeDayWordsGlobal = new RegExp(relativeDayWords, 'g')
const quotedText = /([「『“《][^」』”》]*[」』”》]|"[^"]*")/

export function anchorDates(text, day) {
  if (!day) return text
  const midnight = Date.parse(day + 'T00:00:00Z')
  return text.split(quotedText).map((part, i) => i % 2 ? part : part.replaceAll(relativeDayWordsGlobal, (word) =>
    new Date(midnight + relativeDays[word] * DAY).toISOString().slice(0, 10) + (/[晚夜]$/.test(word) ? '晚' : ''))).join('')
}

export const pendingLabel = (e) => e.data.followup?.done ? '（已停止跟进，结果以原话为准）' : '（当时提到，结果待确认）'

export function parseJson(text) {
  const s = String(text || '')
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(s.slice(start, end + 1)) } catch { return null }
}

export const KINDS = {
  event: '经历', fact: '知道的事', hearsay: '听说的', belief: '我觉得', intention: '要做的事',
  semantic: '知道的事（整理出来的）', noted: '特意记下的', 'public-note': '可聊的片段', 'shared-note': '允许分享的片段',
  dream: '梦', experience: '经历', 'own-post': '自己发过的', 'day-summary': '那天的事', 'week-summary': '那一周的事',
  'month-summary': '那个月的事', date: '每年的日子',
}
