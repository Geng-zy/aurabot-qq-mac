// 记忆：记住、忘记、想起、被改写、睡觉整理和做梦、删除重算。
// 规矩同心智核心：不引用 Aurabot；模型（think）、向量（embed）、心情和精力（state）都由外面注入。
// 设计见设计文档「记忆」一章。

import { createHash } from 'node:crypto'
import { retention, initialStability, afterRecall, levelOf } from './curve.js'
import { createVectorIndex } from './vectors.js'
import { estimateTokens } from '../budget.js'
import { zonedToEpoch, shortTime, dayKey } from '../clock.js'

const DAY = 86400000
const hash = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 16)
const clamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0))

/** 从模型的回答里取出第一个 JSON 对象。 */
export function parseJson(text) {
  const s = String(text || '')
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(s.slice(start, end + 1)) } catch { return null }
}

/** 经历的种类。 */
export const KINDS = {
  event: '经历',
  fact: '知道的事',
  hearsay: '听说的',
  belief: '我觉得',
  intention: '要做的事',
  semantic: '知道的事（整理出来的）',
  noted: '特意记下的',
  dream: '梦',
  experience: '经历',
  'own-post': '自己发过的',
  'day-summary': '那天的事',
}

/**
 * @param {{
 *   store: any,
 *   now: () => number,
 *   setting: (key: string) => any,
 *   identity: () => { name: string },
 *   person: (id: string) => any,
 *   recordDeletion: (id: string, kind: string) => void,
 *   budget: { allow: Function, charge: Function },
 *   tz: () => string,
 *   log?: any,
 *   random?: () => number,
 * }} deps
 */
export function createMemory(deps) {
  const { store, now, setting } = deps
  const log = deps.log || { debug() {}, info() {}, warn() {}, error() {} }
  const random = deps.random || Math.random
  const vectors = createVectorIndex(store)
  // 外面接进来的能力：想（模型）、算向量、此刻的心情和精力
  let think = null
  let embed = null
  let state = () => ({ valence: 0, energy: 1 })
  // 记经历时顺带问的（人格的状态记录、对人的看法）和收到结果后交给谁：由心智入口接上，记忆本身不认识它们
  let encodeExtra = () => ''
  let onEncoded = null
  function connect(o = {}) {
    if (o.think !== undefined) think = o.think
    if (o.embed !== undefined) embed = o.embed
    if (o.state !== undefined) state = o.state
    if (o.encodeExtra !== undefined) encodeExtra = o.encodeExtra
    if (o.onEncoded !== undefined) onEncoded = o.onEncoded
  }

  const S = (k) => setting('memory.' + k)
  const levels = () => ({ clear: S('levelClear'), vague: S('levelVague'), tip: S('levelTip'), strongCue: S('strongCue') })
  const embedModel = () => String(S('embedModel') || '')

  function row(id) {
    const r = store.prep('SELECT * FROM episodes WHERE id = ?').get(String(id))
    return r ? { ...r, data: JSON.parse(r.json) } : null
  }
  function save(e) {
    store.prep('UPDATE episodes SET gist = ?, detail = ?, strength = ?, stability = ?, last_recall = ?, status = ?, json = ? WHERE id = ?')
      .run(e.gist, e.detail ?? null, e.strength, e.stability, e.last_recall ?? null, e.status, JSON.stringify(e.data || {}), e.id)
  }
  /** 此刻记得多少：从最后一次想起（没有就从发生时）算起。 */
  function rOf(e, at = now()) {
    return retention(e.stability, at - (e.last_recall || e.at || at), S('forgetting'))
  }

  // ---------- 模型调用（带预算） ----------
  async function ask(scene, system, text, maxTokens = 1200) {
    if (!think) throw new Error('没接模型')
    const est = estimateTokens(system) + estimateTokens(text) + maxTokens
    if (!deps.budget.allow(scene, est)) {
      const e = new Error('今天的后台预算用完了')
      e.code = 'BUDGET'
      throw e
    }
    const r = await think({ scene, system, text, maxTokens })
    const out = typeof r === 'string' ? r : String(r?.text || '')
    const used = typeof r === 'object' && r?.tokens ? r.tokens : estimateTokens(system) + estimateTokens(text) + estimateTokens(out)
    deps.budget.charge(scene, used)
    return out
  }

  // ---------- 向量 ----------
  async function embedEpisodes(ids) {
    const list = ids.map(row).filter(Boolean).filter((e) => !vectors.has(e.id, embedModel()))
    if (!list.length || !embed) {
      for (const e of list) queueJob('embed', e.id)
      return 0
    }
    try {
      const vs = await embed(list.map((e) => e.gist))
      list.forEach((e, i) => vectors.put(e.id, embedModel(), vs[i], hash(e.gist)))
      return list.length
    } catch (error) {
      log.debug('算向量失败，稍后再算：', error.message)
      for (const e of list) queueJob('embed', e.id)
      return 0
    }
  }
  async function embedText(text, timeoutMs = 4000) {
    if (!embed || !String(text || '').trim()) return null
    try {
      const r = await Promise.race([embed([text]), new Promise((_, rej) => setTimeout(() => rej(new Error('超时')), timeoutMs))])
      return r[0] || null
    } catch (error) {
      log.debug('线索算向量失败：', error.message)
      return null
    }
  }

  // ---------- 后台任务 ----------
  function queueJob(kind, ref, data = {}) {
    store.prep('INSERT OR IGNORE INTO jobs (kind, at, ref, json) VALUES (?, ?, ?, ?)').run(kind, now(), ref ? String(ref) : null, JSON.stringify(data))
  }
  function takeJobs(kind, limit = 50) {
    return store.prep('SELECT id, ref, json FROM jobs WHERE kind = ? ORDER BY id LIMIT ?').all(kind, limit).map((j) => ({ id: j.id, ref: j.ref, data: JSON.parse(j.json) }))
  }
  function doneJob(id) {
    store.prep('DELETE FROM jobs WHERE id = ?').run(id)
  }

  // ---------- 新增一段经历 ----------
  function insert({ id, at, window, gist, detail, kind, importance = 0.5, emotion = null, about = '', speaker = '', who = [], sources = [], due = null, attention = 1, extra = {} }) {
    const st = state() || {}
    const stability = initialStability({
      base: S('baseStability'),
      intensity: emotion?.intensity || 0,
      importance,
      attention,
      energy: st.energy ?? 1,
      emotionBoost: S('emotionBoost'),
    })
    const data = { kind, importance: clamp01(importance), emotion, about, speaker, who, sources, ...(due ? { due } : {}), moodAtEncoding: st.valence ?? 0, hits: 0, ...extra }
    const eid = id || 'm:' + hash([at, window, gist, random()].join('|'))
    store.prep('INSERT OR IGNORE INTO episodes (id, at, window, gist, detail, strength, stability, last_recall, status, json) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)')
      .run(eid, at, window || null, String(gist), detail ? String(detail) : null, clamp01(importance), stability, 'live', JSON.stringify(data))
    return eid
  }

  // ---------- 记住：一段聊天结束后记下来 ----------
  function cursorOf(window) {
    return Number(store.get('encode.cursor.' + window, 0)) || 0
  }
  /** 有新消息还没记的窗口。 */
  function pendingWindows() {
    const rows = store.prep('SELECT window, MAX(id) AS last, MAX(at) AS lastAt FROM perception GROUP BY window').all()
    return rows.filter((r) => r.last > cursorOf(r.window)).map((r) => ({ window: r.window, lastAt: r.lastAt }))
  }

  const ENCODE_SYSTEM = (name) => `你是${name || '她'}自己的记忆。下面是${name || '她'}刚经历的一段聊天（“你”就是${name || '她'}）。把值得记住的事记下来，像人一样只记要紧的，闲聊里没意思的不记。

规矩：
- 别人说的关于他自己的事，才算 fact（about 和 speaker 是同一个人）；A 说 B 的事，记成 hearsay。
- 你自己的猜测、看法记成 belief，gist 用“我觉得……”开头，不要当成事实。
- 你答应要做、或者打算做的事记成 intention，能看出时间就填 due（格式 YYYY-MM-DD HH:mm，按聊天里的时间），看不出就填 null。
- 别人说到他自己一件还没结果、他在意的事（面试、考试、体检、等录取或通知、比赛、看病、搬家……）记成 pending，about 和 speaker 都是他，due 填结果大概出来的时间（看不出就填 null）。
- 其他经历记成 event。
- 只记聊天里真有的内容，不要补充、不要编。
- gist 一句话大意；detail 补充细节（谁、说了什么、怎么回事），可以空。
- importance 0~1：对你来说多重要（和你在乎的人和事越相关越高）。
- emotion：你当时的感受，name 用一个词，intensity 0~1，valence -1~1（负面到正面）；没什么感觉就 null。
- who：涉及的人的 id 列表（行首方括号里的 id）。about：这件事主要关于谁（id），speaker：这件事是谁说的（id，你自己是 self）。
- sources：依据的行号。
- secret：有人明说“别告诉别人”“只跟你说”的事填 true，否则不写。

只输出 JSON：{"episodes":[{"type":"event|fact|hearsay|belief|intention|pending","gist":"","detail":"","importance":0.5,"emotion":{"name":"","intensity":0.5,"valence":0},"who":[],"about":"","speaker":"","due":null,"sources":[1]}]}；没有值得记的就输出 {"episodes":[]}。`

  /**
   * 把一个窗口里还没记的消息记成经历。
   * force=false 时只在窗口停了 encodeIdleMinutes 以后才记（一段聊天结束了才记）。
   */
  async function encodeWindow(window, { force = false } = {}) {
    const tz = deps.tz()
    const cursor = cursorOf(window)
    const batch = Number(S('encodeBatch')) || 60
    const rows = store.prep('SELECT id, at, who, dir, text, json FROM perception WHERE window = ? AND id > ? ORDER BY id LIMIT ?').all(window, cursor, batch)
    if (!rows.length) return { encoded: 0 }
    const last = rows[rows.length - 1]
    const idle = now() - last.at >= (Number(S('encodeIdleMinutes')) || 5) * 60000
    if (!force && !idle && rows.length < batch) return { encoded: 0, waiting: true }
    const name = deps.identity().name
    const fmt = (t) => dayKey(t, tz) + ' ' + shortTime(t, tz).slice(6)
    const lines = rows.map((r, i) => {
      const j = JSON.parse(r.json || '{}')
      const who = r.dir === 'out' ? 'self' : r.who
      const nick = r.dir === 'out' ? '你' : (j.name || deps.person(r.who)?.name || r.who)
      return `${i + 1}. ${fmt(r.at)} [${who}] ${nick}：${String(r.text).replace(/\s+/g, ' ').slice(0, 300)}`
    })
    let parsed
    try {
      let extra = ''
      try { extra = String(encodeExtra() || '') } catch {}
      const system = ENCODE_SYSTEM(name) + (extra ? '\n\n' + extra + '\n这几项和 episodes 放在同一个 JSON 对象里。' : '')
      parsed = parseJson(await ask('record', system, `聊天：${window}\n${lines.join('\n')}`, extra ? 2500 : 1500))
    } catch (error) {
      if (error.code === 'BUDGET') return { encoded: 0, budget: true }
      throw error
    }
    // 她在这段里说过话就是专心在聊；只是在群里看着，记得浅一些
    const attention = rows.some((r) => r.dir === 'out') ? 1 : 0.6
    const ids = []
    store.tx(() => {
      for (const ep of Array.isArray(parsed?.episodes) ? parsed.episodes : []) {
        const gist = String(ep?.gist || '').trim()
        if (!gist) continue
        const src = (Array.isArray(ep.sources) ? ep.sources : []).map((n) => rows[Number(n) - 1]).filter(Boolean)
        let type = ['event', 'fact', 'hearsay', 'belief', 'intention', 'pending'].includes(ep.type) ? ep.type : 'event'
        const about = String(ep.about || '')
        const speaker = String(ep.speaker || '')
        // 别人说的事实只认他自己的原话
        if (type === 'fact' && about && speaker && about !== speaker && speaker !== 'self') type = 'hearsay'
        // 惦记的事只认本人说的自己的事；不是的话当普通的事 / 听说的事
        if (type === 'pending' && (!about || about === 'self' || (speaker && speaker !== about))) type = about && about !== 'self' && speaker && speaker !== about ? 'hearsay' : 'fact'
        const emo = ep.emotion && typeof ep.emotion === 'object' && ep.emotion.name
          ? { name: String(ep.emotion.name), intensity: clamp01(ep.emotion.intensity), valence: Math.max(-1, Math.min(1, Number(ep.emotion.valence) || 0)) }
          : null
        let due = null
        if ((type === 'intention' || type === 'pending') && ep.due) {
          due = zonedToEpoch(ep.due, tz)
        }
        const at = src.length ? src[0].at : rows[0].at
        // 惦记的事：结果出来的时候再问（看不出来、或者说的时间不靠谱，就两天后）
        const follow = type === 'pending' ? { followup: { asks: 0, nextAt: due && due > at && due < at + 60 * DAY ? due : at + 2 * DAY } } : {}
        ids.push(insert({
          at, window, gist, detail: String(ep.detail || '').trim(), kind: type,
          importance: ep.importance ?? 0.5, emotion: emo, about, speaker,
          who: Array.isArray(ep.who) ? ep.who.map(String) : [],
          sources: src.map((r) => r.id), due, attention,
          extra: { ...(ep.secret === true ? { secret: true } : {}), ...follow },
        }))
      }
      store.set('encode.cursor.' + window, last.id)
    })
    if (onEncoded) {
      try { onEncoded({ window, rows, parsed }) } catch (error) { log.warn('记经历后的状态记录出错：', error.message) }
    }
    await embedEpisodes(ids)
    return { encoded: ids.length, ids }
  }

  /** 所有停下来了的窗口都记一遍（force 时不等）。 */
  async function encodePending({ force = false } = {}) {
    let n = 0
    for (const w of pendingWindows()) {
      try {
        for (let i = 0; i < 20; i++) {
          const r = await encodeWindow(w.window, { force })
          n += r.encoded || 0
          if (!r.encoded && (r.waiting || r.budget || cursorOf(w.window) >= (store.prep('SELECT MAX(id) AS m FROM perception WHERE window = ?').get(w.window).m || 0))) break
        }
      } catch (error) {
        log.warn(`记 ${w.window} 失败：`, error.message)
      }
    }
    return n
  }

  // ---------- 想起 ----------
  /**
   * 按线索想起。
   * @param {{ cue: string, window?: string, people?: string[], limit?: number, deliberate?: boolean }} q
   *   deliberate：她自己在使劲想（翻记忆），线索门槛放低一点。
   */
  /**
   * period：{ start, end } 只想这段时间里的事（end 不含）。线索空着就按重要程度列这段时间的事。
   */
  async function recall({ cue, window = '', people = [], limit = Number(S('recallLimit')) || 6, deliberate = false, period = null } = {}) {
    if (!limit) return []
    const at = now()
    const inPeriod = (e) => !period || (e.at >= period.start && e.at < period.end)
    const st = state() || {}
    const cueMatch = Number(S('cueMatch')) * (deliberate ? 0.85 : 1)
    const cand = new Map() // id → sim
    // 只给了时间没给线索：这段时间里的事都算线索，按重要程度排
    if (period && !String(cue || '').trim()) {
      for (const r of store.prep("SELECT id, json FROM episodes WHERE status = 'live' AND at >= ? AND at < ? ORDER BY at DESC LIMIT 200").all(period.start, period.end)) {
        let imp = 0.4
        try { imp = Number(JSON.parse(r.json).importance) || 0.4 } catch {}
        cand.set(r.id, cueMatch + 0.2 * imp)
      }
    }
    const qv = String(cue || '').trim() ? await embedText(cue) : null
    if (qv) for (const h of vectors.search(qv, { model: embedModel(), limit: period ? 200 : 80, min: cueMatch * 0.8 })) cand.set(h.id, h.sim)
    // 关键词（三个字以上才能用 trigram）
    const words = String(cue || '').split(/[\s，。！？、,.!?：:；;“”"'（）()【】\[\]]+/).filter((w) => [...w].length >= 3).slice(0, 6)
    for (const w of words) {
      try {
        for (const r of store.prep('SELECT e.id FROM episodes_fts f JOIN episodes e ON e.rowid = f.rowid WHERE episodes_fts MATCH ? LIMIT 20').all('"' + w.replace(/"/g, '""') + '"')) {
          cand.set(r.id, Math.max(cand.get(r.id) || 0, deliberate ? cueMatch : cueMatch * 0.95))
        }
      } catch {}
    }
    // 眼前的人也是线索：关于他们的事
    for (const p of people) {
      for (const r of store.prep("SELECT id FROM episodes WHERE status = 'live' AND json LIKE ? ORDER BY at DESC LIMIT 10").all(`%"about":"${p.replace(/[%_"]/g, '')}"%`)) {
        cand.set(r.id, Math.max(cand.get(r.id) || 0, cueMatch * 0.9))
      }
    }
    const scored = []
    for (const [id, sim] of cand) {
      const e = row(id)
      if (!e || e.status !== 'live') continue
      if (!inPeriod(e)) continue
      if (e.data.kind === 'intention' && e.data.done) continue
      const r = rOf(e, at)
      const level = levelOf(r, sim, levels())
      if (!level) continue
      let score = sim
      if (window && e.window === window) score += Number(S('contextBonus'))
      if (people.includes(e.data.about)) score += Number(S('contextBonus'))
      const ev = e.data.emotion?.valence || 0
      score += Number(S('moodCongruence')) * (st.valence || 0) * ev
      if (sim < cueMatch && score < cueMatch) continue
      scored.push({ e, r, sim, level, score: score * (0.5 + 0.5 * r) })
    }
    scored.sort((a, b) => b.score - a.score)
    const top = scored.slice(0, limit)
    // 联想（扩散激活）：从最相关的两条出发，顺着联系往下想几步；离得越远越淡，太淡的想不起来。
    // 不限在哪个聊天（群里也能想到私聊里的事），说不说由工作记忆里的分寸提醒管。按日期查的时候不联想。
    if (top.length && S('assoc') !== false && !period) {
      const hops = Math.max(1, Math.min(3, Number(S('assocHops')) || 2))
      const cap = Math.max(0, Math.min(5, Number(S('assocLimit') ?? 2)))
      const decay = Math.max(0.3, Math.min(0.9, Number(S('assocDecay')) || 0.6))
      const seen = new Set(top.map((x) => x.e.id))
      const found = []
      let frontier = top.filter((x) => x.level !== 'tip').slice(0, 2).map((x) => ({ id: x.e.id, act: 1 }))
      const linksOf = store.prep('SELECT b AS id, weight FROM links WHERE a = ? UNION SELECT a AS id, weight FROM links WHERE b = ? ORDER BY weight DESC LIMIT 4')
      for (let hop = 1; hop <= hops && frontier.length && found.length < cap; hop++) {
        const next = []
        for (const f of frontier) {
          for (const l of linksOf.all(f.id, f.id)) {
            if (seen.has(l.id)) continue
            const act = f.act * Math.max(0, Math.min(1, Number(l.weight) || 0)) * decay
            if (act < 0.2) continue
            const e = row(l.id)
            if (!e || e.status !== 'live' || (e.data.kind === 'intention' && e.data.done)) continue
            seen.add(l.id)
            const r = rOf(e, at)
            let level = levelOf(r, 1, levels())
            if (!level || level === 'tip') continue
            // 想得越远越淡：两步以外的只记得个大概
            if (hop >= 2 && level === 'clear') level = 'vague'
            next.push({ id: l.id, act })
            found.push({ e, r, sim: act, level, score: 0, associated: true, hop })
          }
        }
        frontier = next.sort((a, b) => b.act - a.act).slice(0, 3)
      }
      found.sort((a, b) => a.hop - b.hop || b.sim - a.sim)
      top.push(...found.slice(0, cap))
    }
    return top.map(({ e, r, level, associated, hop }) => ({ id: e.id, at: e.at, window: e.window, kind: e.data.kind, level, r, associated: Boolean(associated), hop: hop || 0, text: render(e, level), emotion: e.data.emotion || null, target: e.data.about || '', secret: Boolean(e.data.secret) }))
  }

  /** 按想起的清楚程度给出她脑子里的样子。 */
  function render(e, level) {
    const tag = KINDS[e.data.kind] && e.data.kind !== 'event' && e.data.kind !== 'experience' ? `（${KINDS[e.data.kind]}）` : ''
    if (level === 'clear') return `${e.gist}${e.detail ? '——' + e.detail : ''}${tag}`
    if (level === 'vague') return `好像有这么回事：${e.gist}${tag}`
    // 话到嘴边：只想起前一半
    const chars = [...e.gist]
    return `${chars.slice(0, Math.max(4, Math.ceil(chars.length * 0.4))).join('')}……（一下想不全）`
  }

  /** 想起来的被加强；隔得越久想起，加得越多。按设置的概率排进睡觉时的改写。 */
  function strengthen(ids) {
    const at = now()
    store.tx(() => {
      for (const id of ids) {
        const e = row(id)
        if (!e) continue
        const r = rOf(e, at)
        e.stability = afterRecall(e.stability, r, Number(S('spacingBonus')))
        e.last_recall = at
        e.data.hits = (e.data.hits || 0) + 1
        save(e)
        const p = Number(S('reconsolidation')) || 0
        if (p > 0 && random() < p && !['intention', 'dream'].includes(e.data.kind)) {
          queueJob('reconsolidate', id, { mood: (state() || {}).valence || 0, at })
        }
      }
    })
  }

  // ---------- 惦记别人的事 ----------
  /**
   * 到时候该问一问的事：这几个人的、没放下的、还没问够的、到了该问的时间的。
   * deps.care(人) 0～1：她有多在乎这个人（心疼人的程度 + 亲近），决定问不问、问几次、隔多久。
   */
  function pendingRows() {
    return store.prep("SELECT * FROM episodes WHERE status = 'live' AND json LIKE '%\"kind\":\"pending\"%' ORDER BY at DESC LIMIT 200").all()
      .map((r) => ({ ...r, data: JSON.parse(r.json) }))
  }
  function dueFollowups({ people = [], limit = 2 } = {}) {
    if (S('followup') === false || !people.length) return []
    const at = now()
    const out = []
    for (const e of pendingRows()) {
      const f = e.data.followup
      if (!f || f.done || !people.includes(e.data.about)) continue
      const care = Math.max(0, Math.min(1, Number(deps.care?.(e.data.about) ?? 0.5)))
      if (care < 0.3) continue // 不熟、她又不特别心疼人的：不追问
      const max = Math.max(1, Math.round((Number(S('followupMaxAsks')) || 3) * (0.4 + 0.6 * care)))
      if (f.asks >= max || f.nextAt > at) continue
      out.push({ e, care })
      if (out.length >= limit) break
    }
    return out
  }
  /** 这件事她提过一次了：往后推（越在乎隔得越短）。 */
  function markAsked(e, care = 0.5) {
    const gap = (Number(S('followupGapDays')) || 2) * (1.5 - care) * DAY
    e.data.followup = { ...e.data.followup, asks: (e.data.followup?.asks || 0) + 1, nextAt: now() + gap, lastAt: now() }
    save(e)
  }
  /** 有结果了 / 对方说别问了 / 主人在面板里取消：放下。 */
  function closeFollowup(id, why = 'done') {
    const e = row(id)
    if (!e || e.data.kind !== 'pending') return false
    e.data.followup = { ...(e.data.followup || {}), done: now(), why }
    save(e)
    return true
  }
  /** 还惦记着的（面板用）：某个人的，或者全部。 */
  function followups({ person: pid = '', all = false } = {}) {
    return pendingRows()
      .filter((e) => (all || !e.data.followup?.done) && (!pid || e.data.about === pid))
      .map((e) => ({ id: e.id, at: e.at, gist: e.gist, about: e.data.about, due: e.data.due || null, asks: e.data.followup?.asks || 0, nextAt: e.data.followup?.nextAt || 0, done: e.data.followup?.done || 0 }))
  }

  // ---------- 工作记忆 ----------
  /** 到期或快到期的要做的事（前瞻记忆）。 */
  function dueIntentions({ window = '', within = 2 * 3600000 } = {}) {
    const at = now()
    return store.prep("SELECT * FROM episodes WHERE status = 'live' AND json LIKE '%\"kind\":\"intention\"%' ORDER BY at DESC LIMIT 50").all()
      .map((r) => ({ ...r, data: JSON.parse(r.json) }))
      // 到期或快到期的；过期三天还没做的慢慢就不惦记了（还在记忆里，只是不再每轮提醒）
      .filter((e) => !e.data.done && (!e.data.due || (e.data.due <= at + within && e.data.due >= at - 3 * DAY)) && (!window || !e.window || e.window === window || e.data.due))
      .slice(0, 5)
  }
  function completeIntention(id) {
    const e = row(id)
    if (!e || e.data.kind !== 'intention') return false
    e.data.done = now()
    save(e)
    return true
  }

  /**
   * 这一轮的工作记忆：想起来的事 + 惦记着的要做的事，按字数上限裁。
   * 想起来的会被加强（她真的想起来了）。
   */
  async function workingMemory({ cue, window, people = [], readOnly = false } = {}) {
    const max = Number(S('workingChars')) || 1800
    const got = await recall({ cue, window, people })
    const lines = []
    let total = 0
    const used = []
    for (const m of got) {
      const when = dayKey(m.at, deps.tz())
      // 分寸：秘密、别处私聊里的事，提醒她是在哪听来的
      const elsewhere = m.window && window && m.window !== window
      const note = m.secret ? (elsewhere ? '（这是别人私下跟你说的秘密，别在这里说）' : '（秘密，别往外说）') : elsewhere && /:private:/.test(m.window) && !/:private:/.test(window) ? '（私聊里的事，在群里说之前想想合不合适）' : ''
      const line = `- ${when} ${m.associated ? '（由此想到）' : ''}${m.text}${note}`
      if (total + line.length > max) break
      total += line.length
      lines.push(line)
      used.push(m.id)
    }
    const todo = dueIntentions({ window }).map((e) => `- ${e.gist}${e.data.due ? `（${shortTime(e.data.due, deps.tz())} 前）` : ''}`)
    // 在场的人有到了该问的事：提一句，问过就往后推（调试模式只看不推）
    const follow = dueFollowups({ people })
    if (!readOnly) for (const { e, care } of follow) markAsked(e, care)
    const asks = follow.map(({ e }) => `- ${dayKey(e.at, deps.tz())} ${deps.person?.(e.data.about)?.name || String(e.data.about).replace(/^qq:/, '')}：${e.gist}`)
    // readOnly（调试模式）：只想起来，不加强、不重新点燃情绪，不留下痕迹
    if (used.length && !readOnly) {
      strengthen(used)
      // 想起带着情绪的事，当时的情绪会重新冒出来一点
      try { deps.onRecalled?.(got.filter((m) => used.includes(m.id) && m.level !== 'tip'), { window }) } catch {}
    }
    const parts = []
    if (lines.length) parts.push('【你想起来的】\n' + lines.join('\n'))
    if (todo.length) parts.push('【你惦记着要做的事】\n' + todo.join('\n'))
    if (asks.length) parts.push('【你惦记着别人的事，还不知道结果】\n' + asks.join('\n') + '\n（聊到合适的时候自然地问一句，不合适就别硬问；知道结果了或者对方说别问了，就用 mind_followup_done 放下）')
    return { text: parts.join('\n'), recalled: used }
  }

  // ---------- 她特意记下来 ----------
  async function remember({ text, window = '', about = '', importance = 0.8 } = {}) {
    const gist = String(text || '').trim()
    if (!gist) throw new Error('要记的内容是空的')
    const qv = await embedText(gist)
    if (qv) {
      const hit = vectors.search(qv, { model: embedModel(), limit: 1, min: 0.9 })[0]
      if (hit) {
        const e = row(hit.id)
        if (e && e.status !== 'deleted') {
          if (e.status === 'archived') { e.status = 'live'; save(e) }
          strengthen([e.id])
          return { id: e.id, merged: true }
        }
      }
    }
    const id = insert({ at: now(), window, gist, kind: 'noted', importance, about, speaker: 'self', attention: 1 })
    if (qv) vectors.put(id, embedModel(), qv, hash(gist))
    else queueJob('embed', id)
    return { id, merged: false }
  }

  // ---------- 删除和重算 ----------
  /** 主人删一条：连同向量、联系一起删，记进删除记录；由它整理出来的「知道的事」重算。 */
  function deleteEpisode(id, { record = true } = {}) {
    const e = row(id)
    if (!e) return false
    store.tx(() => removeOne(e, record))
    return true
  }
  function removeOne(e, record) {
    store.prep('DELETE FROM episodes WHERE id = ?').run(e.id)
    vectors.remove(e.id)
    store.prep('DELETE FROM links WHERE a = ? OR b = ?').run(e.id, e.id)
    store.prep('DELETE FROM jobs WHERE ref = ?').run(e.id)
    if (record) deps.recordDeletion(e.id, 'episode')
    // 由它整理出来的知道的事：来源都没了就一起删，还有别的来源就排进重算
    for (const r of store.prep("SELECT * FROM episodes WHERE json LIKE ?").all(`%"derivedFrom":%${e.id.replace(/[%_"]/g, '')}%`)) {
      const f = { ...r, data: JSON.parse(r.json) }
      const left = (f.data.derivedFrom || []).filter((x) => x !== e.id)
      if (!left.length) removeOne(f, record)
      else {
        f.data.derivedFrom = left
        f.data.needsRecompute = true
        save(f)
        queueJob('recompute', f.id)
      }
    }
  }
  /** 从备份恢复后，把恢复前删掉的再删一遍。 */
  function applyDeletions(list) {
    let n = 0
    store.tx(() => {
      for (const d of list || []) {
        if (d.kind !== 'episode') continue
        const e = row(d.id)
        if (e) { removeOne(e, false); n++ }
        store.prep('INSERT OR REPLACE INTO deletions (id, kind, at) VALUES (?, ?, ?)').run(String(d.id), 'episode', Number(d.at) || now())
      }
    })
    return n
  }
  /** 主人加强一条（归档的也会回来）。 */
  function boost(id, factor = 2) {
    const e = row(id)
    if (!e) return false
    e.stability = Math.max(e.stability * factor, Number(S('baseStability')) * 2)
    e.last_recall = now()
    if (e.status === 'archived') e.status = 'live'
    save(e)
    return true
  }

  /**
   * 群里的话题和她的记忆有多相关（0～1，同步、只查本地全文索引，插话判断用）。
   * 只算她还记得的（没归档的）；三个字以上的词才能查。
   */
  function topicScore(text) {
    const words = [...new Set(String(text || '').split(/[\s，。！？、,.!?：:；;“”"'（）()【】\[\]@]+/).filter((w) => [...w].length >= 3))].slice(0, 12)
    if (!words.length) return 0
    let hit = 0
    for (const w of words) {
      try {
        const r = store.prep("SELECT 1 FROM episodes_fts f JOIN episodes e ON e.rowid = f.rowid WHERE episodes_fts MATCH ? AND e.status = 'live' LIMIT 1").get('"' + w.replace(/"/g, '""') + '"')
        if (r) hit++
      } catch {}
    }
    return Math.min(1, hit / Math.min(words.length, 4))
  }

  // ---------- 给面板看 ----------
  /** 面板：按状态、种类、关键字列出（关键字在大意、细节和原始记录里找）。 */
  function list({ status = 'live', limit = 100, offset = 0, kind, q = '' } = {}) {
    const at = now()
    const like = (x) => '%' + String(x).replace(/[%_\\]/g, (c) => '\\' + c) + '%'
    const where = ['status = ?']
    const args = [status]
    if (kind) { where.push('json LIKE ?'); args.push(`%"kind":"${String(kind).replace(/[%_"]/g, '')}"%`) }
    if (q) { where.push("(gist LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\' OR json LIKE ? ESCAPE '\\')"); args.push(like(q), like(q), like(q)) }
    const rows = store.prep(`SELECT * FROM episodes WHERE ${where.join(' AND ')} ORDER BY at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset)
    return rows.map((r) => {
      const e = { ...r, data: JSON.parse(r.json) }
      const rv = rOf(e, at)
      return { id: e.id, at: e.at, window: e.window, gist: e.gist, detail: e.detail, kind: e.data.kind, r: rv, level: levelOf(rv, 1, levels()), stability: e.stability, original: e.data.original || null, emotion: e.data.emotion || null }
    })
  }
  function counts() {
    return Object.fromEntries(store.prep('SELECT status, COUNT(*) AS n FROM episodes GROUP BY status').all().map((r) => [r.status, r.n]))
  }

  return {
    connect, encodeWindow, encodePending, pendingWindows, recall, strengthen, workingMemory,
    dueIntentions, completeIntention, dueFollowups, closeFollowup, followups, remember, topicScore, deleteEpisode, applyDeletions, boost, list, counts,
    embedEpisodes, queueJob, takeJobs, doneJob, ask, row, save, rOf, vectors, insert,
  }
}
