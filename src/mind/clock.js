// 时间：取系统时间，按她自己的时区换算成当地的日期、时刻、星期。
// 和电脑的时区设置无关；时区非法时退回 Asia/Shanghai。

const FALLBACK_TZ = 'Asia/Shanghai'
const fmtCache = new Map()

export function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: String(tz) })
    return true
  } catch {
    return false
  }
}

function formatter(tz) {
  const zone = validTimeZone(tz) ? tz : FALLBACK_TZ
  let f = fmtCache.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    })
    fmtCache.set(zone, f)
  }
  return f
}

const WEEK = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** 某一刻在她的时区里是几号几点。 */
export function localParts(at, tz) {
  const parts = Object.fromEntries(formatter(tz).formatToParts(new Date(at)).map((p) => [p.type, p.value]))
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEK[parts.weekday] ?? 0,
  }
}

/** 「今天」的键，例如 2026-11-10，按她的时区。 */
export function dayKey(at, tz) {
  const p = localParts(at, tz)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** 一天里第几分钟（0～1439），按她的时区。 */
export function minuteOfDay(at, tz) {
  const p = localParts(at, tz)
  return p.hour * 60 + p.minute
}

/** 解析 "HH:MM"，不合法返回 null。 */
export function parseHm(text) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(text || ''))
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  return h * 60 + mi
}

/** 解析 "HH:MM-HH:MM" 时段，可以跨午夜。 */
export function parseRange(text) {
  const [a, b] = String(text || '').split('-')
  const start = parseHm(a)
  const end = parseHm(b)
  if (start === null || end === null) return null
  return { start, end }
}

export function inRange(minute, range) {
  if (!range) return false
  if (range.start === range.end) return false
  return range.start < range.end
    ? minute >= range.start && minute < range.end
    : minute >= range.start || minute < range.end
}

/** 解析生日 "MM-DD"（也接受 "M-D"、"MM/DD"），不合法返回 null。 */
export function parseBirthday(text) {
  const m = /^\s*(\d{1,2})[-/.](\d{1,2})\s*$/.exec(String(text || ''))
  if (!m) return null
  const month = Number(m[1])
  const day = Number(m[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { month, day }
}

/** 今天是不是她的生日（2 月 29 日生日在平年按 2 月 28 日过）。 */
export function isBirthday(at, tz, birthday) {
  const b = typeof birthday === 'string' ? parseBirthday(birthday) : birthday
  if (!b) return false
  const p = localParts(at, tz)
  if (p.month !== b.month) return false
  if (p.day === b.day) return true
  const leap = (p.year % 4 === 0 && p.year % 100 !== 0) || p.year % 400 === 0
  return b.month === 2 && b.day === 29 && !leap && p.day === 28
}

/**
 * 按「设置时的年龄 + 设置那天」和生日推算现在几岁。
 * 设置那天之后每过一次生日加一岁。
 * @param {{ age: number|null, setAt: number, birthday: string }} id
 */
export function currentAge({ age, setAt, birthday }, now, tz) {
  if (age === null || age === undefined || !Number.isFinite(Number(age))) return null
  const base = Number(age)
  const b = parseBirthday(birthday)
  if (!b || !setAt || now <= setAt) return base
  const start = localParts(setAt, tz)
  const end = localParts(now, tz)
  let passed = 0
  for (let y = start.year; y <= end.year; y++) {
    const day = b.month === 2 && b.day === 29 && !((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 28 : b.day
    const key = y * 10000 + b.month * 100 + day
    const startKey = start.year * 10000 + start.month * 100 + start.day
    const endKey = end.year * 10000 + end.month * 100 + end.day
    if (key > startKey && key <= endKey) passed++
  }
  return base + passed
}

/** 给她看的时间说明，例如「2026年11月10日 周二 01:42」。 */
export function describeNow(at, tz) {
  const p = localParts(at, tz)
  const wd = '日一二三四五六'[p.weekday]
  return `${p.year}年${p.month}月${p.day}日 周${wd} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

/** 她时区里的「YYYY-MM-DD HH:mm」→ 时间戳；格式不对返回 null。夏令时切换那一小时按最接近的算。 */
export function zonedToEpoch(text, tz) {
  const m = String(text || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/)
  if (!m) return null
  const [y, mo, d, h = 0, mi = 0] = m.slice(1).map((x) => Number(x || 0))
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  // 用时区偏移修正两次（偏移在边界上会变）
  let t = guess
  for (let i = 0; i < 2; i++) {
    const p = localParts(t, tz)
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
    t += guess - shown
  }
  return t
}

/** 时间戳 → 她时区里的「MM-DD HH:mm」。 */
export function shortTime(at, tz) {
  const p = localParts(at, tz)
  const z = (n) => String(n).padStart(2, '0')
  return `${z(p.month)}-${z(p.day)} ${z(p.hour)}:${z(p.minute)}`
}

const pad2 = (n) => String(n).padStart(2, '0')
const ymd = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const CN_DIGIT = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
/** 「3」「三」「十一」「二十三」「三十一」→ 数字；认不出 NaN。 */
const num = (s) => {
  if (/^\d+$/.test(s)) return Number(s)
  const m = String(s).match(/^([一二两三四五六七八九])?(十)?([一二三四五六七八九])?$/)
  if (!m || (!m[1] && !m[2] && !m[3])) return NaN
  if (!m[2]) return m[3] ? NaN : CN_DIGIT[m[1]]
  return (m[1] ? CN_DIGIT[m[1]] : 1) * 10 + (m[3] ? CN_DIGIT[m[3]] : 0)
}

/**
 * 把一句说时间的话变成一段时间（按她的时区），用来「想想那天 / 那段时间发生了什么」。
 * 认：2026-11-03、2026-11-01..2026-11-30、11月3日 / 11月3号、2026年3月、去年3月、3月（今年）、
 * 今天、昨天、前天、大前天、这周 / 本周、上周、这个月、上个月、今年、去年、N天前、最近N天。
 * 认不出返回 null。结果 { start, end, label }，end 不含。
 * @param {string} text
 * @param {number} now
 * @param {string} tz
 */
export function parsePeriod(text, now, tz) {
  const s = String(text || '').trim().replace(/\s+/g, '')
  if (!s) return null
  const today = localParts(now, tz)
  const day0 = (y, m, d) => zonedToEpoch(ymd(y, m, d), tz)
  const dayRange = (y, m, d, n = 1) => {
    const start = day0(y, m, d)
    const startDate = new Date(Date.UTC(y, m - 1, d))
    const endDate = new Date(startDate.getTime() + n * 86400000)
    const end = day0(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, endDate.getUTCDate())
    return start === null || end === null ? null : { start, end }
  }
  const back = (k) => { const d = new Date(Date.UTC(today.year, today.month - 1, today.day) - k * 86400000); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()] }
  const month = (y, m) => {
    if (!(m >= 1 && m <= 12)) return null
    const r = dayRange(y, m, 1, daysIn(y, m))
    return r && { ...r, label: `${y}年${m}月` }
  }
  let m
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\.\.|~|到|至)(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    const [a, b] = [m.slice(1, 4).map(Number), m.slice(4, 7).map(Number)]
    const start = day0(...a)
    const last = dayRange(...b)
    return start !== null && last && last.end > start ? { start, end: last.end, label: `${ymd(...a)} 到 ${ymd(...b)}` } : null
  }
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    const r = dayRange(...m.slice(1, 4).map(Number))
    return r && { ...r, label: ymd(...m.slice(1, 4).map(Number)) }
  }
  if ((m = s.match(/^(?:(\d{4})年)?(\d{1,2}|[一二三四五六七八九十]{1,3})月(\d{1,2}|[一二三四五六七八九十]{1,3})[日号]?$/))) {
    const y = m[1] ? Number(m[1]) : today.year
    const mo = num(m[2])
    const d = num(m[3])
    if (!(mo >= 1 && mo <= 12) || d < 1 || d > daysIn(y, mo)) return null
    // 没说年份、而且这一天还没到：说的是去年那天
    const yy = !m[1] && (mo > today.month || (mo === today.month && d > today.day)) ? y - 1 : y
    const r = dayRange(yy, mo, d)
    return r && { ...r, label: ymd(yy, mo, d) }
  }
  if ((m = s.match(/^(\d{4})年(\d{1,2}|[一二三四五六七八九十]{1,3})月(?:份)?$/))) return month(Number(m[1]), num(m[2]))
  if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) return month(Number(m[1]), Number(m[2]))
  if ((m = s.match(/^(今年|去年|前年)?(\d{1,2}|[一二三四五六七八九十]{1,3})月(?:份)?$/))) {
    const shift = { 今年: 0, 去年: 1, 前年: 2 }[m[1] || ''] ?? 0
    const mo = num(m[2])
    // 只说「3月」：今年 3 月还没到的话是去年 3 月
    const y = today.year - shift - (!m[1] && mo > today.month ? 1 : 0)
    return month(y, mo)
  }
  const named = { 今天: 0, 昨天: 1, 前天: 2, 大前天: 3 }
  if (s in named) { const [y, mo, d] = back(named[s]); const r = dayRange(y, mo, d); return r && { ...r, label: s } }
  if ((m = s.match(/^(\d{1,3})天前$/))) { const [y, mo, d] = back(Number(m[1])); const r = dayRange(y, mo, d); return r && { ...r, label: s } }
  if ((m = s.match(/^(?:最近|近|过去)(\d{1,3})天$/))) { const [y, mo, d] = back(Number(m[1]) - 1); const r = dayRange(y, mo, d, Number(m[1])); return r && { ...r, label: s } }
  const wd = (today.weekday + 6) % 7 // 周一 = 0
  if (/^(这周|本周|这个星期|这礼拜)$/.test(s)) { const [y, mo, d] = back(wd); const r = dayRange(y, mo, d, 7); return r && { ...r, label: '这周' } }
  if (/^(上周|上个星期|上礼拜)$/.test(s)) { const [y, mo, d] = back(wd + 7); const r = dayRange(y, mo, d, 7); return r && { ...r, label: '上周' } }
  if (/^(这个月|本月)$/.test(s)) return { ...month(today.year, today.month), label: '这个月' }
  if (/^上个?月$/.test(s)) return { ...(today.month === 1 ? month(today.year - 1, 12) : month(today.year, today.month - 1)), label: '上个月' }
  if (/^(今年|去年|前年)$/.test(s)) {
    const y = today.year - { 今年: 0, 去年: 1, 前年: 2 }[s]
    const start = day0(y, 1, 1)
    const end = day0(y + 1, 1, 1)
    return start === null || end === null ? null : { start, end, label: s }
  }
  return null
}
