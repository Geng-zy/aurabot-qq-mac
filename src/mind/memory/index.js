// 记忆：记住、忘记、想起、被改写、睡觉整理和做梦、删除重算。
// 规矩同心智核心：不引用 Aurabot；模型（think）、向量（embed）、心情和精力（state）都由外面注入。
// 设计见设计文档「记忆」一章。

import { createHash, randomUUID } from 'node:crypto'
import { retention, initialStability, levelOf } from './curve.js'
import { createVectorState, createVectorIndex } from './vectors.js'
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
import { createSharing } from './sharing.js'
import { createDeletion } from './deletion.js'
import { createSpecial } from './special.js'
import { createWorking } from './working.js'
import { createPanel } from './panel.js'
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
  const { ownerPrivate, shareSourceAllowed, hasSecretScope, audienceRevision, touchAudience, visibleIn, visibleForRecall, visibleForAudience, sourceVisible, originalLines, visibleOriginalLines, sourceDay, memorySummary, protectedText, sharedText, sharesIn, restrictedShareText } = visibility

  function save(e) {
    let oldGist = ''
    try { oldGist = store.prep('SELECT gist FROM episodes WHERE id = ?').get(String(e.id))?.gist || '' } catch {}
    store.prep('UPDATE episodes SET gist = ?, detail = ?, strength = ?, stability = ?, last_recall = ?, status = ?, json = ? WHERE id = ?')
      .run(e.gist, e.detail ?? null, e.strength, e.stability, e.last_recall ?? null, e.status, JSON.stringify(e.data || {}), e.id)
    // 文字改了，旧语义向量必须失效；下一轮按新文字重算。
    if (oldGist !== String(e.gist || '') && oldGist) {
      try { vectors.remove(e.id); queueJob('embed', e.id) } catch (error) { log.debug('记忆改写后向量失效失败：', error.message) }
    }
  }
  /** 此刻记得多少：从最后一次想起（没有就从发生时）算起。 */
  function rOf(e, at = now()) {
    return retention(e.stability, at - (e.last_recall || e.at || at), S('forgetting'))
  }

  // ---------- 模型调用（带预算） ----------
  async function ask(scene, system, text, maxTokens = 1200) {
    if (!think) throw new Error('没接模型')
    const est = estimateTokens(system) + estimateTokens(text) + maxTokens
    // 隐私判断是安全闸，不占用后台创作预算；否则预算耗尽会把所有出站都卡死。
    const finish = scene === 'privacy' ? () => {} : deps.budget.reserve(scene, est)
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
  const keywordHits = createKeywordHits({ store, visibleIn, visibleForRecall, visibleForAudience, row })

  const render = createRender({ memorySummary, pendingLabel, KINDS })
  const recall = createRecall({ store, now, S, getState: () => state(), embedText, vectors, embedModel, keywordHits, row, visibleIn, visibleForRecall, visibleForAudience, rOf, levelOf, levels, getRerank: () => rerank, log, deps, render, hasSecretScope })

  /** 想起来的被加强；隔得越久想起，加得越多。按设置的概率排进睡觉时的改写。 */
  const strengthen = createStrengthen({ store, now, S, row, rOf, save, queueJob, state, random })

  // ---------- 惦记别人的事 ----------
  /**
   * 到时候该问一问的事：这几个人的、没放下的、还没问够的、到了该问的时间的。
   * deps.care(人) 0～1：她有多在乎这个人（心疼人的程度 + 亲近），决定问不问、问几次、隔多久。
   */
  const followupsKit = createFollowups({ store, now, S, DAY, save, row, keywordHits, visibleIn, visibleForRecall, deps })
  const { pendingRows, dueFollowups, markAsked, closeFollowup, followups, dueIntentions, completeIntention } = followupsKit

  const special = createSpecial({ store, now, deps, DAY, visibleIn, visibleForRecall, localParts, nameOf, row, save })
  const { specialDays, dueNow, setReminderDelivery } = special
  const working = createWorking({
    store, now, S, deps, recall, row, visibleIn, visibleForRecall, save, keywords, markAsked, strengthen,
    dueIntentions, dueFollowups, memorySummary, specialDays, visibleOriginalLines,
    embedText, vectors, embedModel, sharesIn, insert, queueJob, hash, nameOf, dayKey, shortTime,
  })
  const { noteSaid, workingMemory, remember } = working


  const deletion = createDeletion({ store, now, S, deps, vectors, row, save, queueJob, touchAudience })
  const { deleteEpisode, deleteEpisodeRaw, applyDeletions, boost, setPrivateOnly } = deletion

  const sharing = createSharing({
    store, now, deps, place, ownerPrivate, shareSourceAllowed, insert, save, touchAudience, randomUUID, keywordHits, row, visibleIn,
  })
  const { shareEpisode, revokeShare, privacyCandidates } = sharing

  /**
   * 群里的话题和她的记忆有多相关（0～1，同步、只查本地全文索引，插话判断用）。
   * 只算她还记得的（没归档的）；三个字以上的词才能查。
   */
  function topicScore(text, { audienceWindow } = {}) {
    let best = 0
    for (const cov of keywordHits(text, audienceWindow).values()) best = Math.max(best, cov)
    return best
  }

  const panel = createPanel({ store, now, place, rOf, levelOf, levels, shareSourceAllowed, visibleIn, visibleForRecall, render, visibleOriginalLines, row })
  const { list, sourceCounts, related, recallMore, counts } = panel

  const vectorState = createVectorState({ store, getEmbedModel: () => embedModel(), isEmbedConnected: () => Boolean(embed), isEmbeddingReady: () => embeddingReady?.() })
  const { staleVectorIds, vectorProgress, canEmbed } = vectorState

  return {
    connect, encodeWindow, encodeThrough, encodePending, pendingThrough, pendingWindows, recall, recallMore, strengthen, workingMemory, visibleIn, visibleForRecall, visibleForAudience, sourceVisible, protectedText, sharesIn, sharedText, restrictedShareText, privacyCandidates,
    dueIntentions, completeIntention, noteSaid, specialDays, dueNow, setReminderDelivery, dueFollowups, closeFollowup, followups, remember, topicScore, deleteEpisode, deleteEpisodeRaw, applyDeletions, boost, setPrivateOnly, shareEpisode, revokeShare, audienceRevision, touchAudience, notePrivacyContext, list, sourceCounts, related, counts,
    embedEpisodes, staleVectorIds, vectorProgress, embedModel, canEmbed, canThink: () => Boolean(think), queueJob, takeJobs, doneJob, ask, row, save, rOf, vectors, insert,
  }
}
