const OPEN = /(?:⟦|\[\[|【)\s*REPLY\s*(?:⟧|\]\]|】)/gi
const CLOSE = /(?:⟦|\[\[|【)\s*\/\s*REPLY\s*(?:⟧|\]\]|】)/gi

export const CODE_INSTRUCTION = '给对方看代码、命令行或日志时，用 Markdown 代码围栏包好，保留缩进。'
export const DIRECT_REPLY_INSTRUCTION = '回复正文和 <voice> 里只写你要让聊天对象听见的话。判断谁在问你、该不该回、怎么措辞，留在内部思考里。'
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

export function extractReply(value, { includeFeel = false } = {}) {
  const text = String(value || '')
  const code = codeFences(text)
  const markers = (re) => [...text.matchAll(re)].filter((m) => !code.some((r) => m.index >= r.start && m.index < r.end))
  const opens = markers(OPEN)
  const closes = markers(CLOSE)
  if (!opens.length) return null
  const open = opens.at(-1)
  const start = open.index + open[0].length
  const close = closes.find((m) => m.index >= start)
  if (!close) return null
  const reply = text.slice(start, close.index).trim()
  if (!includeFeel) return reply
  const tail = text.slice(close.index + close[0].length)
  const feel = /^\s*(<feel>(?:(?!<\/?feel\b)[\s\S])*<\/feel>)\s*$/i.exec(tail)
  return feel ? reply + '\n' + feel[1] : reply
}

const META = /(?:not addressed to me|no reply needed|stay silent|remain silent|i could react|i should (?:reply|respond|say))/i
const META_ZH = /^(?:这条不是对我说的|不用接|保持沉默|先不接)(?:[。！？.!?\s]|$)/
const DRAFT = /(?:^|\n)[ \t]*(?:Careful|Draft|Final answer|Internal reasoning|自检|定稿|草稿|思考过程|内心独白)[ \t]*[:：]/i
const EN_SENTENCE = /[A-Za-z][^\p{Script=Han}\n]{0,200}?[.!?]/gu
const PLANNING_HEAD = /^(?:管理员|用户|群友|对方|他|她)(?:刚才|刚刚|又|正在|在|刚){0,2}\s*(?:问我|叫我|让我|在等我)/u
const PLANNING_DECISION = /[，。；、！？,;：:]\s*(?:我)?\s*(?:得|该|应该|需要|最好|先|要)(?:赶紧|马上|赶快|立刻|先|直接|礼貌地|简单)?\s*(?:回(?:他|她|应|复|答|一句|一下|(?=[。！？.!?]|$))|接话|解释一下)/u

function stripPlanningPrefix(text) {
  const prefix = /^\s*(<reply:\s*\d+\s*>)?\s*/.exec(text)
  const lines = text.slice(prefix[0].length).split(/(\r?\n|\|\|\|)/)
  let removed = false
  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i].trimStart()
    if (!line) continue
    if (PLANNING_HEAD.test(line) && PLANNING_DECISION.test(line)) removed = true
    else return removed ? (prefix[1] || '') + lines.slice(i).join('').trimStart() : text
  }
  return removed ? '' : text
}

function guardProse(value) {
  let text = value.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think\s*>|$)/gi, '')
  const meta = [...text.slice(0, 600).matchAll(EN_SENTENCE)].filter((m) => {
    if (!META.test(m[0])) return false
    const prefix = text.slice(0, m.index)
    return !/[\p{Script=Han}][^\n]{0,90}[。！？]/u.test(prefix)
  }).at(-1)
  if (meta) text = text.slice(meta.index + meta[0].length).replace(/^\s*(?:Silence|One line|\d+ lines? only)[.!?]\s*/i, '')
  if (META_ZH.test(text.trim()) || DRAFT.test(text) || /(?:^|\n)\s*(?:Reply|Plan|Note)\s*:[^\n]*\n\s*(?:Careful|Draft|Final|Plan)\s*:/i.test(text)) return ''
  return text.replace(OPEN, '').replace(CLOSE, '').split(/(<voice>[\s\S]*?<\/voice>)/gi).map((part, i) => {
    if (i % 2 === 0) return stripPlanningPrefix(part)
    const spoken = stripPlanningPrefix(part.slice(7, -8))
    return spoken.trim() ? `<voice>${spoken}</voice>` : ''
  }).join('')
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
