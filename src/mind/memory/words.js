// 从一句话里挑出能拿来找记忆的词（关键词线索）。
// 中文没有空格：先用 Node 自带的分词（Intl.Segmenter），词典里没有的词（烤串、孜然）会被拆成单字，
// 就把连着的单字两两组成二字词，作为弱一点的线索。虚词、口头禅不算。

const STOP_WORDS = new Set([
  '记得', '还记得', '什么', '怎么', '怎么样', '为什么', '我们', '你们', '他们', '她们', '这个', '那个', '这些', '那些', '就是', '然后',
  '因为', '所以', '可以', '没有', '知道', '觉得', '一下', '现在', '时候', '上次', '一起', '还是', '不是', '已经', '真的', '一个',
  '自己', '东西', '事情', '是不是', '哈哈', '哈哈哈', '嗯嗯', '好的', '好吧', '有点', '感觉', '的话', '而且', '但是', '如果', '这样',
  '那样', '如何', '干嘛', '之前', '以后', '刚才', '今天', '昨天', '明天', '怎么办', '一点', '应该', '可能', '这么', '那么', '不会', '不要', '告诉',
])
// 这些字组成的二字组合基本是虚的（了吗、我说……）
const STOP_CHARS = new Set([...'了吗呢吧啊呀哦嗯的地得是我你他她它们在有就都也还很太不没说去要会能想看给让把被和跟与这那个些吃'])

let seg = null
try { seg = new Intl.Segmenter('zh', { granularity: 'word' }) } catch {}

/**
 * @param {string} text
 * @param {{ limit?: number }} [o]
 * @returns {Array<{ w: string, weight: number }>} 词和它作为线索的分量（词典里的词 1，拼出来的二字词 0.5）
 */
export function keywords(text, { limit = 8 } = {}) {
  const s = String(text || '').slice(0, 600)
  const out = new Map()
  const add = (w, weight) => { if (!out.has(w) || out.get(w) < weight) out.set(w, weight) }
  const pieces = seg ? [...seg.segment(s)] : [...s].map((c) => ({ segment: c, isWordLike: /[\p{L}\p{N}]/u.test(c) }))
  let run = ''
  const flush = () => {
    const chars = [...run]
    for (let i = 0; i + 1 < chars.length; i++) {
      if (STOP_CHARS.has(chars[i]) || STOP_CHARS.has(chars[i + 1])) continue
      add(chars[i] + chars[i + 1], 0.5)
    }
    run = ''
  }
  for (const p of pieces) {
    const w = p.segment.trim()
    if (!p.isWordLike || !w) { flush(); continue }
    const n = [...w].length
    if (n === 1 && /\p{Script=Han}/u.test(w)) { run += w; continue }
    flush()
    if (n >= 2 && !STOP_WORDS.has(w.toLowerCase()) && !/^\d{1,2}$/.test(w)) add(w, 1)
  }
  flush()
  return [...out].map(([w, weight]) => ({ w, weight })).sort((a, b) => b.weight - a.weight || [...b.w].length - [...a.w].length).slice(0, limit)
}
