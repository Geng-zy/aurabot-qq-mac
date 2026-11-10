// 内心活动：她醒着、没人找时，一步一步地想（意识流）；想着想着会冒出感受和打算，打算够强就去做。
//
// 规矩（设计文档「注意与意识流」「本地小模型的规矩」）：
// - 日常念头用本地小模型，只耗电不耗钱；没装本地小模型时用 DeepSeek，但想得慢得多（省钱）。
// - 小模型念头里的「事实」一律不进记忆，只留感受和打算。
// - 连续几步越想越难受，或者涉及和主人的关系又是负面的：按硬规则交给 DeepSeek 认真想一次（深想，每天有次数上限）。
// - 连续几步在重复：停下来放空，无聊感上升。
// - 走神比例：闲着时有多少时间在想、多少在发呆（Killingsworth & Gilbert 2010 等，默认 0.4）。

import { parseJson } from '../memory/index.js'
import { emotionOf } from '../emotion/catalog.js'
import { shortTime } from '../clock.js'

const MIN = 60000
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number(x) || 0))
const clip = (x, n) => [...String(x || '').toWellFormed()].slice(0, n).join('')

/** 两句话有多像（按字的重合，0～1）。 */
export function overlap(a, b) {
  const A = new Set([...String(a || '')].filter((c) => /\S/.test(c)))
  const B = new Set([...String(b || '')].filter((c) => /\S/.test(c)))
  if (!A.size || !B.size) return 0
  let n = 0
  for (const c of A) if (B.has(c)) n++
  return n / Math.min(A.size, B.size)
}

/** 解析本地小模型的一步念头（它不擅长 JSON，用几行固定的开头）。 */
export function parseThought(text) {
  const out = { thought: '', feel: null, plan: '', deep: false }
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim().replace(/^[-*·]\s*/, '')
    let m
    if ((m = line.match(/^念头[：:]\s*(.+)$/))) out.thought = m[1].trim()
    else if ((m = line.match(/^感受[：:]\s*([^\s，,0-9.]+)\s*[，,]?\s*([01](?:\.\d+)?)?/))) {
      const e = emotionOf(m[1])
      if (e) out.feel = { name: e.name, intensity: clamp(m[2] ?? 0.4) }
    } else if ((m = line.match(/^打算[：:]\s*(.+)$/))) {
      const p = m[1].trim()
      if (!/^(无|没有|不|—|-|暂无)$/.test(p)) out.plan = p
    } else if ((m = line.match(/^深想[：:]\s*(.+)$/))) out.deep = /^(是|要|需要|对)/.test(m[1].trim())
  }
  if (!out.thought) out.thought = String(text || '').split('\n').map((x) => x.trim()).find((x) => x && !/^(感受|打算|深想)[：:]/.test(x)) || ''
  out.thought = clip(out.thought.replace(/^念头[：:]\s*/, ''), 120)
  out.plan = clip(out.plan, 60)
  return out
}

/**
 * @param {{
 *   store: any, now: () => number, setting: (k: string) => any, tz: () => string, identity: () => any, isOwner: (id: string) => boolean,
 *   person: (id: string) => any, memory: any, emotion: any, body: any, motivation: any, budget: any, log?: any, random?: () => number,
 * }} deps
 */
export function createInner(deps) {
  const { store, now, setting } = deps
  const log = deps.log || { debug() {}, info() {}, warn() {}, error() {} }
  const random = deps.random || Math.random
  const A = (k) => setting('attention.' + k)
  let local = null // { chat(messages, opts) }
  let ask = null // DeepSeek：({ scene, system, text, maxTokens }) => string
  function connect(o = {}) {
    if (o.local !== undefined) local = o.local
    if (o.ask !== undefined) ask = o.ask
  }

  function load() {
    const s = store.get('inner', null)
    return s && Array.isArray(s.log) ? s : { log: [], nextAt: 0, boredom: 0, idleSince: 0, deepToday: { day: '', n: 0 } }
  }
  function save(s) { store.set('inner', s) }

  const ownerName = () => '主人'
  const nameOf = (pid) => (deps.isOwner(pid) ? ownerName() : deps.person(pid)?.name || String(pid).replace(/^qq:/, ''))

  /**
   * 刚发生的事：最近两小时里最近的那个聊天的几句原话，标明是谁、什么时候说的（减少把别人的事安到主人身上）。
   * 只在有新东西时给（afterId 之后有新消息）：想过一遍就放下，免得小模型一直绕着同一段话转。
   */
  function recentHappenings(afterId = 0) {
    const since = now() - 2 * 60 * MIN
    const last = store.prep('SELECT id, window FROM perception WHERE at >= ? ORDER BY at DESC, id DESC LIMIT 1').get(since)
    if (!last || last.id <= afterId) return { lines: [], lastId: afterId }
    const rows = store.prep('SELECT at, who, dir, text FROM perception WHERE window = ? AND at >= ? ORDER BY at DESC, id DESC LIMIT 6').all(last.window, since).reverse()
    const where = last.window.includes(':group:') ? '群里' : '私聊里'
    return { lines: rows.map((r) => `${shortTime(r.at, deps.tz())} ${where} ${r.dir === 'out' ? '你' : nameOf(r.who)}说：${clip(String(r.text).replace(/\s+/g, ' '), 60)}`), lastId: last.id }
  }

  const SYSTEM = () => {
    const name = deps.identity().name || '她'
    return `你是${name}心里的声音。她现在没人找，自己待着，脑子里在随便想。用第一人称写她此刻的一步念头，接着上一步往下想，可以跳到别的事上（回想、期待、担心、琢磨某人、好奇、无聊、白日梦、饿了困了……）。
规矩：只根据给你的材料，不编没发生过的事；材料里写了是谁说的就是谁说的，不要安到别人头上。念头要短，像人脑子里冒出来的一两句。
按下面格式输出四行：
念头：……
感受：情绪名 强度（0到1，没有就写 无）
打算：想去做的事（从「能做的事」里挑一件，或者 想找主人说话；没有就写 无）
深想：是 或 否（涉及主人和你们的关系、情绪很强、要做决定、对自己有了新看法时写 是）`
  }

  function material(s, recalled) {
    const b = deps.body.state()
    const e = deps.emotion.state(b)
    const parts = [deps.body.describe(b), `【心情】${e.mood.label}`]
    const feelings = e.active.filter((x) => x.intensity >= 0.15).slice(0, 4).map((x) => `${x.target ? '对' + nameOf(x.target) : ''}${x.name}${x.why ? '（' + x.why + '）' : ''}`)
    if (feelings.length) parts.push('【感受】' + feelings.join('；'))
    const recent = recentHappenings(s.seenUpTo || 0)
    if (recent.lines.length) parts.push('【刚才发生的】\n' + recent.lines.join('\n'))
    s.seenUpTo = recent.lastId
    if (recalled.length) parts.push('【想起来的】\n' + recalled.map((m) => '- ' + m.text).join('\n'))
    const todo = deps.memory.dueIntentions({ within: 12 * 60 * MIN }).map((x) => x.gist)
    if (todo.length) parts.push('【惦记着要做的】' + todo.join('；'))
    const ms = deps.motivation.state(b)
    if (ms.wants.length) parts.push('【想要的】' + ms.wants.slice(0, 4).map((w) => w.text).join('；'))
    const can = deps.motivation.motives({ body: b, mood: e.mood }).filter((m) => m.available).map((m) => m.label)
    if (can.length) parts.push('【能做的事】' + can.join('、'))
    if (s.boredom >= 0.5) parts.push('（有点无聊了）')
    const last = s.log.slice(0, 3).reverse().map((x) => x.thought)
    if (last.length) parts.push('【前几步在想】\n' + last.join('\n') + '\n（不要重复这几句：接着往下想一层，或者想到别的事上去）')
    return { text: parts.join('\n'), mood: e.mood }
  }

  /** 硬规则：要不要交给 DeepSeek 深想。 */
  function needsDeep(s, step) {
    const recent = [step, ...s.log.slice(0, 2)]
    const vals = recent.map((x) => (x.feel ? (emotionOf(x.feel.name)?.v ?? 0) * x.feel.intensity : 0))
    const spiral = recent.length === 3 && vals.every((v) => v < -0.1) && vals[0] <= vals[1] && vals[1] <= vals[2]
    const aboutOwner = /主人|他(?:是不是|会不会|为什么|怎么)|我们(?:之间|的关系)/.test(step.thought) && vals[0] < -0.1
    return spiral ? '越想越难受' : aboutOwner ? '涉及主人和你们的关系' : step.deep ? '小模型觉得要认真想' : ''
  }

  const DEEP_SYSTEM = () => `你是${deps.identity().name || '她'}，现在静下来认真想一件让你在意的事。下面是你刚才一连串的念头、此刻的感受和你记得的相关的事（标着是谁、什么时候）。
先把误会想清楚：别人到底说了什么、可能是什么意思；不确定的就承认不确定。只根据材料，不编事。
只输出 JSON：{"thought":"想明白后的一两句（第一人称）","feel":{"n":"情绪名","i":0到1,"reg":"reappraise 或 空"},"belief":"如果对自己或对某人有了新的看法，用「我觉得……」写一句；没有就空","want":"如果想去做什么就写；没有就空"}`

  async function deepThink(s, step, reason) {
    const day = new Date(now()).toISOString().slice(0, 10)
    if (s.deepToday.day !== day) s.deepToday = { day, n: 0 }
    if (!ask || !deps.budget.allow('deep', 3000)) return null
    const thoughts = [step, ...s.log.slice(0, 5)].reverse().map((x) => x.thought).join('\n')
    const recalled = await deps.memory.recall({ cue: step.thought, limit: 5, deliberate: true }).catch(() => [])
    const text = `【为什么要认真想】${reason}\n【刚才的念头】\n${thoughts}\n【想起来的】\n${recalled.map((m) => `- ${new Date(m.at).toISOString().slice(0, 10)} ${m.text}`).join('\n') || '（没有）'}\n${deps.body.describe()}`
    let out
    try {
      out = parseJson(await ask({ scene: 'deep', system: DEEP_SYSTEM(), text, maxTokens: 800 }))
    } catch (error) {
      log.debug('深想失败：', error.message)
      return null
    }
    if (!out) return null
    s.deepToday.n++
    if (out.feel?.n) deps.emotion.feel([{ name: out.feel.n, intensity: out.feel.i, reg: out.feel.reg, why: clip(out.thought, 30), importance: 0.6 }], { source: 'deep' })
    // 深想是 DeepSeek 认真想的：「我觉得……」可以记成她的看法（仍然只是看法，不是事实）
    if (out.belief && /^我觉得/.test(String(out.belief).trim())) deps.memory.insert({ at: now(), gist: clip(out.belief, 120), kind: 'belief', importance: 0.6, speaker: 'self', attention: 1 })
    if (out.want) deps.motivation.want(out.want, { strength: 0.6 })
    return { thought: clip(out.thought, 160), reason }
  }

  /**
   * 想一步。返回这一步（或 null：发呆、没模型、预算用完）。
   * 有本地小模型就用它；没有时用 DeepSeek（低思考深度），由外面拉长间隔。
   */
  async function step() {
    const s = load()
    const cue = s.log[0]?.thought || recentHappenings(0).lines.slice(-1)[0] || ''
    const recalled = cue ? await deps.memory.recall({ cue, limit: 2 }).catch(() => []) : []
    if (recalled.length) deps.memory.strengthen(recalled.map((m) => m.id)) // 想起来的旧事被加强
    const { text } = material(s, recalled)
    let out = null
    const messages = [{ role: 'system', content: SYSTEM() }, { role: 'user', content: text }]
    let by = 'local'
    if (local) out = await local.chat(messages, { maxTokens: 160, temperature: 0.95 })
    if (out === null && ask && A('thinkWithoutLocal') !== false && deps.budget.allow('think', 1500)) {
      by = 'deepseek'
      try { out = await ask({ scene: 'think', system: SYSTEM(), text, maxTokens: 300 }) } catch { out = null }
    }
    if (!out) return null
    const p = parseThought(out)
    if (!p.thought) return null
    const st = { at: now(), thought: p.thought, feel: p.feel, plan: p.plan, by }
    // 重复：和前几步很像 → 停下来放空，无聊感上升
    const repeated = s.log.slice(0, 3).some((x) => overlap(x.thought, p.thought) >= 0.7)
    s.boredom = clamp(s.boredom + (repeated ? 0.25 : -0.05))
    if (repeated) st.repeated = true
    // 只留感受和打算；念头本身只进内心日记，不进记忆
    if (p.feel && !repeated) deps.emotion.feel([{ name: p.feel.name, intensity: p.feel.intensity * 0.7, why: '想着想着', importance: 0.3 }], { source: 'thought' })
    if (p.plan && !repeated) {
      const target = /主人|找他|找你|跟他说|和他说/.test(p.plan) ? 'reach_owner' : ''
      deps.motivation.want(p.plan, { strength: 0.4, action: target })
    }
    const reason = repeated ? '' : needsDeep(s, st)
    if (reason) {
      const d = await deepThink(s, st, reason)
      if (d) st.deep = d
    }
    s.log.unshift(st)
    s.log = s.log.slice(0, 300)
    save(s)
    return st
  }

  /** 无聊感：闲得越久越高（每小时 +0.15，经验值），做了事、聊了天就降。 */
  function idleTick(minutes) {
    const s = load()
    s.boredom = clamp(s.boredom + 0.15 * minutes / 60)
    save(s)
    return s.boredom
  }
  function relieve(amount = 0.5) {
    const s = load()
    s.boredom = clamp(s.boredom - amount)
    save(s)
  }
  function diary(limit = 50) { return load().log.slice(0, limit) }
  function boredom() { return load().boredom }
  /** 聊天时自然提起「我刚才还在想……」：最近 30 分钟里最后一个念头。 */
  function lastThought() {
    const x = load().log[0]
    return x && now() - x.at < 30 * MIN && !x.repeated ? x : null
  }

  return { connect, step, idleTick, relieve, diary, boredom, lastThought, parseThought }
}
