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
