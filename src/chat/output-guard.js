const OPEN = /(?:⟦|\[\[|【)\s*REPLY\s*(?:⟧|\]\]|】)/gi
const CLOSE = /(?:⟦|\[\[|【)\s*\/\s*REPLY\s*(?:⟧|\]\]|】)/gi

export const CODE_INSTRUCTION = '给对方看代码、命令行或日志时，用 Markdown 代码围栏包好，保留缩进。'
export const MARKER_INSTRUCTION = '把对方应该看到的全部正文包在 ⟦REPLY⟧ 和 ⟦/REPLY⟧ 之间。保持沉默时在里面写 [沉默]。标记外的内容不会发送。'

export function codeFences(value) {
  const ranges = []
  let open = null
  for (const line of value.matchAll(/[^\n]*(?:\n|$)/g)) {
    const mark = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line[0].trimEnd())
    if (!mark) continue
    if (!open) open = { start: line.index, sign: mark[1] }
    else if (mark[1][0] === open.sign[0] && mark[1].length >= open.sign.length && !mark[2].trim()) {
      ranges.push({ start: open.start, end: line.index + line[0].trimEnd().length })
      open = null
    }
  }
  return ranges
}

export function extractReply(value) {
  const text = String(value || '')
  const code = codeFences(text)
  const markers = (re) => [...text.matchAll(re)].filter((m) => !code.some((r) => m.index >= r.start && m.index < r.end))
  const opens = markers(OPEN)
  const closes = markers(CLOSE)
  if (!opens.length) return null
  const open = opens.at(-1)
  const start = open.index + open[0].length
  const close = closes.find((m) => m.index >= start)
  return close ? text.slice(start, close.index).trim() : null
}

const META = /(?:not addressed to me|no reply needed|stay silent|remain silent|i could react|i should (?:reply|respond|say))/i
const META_ZH = /^(?:这条不是对我说的|不用接|保持沉默|先不接)(?:[。！？.!?\s]|$)/
const DRAFT = /(?:^|\n)[ \t]*(?:Careful|Draft|Final answer|Internal reasoning|自检|定稿|草稿|思考过程|内心独白)[ \t]*[:：]/i
const EN_SENTENCE = /[A-Za-z][^\p{Script=Han}\n]{0,200}?[.!?]/gu

function guardProse(value) {
  let text = value.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think\s*>|$)/gi, '')
  const meta = [...text.slice(0, 600).matchAll(EN_SENTENCE)].filter((m) => {
    if (!META.test(m[0])) return false
    const prefix = text.slice(0, m.index)
    return !/[\p{Script=Han}][^\n]{0,90}[。！？]/u.test(prefix)
  }).at(-1)
  if (meta) text = text.slice(meta.index + meta[0].length).replace(/^\s*(?:Silence|One line|\d+ lines? only)[.!?]\s*/i, '')
  if (META_ZH.test(text.trim()) || DRAFT.test(text) || /(?:^|\n)\s*(?:Reply|Plan|Note)\s*:[^\n]*\n\s*(?:Careful|Draft|Final|Plan)\s*:/i.test(text)) return ''
  return text.replace(OPEN, '').replace(CLOSE, '')
}

export function guardReply(value) {
  const text = String(value || '')
  const chunks = []
  let cursor = 0
  for (const span of codeFences(text)) {
    chunks.push(guardProse(text.slice(cursor, span.start)), text.slice(span.start, span.end))
    cursor = span.end
  }
  chunks.push(guardProse(text.slice(cursor)))
  const clean = chunks.join('').trim()
  const compact = clean.replace(/\s/g, '')
  if (!cursor && compact.length >= 24 && /^(.{1,8})\1{5,}[。！？.!?]?$/su.test(compact) && !/^[A-Za-z0-9+/=_-]{40,}$/.test(compact)) return ''
  return clean
}
