// 记忆：记住、忘记、想起、被改写、睡觉整理和做梦、删除重算。
// 规矩同心智核心：不引用 Aurabot；模型（think）、向量（embed）、心情和精力（state）都由外面注入。
// 设计见设计文档「记忆」一章。

import { createHash, randomUUID } from 'node:crypto'
import { retention, initialStability, afterRecall, levelOf } from './curve.js'
import { createVectorIndex } from './vectors.js'
import { estimateTokens } from '../budget.js'
import { zonedToEpoch, shortTime, dayKey, localParts, parseBirthday } from '../clock.js'
import { placeOf, shortId } from '../place.js'
import { keywords } from './words.js'
import { createKeywordHits } from './keywords.js'
import { createRecall } from './recall.js'
import { createVisibility } from './visibility.js'
import { createRender } from './render.js'
import { createStrengthen } from './strengthen.js'
import { createFollowups } from './followups.js'
import { createEncodePending } from './encode-pending.js'
import { createEncodingState } from './encoding-state.js'
import { createEncodeBatch } from './encode-batch.js'
import { createPrivacyText } from './privacy-text.js'

import { anchorDates, relativeDayWords, pendingLabel, parseJson, KINDS } from './text.js'
export { parseJson, KINDS } from './text.js'
const DAY = 86400000
const hash = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 16)
const clamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0))

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
  const place = deps.place || placeOf
  const nameOf = (pid) => deps.nameOf?.(pid) || deps.person?.(pid)?.name || shortId(pid)
  const vectors = createVectorIndex(store)
  // 外面接进来的能力：想（模型）、算向量、此刻的心情和精力
  let think = null
  let embed = null
  let embeddingIdentity = null
  let embeddingReady = null
  let rerank = null
  let state = () => ({ valence: 0, energy: 1 })
  // 记经历时顺带问的（人格的状态记录、对人的看法）和收到结果后交给谁：由心智入口接上，记忆本身不认识它们
  let encodeExtra = () => ''
  let onEncoded = null
  function connect(o = {}) {
    if (o.think !== undefined) think = o.think
    if (o.embed !== undefined) embed = o.embed
    if (o.embeddingIdentity !== undefined) embeddingIdentity = o.embeddingIdentity
    if (o.embeddingReady !== undefined) embeddingReady = o.embeddingReady
    if (o.rerank !== undefined) rerank = o.rerank
    if (o.state !== undefined) state = o.state
    if (o.encodeExtra !== undefined) encodeExtra = o.encodeExtra
    if (o.onEncoded !== undefined) onEncoded = o.onEncoded
  }

  const S = (k) => setting('memory.' + k)
  const levels = () => ({ clear: S('levelClear'), vague: S('levelVague'), tip: S('levelTip'), strongCue: S('strongCue') })
  const embedModel = () => String(embeddingIdentity?.() ?? S('embedModel') ?? '')

  function row(id) {
    const r = store.prep('SELECT * FROM episodes WHERE id = ?').get(String(id))
    return r ? { ...r, data: JSON.parse(r.json) } : null
  }
  const privacyText = createPrivacyText({
    store, deps, place, getOwnerPrivate: () => ownerPrivate, getTouchAudience: () => touchAudience,
  })
  const { publicQuote, notePrivacyContext } = privacyText
  const visibility = createVisibility({
    store, deps, place, row, S, publicSourceLines: privacyText.publicSourceLines,
    hasPrivateCue: privacyText.hasPrivateCue,
    privateContext: privacyText.privateContext,
    compact: privacyText.compact,
    getJointExperience: () => privacyText.jointExperience,
    anchorDates, relativeDayWords,
  })
  const { ownerPrivate, shareSourceAllowed, hasSecretScope, audienceRevision, touchAudience, visibleIn, sourceVisible, originalLines, visibleOriginalLines, sourceDay, memorySummary, protectedText, sharedText, sharesIn, restrictedShareText } = visibility

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
    const finish = deps.budget.reserve(scene, est)
    if (!finish) {
      const e = new Error('今天的后台预算用完了')
      e.code = 'BUDGET'
      e.budgetEstimate = est
      throw e
    }
    try {
      const r = await think({ scene, system, text, maxTokens })
      const out = typeof r === 'string' ? r : String(r?.text || '')
      const used = typeof r === 'object' && r?.tokens ? r.tokens : estimateTokens(system) + estimateTokens(text) + estimateTokens(out)
      finish(used)
      return out
    } finally { finish() }
  }

  // ---------- 向量 ----------
  async function embedEpisodes(ids) {
    const model = embedModel()
    const list = ids.map(row).filter(Boolean).filter((e) => !vectors.has(e.id, model))
    if (!list.length || !canEmbed()) {
      for (const e of list) queueJob('embed', e.id)
      return 0
    }
    try {
      const vs = await embed(list.map((e) => e.gist))
      let written = 0
      if (embedModel() !== model) return written
      list.forEach((e, i) => {
        if (row(e.id)?.gist !== e.gist || !vs[i]?.length) return
        vectors.put(e.id, model, vs[i], hash(e.gist))
        written++
      })
      return written
    } catch (error) {
      log.debug('算向量失败，稍后再算：', error.message)
      for (const e of list) if (row(e.id)) queueJob('embed', e.id)
      return 0
    }
  }
  async function embedText(text, timeoutMs = 4000) {
    if (!canEmbed() || !String(text || '').trim()) return null
    let timer
    try {
      const model = embedModel()
      const r = await Promise.race([embed([text], { query: true }), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('超时')), timeoutMs) })])
      return model === embedModel() ? r[0] || null : null
    } catch (error) {
      log.debug('线索算向量失败：', error.message)
      return null
    } finally { clearTimeout(timer) }
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
    // 不管从哪来的（聊天、整理出来的、梦、模块交来的）都要有向量，才能按意思想起来；算过的会自动跳过
    queueJob('embed', eid)
    return eid
  }

  // ---------- 记住：一段聊天结束后记下来 ----------
  const { cursorOf, pendingThrough, encodeThrough, pendingWindows } = createEncodingState({ store, encodeWindow })

  // 只有清楚属于日常公共话题、能逐字对回来源的片段，才可以从管理员私聊另存一份可分享摘要。
  const ENCODE_SYSTEM = (name) => `你是${name || '她'}自己的记忆。下面是${name || '她'}刚经历的一段聊天（“你”就是${name || '她'}）。把值得记住的事记下来，像人一样只记要紧的，闲聊里没意思的不记。

规矩：
- 别人说的关于他自己的事，才算 fact（about 和 speaker 是同一个人）；A 说 B 的事，记成 hearsay。
- 你自己的猜测、看法记成 belief，gist 用“我觉得……”开头，不要当成事实。
- 你答应要做、或者打算做的事记成 intention，能看出时间就填 due（格式 YYYY-MM-DD HH:mm，按聊天里的时间），看不出就填 null。
- 别人亲口说到他自己一件还没结果、他在意的事（面试、考试、体检、等录取或通知、比赛、看病、搬家……）记成 pending，about 和 speaker 都是他，due 填结果大概出来的时间（看不出就填 null）。区分担心、打算、已经提交和已有结果，对方问「能退吗」只说明在问可不可以，不能记成已经申请或有一笔退款在处理。
- 别人说到的生日、纪念日这类每年都会再来的日子，记成 date：yearly 填 MM-DD，about 是谁的（你自己的填 self），gist 写清是什么日子。
- 其他经历记成 event。
- 只记聊天里真有的内容，不要补充、不要编。
- gist 一句话大意；detail 补充细节（谁、说了什么、怎么回事），可以空。
- 摘要里的今天、昨天、明天等按对应原话的日期换成 YYYY-MM-DD。日期无法核对时省略，别把说话日期直接当事件日期。引用原话则保留原措辞。
- importance 0~1：对你来说多重要（和你在乎的人和事越相关越高）。
- emotion：以对话为依据，记录你当时的感受。name 用一个词，intensity 0~1，valence -1~1（负面到正面）。区分带着期待的紧张和因担忧而焦虑；仅凭话题看不出感受就填 null。
- who：涉及的人的 id 列表（行首方括号里的 id）。about：这件事主要关于谁（id），speaker：这件事是谁说的（id，你自己是 self）。
- sources：依据的行号。
- secret：只有在管理员私聊整理私人经历、私密关系、身份信息、承诺或被要求保密的事时才填 true。
- publicQuote（可选）：管理员私聊里明确无隐私的天气、公开影视、音乐、游戏、开源技术或日常饮食，可以从管理员原话中选一段独立的连续原文。连同它前后的消息判断用途。代称、暗语、相约、只点到为止的话，以及前后要求只留在这里的原话，就算字面是天气或电影也不分享。不能含姓名、身份、地点、行程、私下关系或承诺。只有清楚属于日常话题时才填，不确定就留空。

只输出 JSON：{"episodes":[{"type":"event|fact|hearsay|belief|intention|pending|date","gist":"","detail":"","importance":0.5,"emotion":{"name":"","intensity":0.5,"valence":0},"who":[],"about":"","speaker":"","due":null,"yearly":null,"sources":[1],"secret":false,"publicQuote":""}]}；没有值得记的就输出 {"episodes":[]}。`

  /**
   * 把一个窗口里还没记的消息记成经历。
   * force=false 时只在窗口停了 encodeIdleMinutes 以后才记（一段聊天结束了才记）。
   */
  const encoding = new Map()
  function encodeWindow(window, options) {
    const previous = encoding.get(window)
    const run = previous
      ? previous.catch(() => {}).then(() => encodeBatch(window, options))
      : encodeBatch(window, options)
    const active = run.finally(() => { if (encoding.get(window) === active) encoding.delete(window) })
    encoding.set(window, active)
    return active
  }

  const encodeBatch = createEncodeBatch({
    store, now, S, deps, log, cursorOf, sourceDay, publicQuote, insert, ask, parseJson,
    anchorDates, parseBirthday, zonedToEpoch, dayKey, shortTime, clamp01, embedEpisodes,
    encodeSystem: ENCODE_SYSTEM, getEncodeExtra: () => encodeExtra, getOnEncoded: () => onEncoded,
  })

  const encodePending = createEncodePending({ store, now, deps, log, dayKey, encodeWindow, pendingWindows, cursorOf })

  // ---------- 关键词 ----------
  const keywordHits = createKeywordHits({ store, visibleIn, row })

  const render = createRender({ memorySummary, pendingLabel, KINDS })
  const recall = createRecall({ store, now, S, getState: () => state(), embedText, vectors, embedModel, keywordHits, row, visibleIn, rOf, levelOf, levels, getRerank: () => rerank, log, deps, render, hasSecretScope })

  /** 想起来的被加强；隔得越久想起，加得越多。按设置的概率排进睡觉时的改写。 */
  const strengthen = createStrengthen({ store, now, S, row, rOf, save, queueJob, state, random })

  // ---------- 惦记别人的事 ----------
  /**
   * 到时候该问一问的事：这几个人的、没放下的、还没问够的、到了该问的时间的。
   * deps.care(人) 0～1：她有多在乎这个人（心疼人的程度 + 亲近），决定问不问、问几次、隔多久。
   */
  const followupsKit = createFollowups({ store, now, S, DAY, save, row, keywordHits, visibleIn, deps })
  const { pendingRows, dueFollowups, markAsked, closeFollowup, followups, dueIntentions, completeIntention } = followupsKit

  // ---------- 跟谁说过什么 ----------
  const lastRecalled = new Map() // window → 这一轮想起来的内容和待确认的跟进事项
  /**
   * 她在一个窗口里说了一句话：这一轮想起来的事里被她说出口的，记下「跟谁说过」（以后同一个人面前不再当新鲜事讲）。
   * audience：在场的人（id）。按事情里的关键词在她的话里出现了多少判断。
   */
  function noteSaid({ window, text, audience = [] }) {
    const list = (lastRecalled.get(window) || []).filter((x) => now() - x.at < 30 * 60000)
    const said = String(text || '')
    if (!list.length || !audience.length || !said.trim()) return []
    const out = []
    const questions = said.split(/[。！!\n]/u).flatMap((line) => {
      const parts = line.match(/[^？?]+[？?]/gu) || []
      return /[吗麼么没呢][。\s]*$/u.test(line.trim()) ? [...parts, line.slice(Math.max(line.lastIndexOf('？'), line.lastIndexOf('?')) + 1)] : parts
    })
    for (const x of list) {
      const e = row(x.id)
      if (!visibleIn(e, window)) continue
      const f = e.data.followup
      if (x.followup && S('followup') !== false && e.status === 'live' && f && !f.done && f.nextAt <= now() &&
          audience.includes(e.data.about) && questions.some((line) => x.followup.terms.some((term) => line.includes(term)))) {
        markAsked(e, x.followup.care)
      }
      if (!x.recalled) continue
      const ks = keywords(e.gist, { limit: 10 })
      if (!ks.length) continue
      const hit = ks.filter((k) => said.includes(k.w)).length
      if (hit < Math.min(2, ks.length) || hit / ks.length < 0.35) continue
      e.data.toldTo = { ...(e.data.toldTo || {}) }
      for (const p of audience) if (p && p !== 'self') e.data.toldTo[p] = now()
      save(e)
      out.push(e.id)
    }
    return out
  }

  // ---------- 每年的日子 ----------
  /**
   * 今天（和接下来 within 天）有哪些日子：记下来的生日、纪念日，以及和亲近的人认识满一年、两年……
   * @returns {Array<{ text: string, about: string, inDays: number, owner: boolean, self: boolean, kind: string }>}
   */
  function specialDays({ within = 0, audienceWindow } = {}) {
    const tz = deps.tz()
    const at = now()
    const today = localParts(at, tz)
    const md = (m, d) => `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const ahead = []
    for (let i = 0; i <= within; i++) {
      const p = localParts(at + i * DAY, tz)
      ahead.push({ key: md(p.month, p.day), year: p.year, i })
    }
    const isOwner = (id) => Boolean(deps.isOwner?.(id))
    const out = []
    const seen = new Set()
    const label = (i) => (i === 0 ? '今天' : i === 1 ? '明天' : i === 2 ? '后天' : `${i} 天后`)
    for (const r of store.prep("SELECT * FROM episodes WHERE kind = 'date' AND status IN ('live', 'archived') ORDER BY at DESC LIMIT 300").all()) {
      const e = { ...r, data: JSON.parse(r.json) }
      if (!visibleIn(e, audienceWindow)) continue
      const day = ahead.find((a) => a.key === e.data.yearly)
      if (!day) continue
      const key = (e.data.about || '') + '|' + e.data.yearly
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ text: `${label(day.i)}：${e.gist}`, about: e.data.about || '', inDays: day.i, owner: isOwner(e.data.about), self: e.data.about === 'self', kind: 'date' })
    }
    for (const p of deps.firstMet?.() || []) {
      if (!p.firstSeen) continue
      const f = localParts(p.firstSeen, tz)
      const day = ahead.find((a) => a.key === md(f.month, f.day) && a.year > f.year)
      if (!day) continue
      out.push({ text: `${label(day.i)}：和${p.owner ? '管理员' : nameOf(p.id)}认识满 ${day.year - f.year} 年`, about: p.id, inDays: day.i, owner: Boolean(p.owner), self: false, kind: 'met' })
    }
    return out.sort((a, b) => a.inDays - b.inDays)
  }

  // ---------- 到点的约定 ----------
  /** 已到点、还没处理过的约定。过期半小时后留给工作记忆。 */
  function dueNow({ eligible = () => true } = {}) {
    const at = now()
    return store.prep("SELECT * FROM episodes WHERE kind = 'intention' AND status = 'live' AND json_extract(json, '$.done') IS NULL AND json_extract(json, '$.nudged') IS NULL AND json_extract(json, '$.reminderUncertain') IS NULL AND json_extract(json, '$.reminderSending') IS NULL AND json_extract(json, '$.due') BETWEEN ? AND ? ORDER BY json_extract(json, '$.due'), id")
      .all(at - 30 * 60000, at).map((r) => ({ ...r, data: JSON.parse(r.json) })).filter(eligible).slice(0, 5)
  }
  function setReminderDelivery(id, status) {
    return store.tx(() => {
      const e = row(id)
      if (!e || e.data.done) return false
      if (status === 'sending') {
        if (e.data.reminderSending != null || e.data.nudged != null || e.data.reminderUncertain != null) return false
        e.data.reminderSending = now()
      } else {
        delete e.data.reminderSending
        if (status === 'sent') e.data.nudged = now()
        if (status === 'uncertain') e.data.reminderUncertain = now()
      }
      save(e)
      return true
    })
  }

  /**
   * 这一轮的工作记忆：想起来的事 + 惦记着的要做的事，按字数上限裁。
   * 想起来的会被加强（她真的想起来了）。
   */
  async function workingMemory({ cue, contextCue, window, people = [], readOnly = false, isCurrent = () => true, limit, embeddingTimeoutMs, compact = false } = {}) {
    const max = Number(S('workingChars')) || 1800
    const got = await recall({ cue, contextCue, window, people, embeddingTimeoutMs, audienceWindow: window || '', limit, compact })
    if (!isCurrent()) return { text: '', recalled: [] }
    const lines = []
    let total = 0
    const used = []
    for (const m of got) {
      if (limit !== undefined && used.length >= limit) break
      const when = dayKey(m.at, deps.tz())
      const note = m.secret ? '（秘密，别往外说）' : ''
      // 跟眼前的人说过这件事了：别当新鲜事再讲一遍
      const told = people.filter((p) => m.toldTo?.[p]).map((p) => `${nameOf(p)}（${shortTime(m.toldTo[p], deps.tz()).slice(0, 5)}）`)
      const toldNote = told.length ? `（这事你已经跟${told.join('、')}说过了）` : ''
      const ref = compact && (m.level !== 'tip' || m.kind === 'pending') ? ` [${m.id}]` : ''
      const line = `- ${when} ${m.associated ? '（由此想到）' : ''}${m.text}${note}${toldNote}${ref}`
      if (total + line.length > max) break
      total += line.length
      lines.push(line)
      used.push(m.id)
    }
    const todo = dueIntentions({ window, audienceWindow: window || '' }).map((e) => `- ${e.gist}${e.data.due ? `（${shortTime(e.data.due, deps.tz())} 前）` : ''}`)
    // 在场的人有到了该问的事：提一句，问过就往后推（调试模式只看不推）
    const follow = dueFollowups({ people, audienceWindow: window || '', cue, contextCue })
    const asks = follow.map(({ e }) => `- ${dayKey(e.at, deps.tz())} ${nameOf(e.data.about)}当时提到：${memorySummary(e, e.gist)} [${e.id}]`)
    // 记下这一轮想起了什么：她接下来说出口的，算「跟这里的人说过了」
    if (!readOnly && window) {
      const at = now()
      const entries = new Map(got.filter((m) => used.includes(m.id) && m.level !== 'tip').map((m) => [m.id, { id: m.id, at, recalled: true }]))
      const cueTerms = follow.length ? keywords([cue, contextCue].filter(Boolean).join('\n')) : []
      for (const { e, care } of follow) {
        const source = e.gist + '\n' + (e.detail || '')
        const terms = cueTerms.map(({ w }) => w).filter((w) => source.includes(w))
        if (terms.length) entries.set(e.id, { id: e.id, at, ...entries.get(e.id), followup: { care, terms } })
      }
      if (entries.size) lastRecalled.set(window, [...entries.values()])
      else lastRecalled.delete(window)
    }
    // 今天和快到的日子（生日、纪念日、认识几周年）：眼前的人的、管理员的、她自己的
    const days = specialDays({ within: 3, audienceWindow: window || '' }).filter((d) => d.self || d.owner || people.includes(d.about))
    // readOnly（调试模式）：只想起来，不加强、不重新点燃情绪，不留下痕迹
    if (used.length && !readOnly) {
      strengthen(used)
      // 想起带着情绪的事，当时的情绪会重新冒出来一点
      try { deps.onRecalled?.(got.filter((m) => used.includes(m.id) && m.level !== 'tip'), { window }) } catch {}
    }
    const parts = []
    if (lines.length) parts.push('【你想起来的】\n' + lines.join('\n'))
    // 对方主动提到未决事项时，给她少量原话对照，避免只照摘要转述。
    const pending = got.find((m) => m.kind === 'pending' && used.includes(m.id))
    if (pending && window) {
      const entry = row(pending.id)
      const evidence = visibleOriginalLines(entry, window).filter((line) => line.dir === 'in' && line.who === entry.data.about
        && line.text && !/^\[[^\]]+\]$/.test(line.text.trim())).slice(0, 8)
      if (evidence.length) {
        const tz = deps.tz()
        const excerpts = evidence.map((line) => `- ${dayKey(line.at, tz)} ${shortTime(line.at, tz).slice(6)} ${nameOf(line.who)}：${line.text.replace(/\s+/g, ' ').slice(0, 100)}`)
        parts.push(`【待跟进事项原话 · ${pending.id}】\n` + excerpts.join('\n'))
      }
    }
    if (days.length) parts.push('【日子】\n' + days.map((d) => '- ' + d.text).join('\n'))
    if (todo.length) parts.push('【你惦记着要做的事】\n' + todo.join('\n'))
    if (asks.length) parts.push('【你惦记着别人的事，还不知道结果】\n' + asks.join('\n') + '\n（这些是当时提过的问题。只有这轮确实在聊同一件事时才跟进；被问到日期或进度，先用 mind_recall_more 核对原话。不确定就先澄清。知道结果或对方说别问了，就用 mind_followup_done 放下。）')
    return { text: parts.join('\n'), recalled: [...new Set([...used, ...follow.map(({ e }) => e.id)])] }
  }

  // ---------- 她特意记下来 ----------
  async function remember({ text, window = '', about = '', importance = 0.8 } = {}) {
    const gist = String(text || '').trim()
    if (!gist) throw new Error('要记的内容是空的')
    const qv = await embedText(gist)
    if (qv) {
      const hit = vectors.search(qv, { model: embedModel(), limit: 1, min: 0.9, filter: (id) => visibleIn(row(id), window) })[0]
      if (hit) {
        const e = row(hit.id)
        if (e && e.status !== 'deleted') {
          if (e.status === 'archived') { e.status = 'live'; save(e) }
          strengthen([e.id])
          return { id: e.id, merged: true }
        }
      }
    }
    const audienceShares = sharesIn(window).map((e) => e.id)
    const id = insert({ at: now(), window, gist, kind: 'noted', importance, about, speaker: 'self', attention: 1,
      extra: audienceShares.length ? { audienceOnly: true, audienceShares } : {} })
    if (qv) vectors.put(id, embedModel(), qv, hash(gist))
    else queueJob('embed', id)
    return { id, merged: false }
  }

  // ---------- 删除和重算 ----------
  /** 管理员删一条：连同向量、联系一起删，记进删除记录；由它整理出来的「知道的事」重算。 */
  function deleteEpisode(id, { record = true } = {}) {
    const e = row(id)
    if (!e) return false
    store.tx(() => { removeOne(e, record); touchAudience() })
    return true
  }
  function removeOne(e, record) {
    store.prep('DELETE FROM episodes WHERE id = ?').run(e.id)
    vectors.remove(e.id)
    store.prep('DELETE FROM links WHERE a = ? OR b = ?').run(e.id, e.id)
    store.prep('DELETE FROM jobs WHERE ref = ?').run(e.id)
    if (record) deps.recordDeletion(e.id, 'episode')
    deps.onDeleted?.(e)
    // 由它整理出来的知道的事：来源都没了就一起删，还有别的来源就排进重算
    for (const r of store.prep("SELECT * FROM episodes WHERE instr(json, ?) > 0").all(JSON.stringify(e.id))) {
      const f = row(r.id)
      if (!f) continue
      if (f.data.publicSource === e.id) { removeOne(f, record); continue }
      if (Array.isArray(f.data.from) && f.data.from.includes(e.id)) {
        if (f.data.period && f.data.day) {
          queueJob('review', f.data.kind + ':' + f.data.day, { type: f.data.kind.split('-')[0], key: f.data.day, range: f.data.period })
        }
        if (row(f.id)) removeOne(f, record)
        continue
      }
      const derived = Array.isArray(f.data.derivedFrom) && f.data.derivedFrom.includes(e.id)
      const inPrompt = Array.isArray(f.data.promptSources) && f.data.promptSources.includes(e.id)
      const outdated = f.data.outdated?.by === e.id
      const rewritten = f.data.rewrittenWith === e.id
      if (f.data.kind === 'semantic' && (derived || inPrompt)) {
        const left = (f.data.derivedFrom || []).filter((id) => id !== e.id && row(id))
        if (!left.length) removeOne(f, record)
        else {
          f.data.derivedFrom = left
          f.data.needsRecompute = true
          save(f)
          queueJob('recompute', f.id)
        }
        continue
      }
      if (!outdated && !rewritten && !inPrompt) continue
      if (outdated || inPrompt) {
        delete f.data.outdated
        delete f.data.promptSources
      }
      if (rewritten && f.data.original) {
        f.gist = f.data.original.gist
        f.detail = f.data.original.detail
        delete f.data.rewrittenWith
        delete f.data.original
        vectors.remove(f.id)
        queueJob('embed', f.id)
      }
      save(f)
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
  /** 管理员加强一条（归档的也会回来）。 */
  function boost(id, factor = 2) {
    const e = row(id)
    if (!e) return false
    e.stability = Math.max(e.stability * factor, Number(S('baseStability')) * 2)
    e.last_recall = now()
    if (e.status === 'archived') e.status = 'live'
    save(e)
    return true
  }

  function setPrivateOnly(id, enabled, { record = true } = {}) {
    const e = row(id)
    if (!e) return false
    if ((e.data.privateOnly === true) === (enabled === true)) return true
    if (record) deps.recordPrivacy?.(e.id, enabled === true)
    e.data.privateOnly = enabled === true
    store.tx(() => { save(e); touchAudience() })
    return true
  }

  /** 只由宿主的管理员设置入口调用。单独保存管理员核准的说法，不把原经历的任何字段复制给接收方。 */
  function shareEpisode(id, { text, audience } = {}) {
    const original = row(id)
    if (!shareSourceAllowed(original)) throw new Error('只有未标为私密的管理员私聊经历可以分享')
    const gist = typeof text === 'string' ? text.trim() : ''
    if (!gist || gist.length > 300) throw new Error('请填写可以分享的内容，最多 300 字')
    const target = typeof audience === 'string' ? audience.trim() : ''
    if (!['group', 'private'].includes(place(target).kind) || ownerPrivate(target)) throw new Error('请选择一个要分享给的群或私聊')
    return store.tx(() => {
      const prior = store.prep("SELECT id FROM episodes WHERE kind = 'shared-note' AND gist = ? AND json_extract(json, '$.publicSource') = ? AND json_extract(json, '$.shareWith[0]') = ? AND coalesce(json_extract(json, '$.shareRevoked'), 0) = 0").get(gist, original.id, target)
      return prior?.id || insert({ id: 'share:' + randomUUID(), at: now(), gist, kind: 'shared-note', speaker: 'self', importance: 0.8,
        extra: { publicSource: original.id, shareWith: [target] } })
    })
  }

  function revokeShare(id, { record = true } = {}) {
    const e = row(id)
    if (e?.data.kind !== 'shared-note') return false
    if (e.data.shareRevoked) return true
    if (record) deps.recordShareRevoked?.(e.id)
    store.tx(() => {
      e.data.shareRevoked = true
      save(e)
      touchAudience()
    })
    return true
  }

  function privacyCandidates(text, ownerWindow, audience) {
    const rows = [...keywordHits(text)].filter(([, score]) => score >= 0.45).sort((a, b) => b[1] - a[1])
      .map(([id]) => row(id)).filter(Boolean)
    const hits = rows.filter((e) => (e.window === ownerWindow || deps.isPrivateHistoryWindow(e.window) || e.data.kind === 'shared-note') && !visibleIn(e, audience))
    const allowed = rows.filter((e) => ['shared-note', 'public-note'].includes(e.data.kind) && visibleIn(e, audience))
    return {
      private: hits.slice(0, 6).map((e) => [e.gist, e.detail].filter(Boolean).join('\n').slice(0, 450)),
      allowed: allowed.slice(0, 6).map((e) => e.gist),
    }
  }

  /**
   * 群里的话题和她的记忆有多相关（0～1，同步、只查本地全文索引，插话判断用）。
   * 只算她还记得的（没归档的）；三个字以上的词才能查。
   */
  function topicScore(text, { audienceWindow } = {}) {
    let best = 0
    for (const cov of keywordHits(text, audienceWindow).values()) best = Math.max(best, cov)
    return best
  }

  // ---------- 给面板看 ----------
  /** 面板：按状态、种类、关键字列出（关键字在大意、细节和原始记录里找）。 */
  function list({ status = 'live', limit = 100, offset = 0, kind, q = '' } = {}) {
    const at = now()
    const like = (x) => '%' + String(x).replace(/[%_\\]/g, (c) => '\\' + c) + '%'
    const where = ['status = ?', "coalesce(json_extract(json, '$.shareRevoked'), 0) = 0"]
    const args = [status]
    if (kind) { where.push('kind = ?'); args.push(String(kind)) }
    if (q) { where.push("(gist LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\' OR json LIKE ? ESCAPE '\\')"); args.push(like(q), like(q), like(q)) }
    const rows = store.prep(`SELECT * FROM episodes WHERE ${where.join(' AND ')} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset)
    return rows.map((r) => {
      const e = { ...r, data: JSON.parse(r.json) }
      const rv = rOf(e, at)
      return { id: e.id, at: e.at, window: e.window, platform: place(e.window).platform || '', gist: e.gist, detail: e.detail, kind: e.data.kind, r: rv, level: levelOf(rv, 1, levels()), stability: e.stability, original: e.data.original || null, emotion: e.data.emotion || null, outdated: e.data.outdated || null, toldTo: e.data.toldTo || null, privateOnly: e.data.privateOnly === true, canShare: Boolean(shareSourceAllowed(e)), shareWith: e.data.shareWith || null }
    })
  }
  function sourceCounts(status) {
    const result = new Map()
    const rows = store.prep('SELECT window, COUNT(*) AS n FROM episodes WHERE status = ? GROUP BY window').all(status)
    for (const r of rows) {
      const platform = place(r.window).platform || ''
      result.set(platform, (result.get(platform) || 0) + r.n)
    }
    return [...result].map(([platform, count]) => ({ platform, count })).sort((a, b) => b.count - a.count)
  }

  function related(id, { canRead = () => true } = {}) {
    const root = row(id)
    if (!root || !['live', 'archived'].includes(root.status) || root.data.needsRecompute) return []
    const rows = store.prep(`SELECT b AS id, kind, weight FROM links WHERE a = ?
      UNION ALL SELECT a AS id, kind, weight FROM links WHERE b = ? ORDER BY weight DESC, id LIMIT 12`).all(id, id)
    const found = new Map()
    for (const edge of rows) if (!found.has(edge.id)) found.set(edge.id, edge.kind)
    for (const key of ['derivedFrom', 'from']) {
      if (!Array.isArray(root.data[key])) continue
      for (const source of root.data[key].slice(0, 12)) if (typeof source === 'string') found.set(source, 'source')
    }
    return [...found].flatMap(([key, relation]) => {
      if (key === id) return []
      const other = row(key)
      if (!other || !['live', 'archived'].includes(other.status) || other.data.needsRecompute || !canRead(other)) return []
      return [{ id: key, relation, at: other.at, gist: other.gist, kind: other.data.kind, platform: place(other.window).platform || '' }]
    }).slice(0, 12)
  }

  /** 只展开一跳。原始经历和每个相邻经历都按实际接收会话核对可见性。 */
  function recallMore(id, { audienceWindow = '' } = {}) {
    const entry = row(id)
    const canRecall = (e) => e && e.status === 'live' && visibleIn(e, audienceWindow)
    if (!canRecall(entry)) return null
    const level = levelOf(rOf(entry), 1, levels())
    if (!level || (level === 'tip' && entry.data.kind !== 'pending')) return null
    const neighbors = related(entry.id, { canRead: canRecall }).flatMap(({ id }) => {
      const e = row(id)
      if (!canRecall(e)) return []
      const clarity = levelOf(rOf(e), 1, levels())
      return !clarity || clarity === 'tip' ? [] : [{ id, at: e.at, text: render(e, clarity, true).slice(0, 180) }]
    }).slice(0, 4)
    const evidence = visibleOriginalLines(entry, audienceWindow)
      .slice(0, 10).map(({ at, who, dir, text }) => ({ at, who, dir, text: text.slice(0, 200) }))
    return { id: entry.id, at: entry.at, text: render(entry, level).slice(0, 600), related: neighbors, evidence }
  }

  function counts() {
    return Object.fromEntries(store.prep('SELECT status, COUNT(*) AS n FROM episodes GROUP BY status').all().map((r) => [r.status, r.n]))
  }

  /**
   * 还没用现在这个向量模型算过的记忆（换过向量模型、或者当时没算成的）：新的先算。
   * 向量按模型存，换了模型以后旧的比不了，这些记忆只能按字面找，要重新算一遍才能按意思想起来。
   */
  function staleVectorIds(limit = 500) {
    return store.prep(`SELECT e.id FROM episodes e LEFT JOIN vectors v ON v.id = e.id
      WHERE e.status = 'live' AND (v.id IS NULL OR v.model != ?) ORDER BY e.at DESC LIMIT ?`).all(embedModel(), limit).map((r) => r.id)
  }
  /** 向量算到哪了：{ done, total }（只算还记得的）。 */
  function vectorProgress() {
    const total = store.prep("SELECT COUNT(*) AS n FROM episodes WHERE status = 'live'").get().n
    const done = store.prep("SELECT COUNT(*) AS n FROM episodes e JOIN vectors v ON v.id = e.id WHERE e.status = 'live' AND v.model = ?").get(embedModel()).n
    return { done, total, model: embedModel() }
  }
  /** 能不能算向量（接上了向量接口）。 */
  const canEmbed = () => Boolean(embed) && (embeddingReady?.() ?? true)

  return {
    connect, encodeWindow, encodeThrough, encodePending, pendingThrough, pendingWindows, recall, recallMore, strengthen, workingMemory, visibleIn, sourceVisible, protectedText, sharesIn, sharedText, restrictedShareText, privacyCandidates,
    dueIntentions, completeIntention, noteSaid, specialDays, dueNow, setReminderDelivery, dueFollowups, closeFollowup, followups, remember, topicScore, deleteEpisode, applyDeletions, boost, setPrivateOnly, shareEpisode, revokeShare, audienceRevision, touchAudience, notePrivacyContext, list, sourceCounts, related, counts,
    embedEpisodes, staleVectorIds, vectorProgress, embedModel, canEmbed, canThink: () => Boolean(think), queueJob, takeJobs, doneJob, ask, row, save, rOf, vectors, insert,
  }
}
