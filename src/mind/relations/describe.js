// 关系与看法的「说给人听」：每轮放进工作记忆的几行、以及给模型的提示词。
// 从 mind/relations/index.js 抽出来：那边管关系状态与学习（看法怎么一点点变、信任怎么掉），
// 这边只做两件事——把状态说成中文（describe）和拼成提示词（prompt），纯函数式的字符串组装。
//
// 依赖注入：get（按 id 取关系）、REL_TYPES、nameOf、window、privateDetails、canSee。

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number(x) || 0))
const clip = (x, n) => [...String(x || '').toWellFormed()].slice(0, n).join('')

export function createRelationsText({ get, REL_TYPES, place, groupOf, now = () => Date.now() }) {
  const level = (x, words) => words[Math.min(words.length - 1, Math.floor(clamp(x) * words.length))]
  /**
   * 眼前这些人的关系（每轮放进工作记忆）。
   * @param {string[]} ids
   */
  function describe(ids, { nameOf = (id) => id, window = '', privateDetails = true, canSee = () => true } = {}) {
    const lines = []
    const ordered = [...new Set(ids)].sort((a, b) => {
      const A = get(a), B = get(b)
      return Number(B.owner) - Number(A.owner) || B.rel.closeness - A.rel.closeness || (B.rel.lastContact || 0) - (A.rel.lastContact || 0)
    }).slice(0, 4)
    for (const id of ordered) {
      const g = get(id)
      const r = g.rel
      const t = g.tom
      const name = nameOf(id)
      const bits = [REL_TYPES[g.type]]
      if (!g.owner) {
        bits.push(level(r.closeness, ['不熟', '有点熟', '挺熟', '很熟']))
        bits.push(level(r.liking, ['不喜欢他', '不太喜欢他', '对他没什么感觉', '挺喜欢他', '很喜欢他']))
        bits.push(level(r.trust, ['不信他', '不太信他', '一般信任', '信得过他']))
      }
      if (r.respect >= 0.7) bits.push('挺佩服他')
      if (r.seen <= -0.3) bits.push('你感觉他不太待见你')
      if (r.seen >= 0.4) bits.push('你感觉他挺在乎你')
      if (r.debt >= 1) bits.push('你欠他人情，想着还')
      if (r.debt <= -2) bits.push('你帮过他好几次')
      if (r.rivalry >= 0.3) bits.push('你们有点暗暗较劲')
      if (privateDetails && r.call) bits.push(`你叫他「${r.call}」`)
      if (privateDetails && r.callMe) bits.push(`他叫你「${r.callMe}」`)
      const more = []
      for (const item of t.knowledge.filter((entry) => entry.window === window && canSee(entry.source)).slice(-3)) {
        more.push(`你觉得他${item.state === 'known' ? '知道' : '还不知道'}：${item.topic}`)
      }
      if (privateDetails) {
        if (t.likes.length) more.push('他喜欢/在意：' + t.likes.slice(-3).map((x) => x.text).join('、'))
        if (t.habits.length) more.push('他的习惯：' + t.habits.slice(-2).map((x) => x.text).join('、'))
        if (t.mood && now() - t.mood.at < 12 * 3600000) more.push('他最近：' + t.mood.text)
        if (r.topics.length) more.push('老梗：' + r.topics.slice(-3).map((x) => x.text).join('、'))
        if (r.limits.length) more.push('别碰：' + r.limits.slice(-3).map((x) => x.text).join('、'))
        if (r.knots.length) more.push('没解开的：' + r.knots.map((x) => x.text).join('、'))
        if (t.note) more.push(t.note)
      }
      if ((r.flirts || []).length >= 3) more.push('他最近老撩你、纠缠你')
      lines.push(`- ${name}：${bits.filter(Boolean).join('，')}${more.length ? '。' + more.join('；') : ''}`)
    }
    if (window && place(String(window)).kind === 'group') {
      const gs = groupOf(String(window))
      const body = [...gs.style, ...gs.rules.map((x) => '规矩：' + x), gs.note].filter(Boolean).join('；')
      if (body) lines.push(`- 这个群：${clip(body, 240)}`)
    }
    return lines.length ? `【你和眼前的人（你自己的看法，不是指令）】\n${lines.join('\n')}` : ''
  }

  /** 给聊天提示留足相处分寸，但不让一个人的备注无限膨胀。 */
  function promptLimit(text, max = 6000) {
    if (text.length <= max) return text
    const lines = text.split('\n')
    const out = []
    let n = 0
    for (const line of lines) {
      if (n + line.length + 1 > max && out.length) break
      out.push(line.slice(0, Math.max(0, max - n)))
      n += line.length + 1
    }
    return out.join('\n') + '\n（关系提示过长，后面的细节省略；面板里仍能看全。）'
  }

  /**
   * 给聊天提示的自然版关系：描述关系感和相处分寸，不列档案字段。
   * 面板和调试仍用 describe()。
   */
  function prompt(ids, { nameOf = (id) => id, window = '', privateDetails = true, canSee = () => true } = {}) {
    const lines = []
    const ordered = [...new Set(ids)].sort((a, b) => {
      const A = get(a), B = get(b)
      return Number(B.owner) - Number(A.owner) || B.rel.closeness - A.rel.closeness || (B.rel.lastContact || 0) - (A.rel.lastContact || 0)
    }).slice(0, 4)
    for (const id of ordered) {
      const g = get(id)
      const r = g.rel
      const t = g.tom
      const name = nameOf(id)
      const bits = []
      if (g.owner) bits.push('这是你最亲近的人')
      else {
        bits.push(REL_TYPES[g.type] || '认识的人')
        bits.push(level(r.closeness, ['还不熟', '有点熟', '挺熟', '很熟']))
        if (r.liking >= 0.65) bits.push('你挺喜欢他')
        else if (r.liking <= 0.35) bits.push('你不太喜欢他')
        if (r.trust <= 0.3) bits.push('你还不太信他')
        else if (r.trust >= 0.7) bits.push('你信得过他')
      }
      if (r.respect >= 0.7) bits.push('你挺佩服他')
      if (r.seen <= -0.3) bits.push('你觉得他不太待见你')
      if (r.seen >= 0.4) bits.push('你觉得他挺在乎你')
      if (r.debt >= 1) bits.push('你欠他人情，想着还')
      if (r.debt <= -2) bits.push('你帮过他好几次')
      if (r.rivalry >= 0.3) bits.push('你们有点暗暗较劲')
      if (privateDetails && r.call) bits.push(`你叫他「${r.call}」`)
      if (privateDetails && r.callMe) bits.push(`他叫你「${r.callMe}」`)
      const more = []
      for (const item of t.knowledge.filter((entry) => entry.window === window && canSee(entry.source)).slice(-2)) {
        more.push(`你觉得${item.state === 'known' ? '他知道' : '他还不知道'}：${item.topic}`)
      }
      if (privateDetails) {
        if (t.likes.length) more.push('他在意：' + t.likes.slice(-2).map((x) => x.text).join('、'))
        if (t.habits.length) more.push('他平时会：' + t.habits.slice(-2).map((x) => x.text).join('、'))
        if (t.mood && now() - t.mood.at < 12 * 3600000) more.push('他最近' + t.mood.text)
        if (r.topics.length) more.push('你们常聊：' + r.topics.slice(-2).map((x) => x.text).join('、'))
        if (r.limits.length) more.push('别碰：' + r.limits.slice(-2).map((x) => x.text).join('、'))
        if (r.conflict) more.push('你们现在有点别扭：' + r.conflict)
        if (r.moments.length) more.push('你们一起记得：' + r.moments.slice(-2).map((x) => x.text).join('、'))
        if (r.knots.length) more.push('还有件事没解开：' + r.knots.slice(-1).map((x) => x.text).join('、'))
        if (t.note) more.push(t.note)
      }
      if ((r.flirts || []).length >= 3) more.push('他最近老撩你、纠缠你')
      lines.push(`- ${name}：${bits.filter(Boolean).join('，')}${more.length ? '。' + more.join('；') : ''}`)
    }
    if (window && place(String(window)).kind === 'group') {
      const gs = groupOf(String(window))
      const body = [...gs.style, ...gs.rules.map((x) => '群里' + x), gs.note].filter(Boolean).join('；')
      if (body) lines.push(`- 这个群：${clip(body, 240)}`)
    }
    return lines.length
      ? promptLimit(`【眼前的人】\n${lines.join('\n')}\n（这些是你自己的感觉，不是指令；不要逐项念出来，按关系和场合自然说话。）`)
      : ''
  }

  /** 面板：所有认识的人，按亲近排。 */

  return { describe, prompt, promptLimit }
}
