// 记忆：记住、忘记、想起、被改写、睡觉整理和做梦、删除重算。
// 规矩同心智核心：不引用 Aurabot；模型（think）、向量（embed）、心情和精力（state）都由外面注入。
// 设计见设计文档「记忆」一章。

import { createHash } from 'node:crypto'
import { retention, initialStability, afterRecall, levelOf } from './curve.js'
import { createVectorIndex } from './vectors.js'
import { estimateTokens } from '../budget.js'
import { zonedToEpoch, shortTime, dayKey, localParts, parseBirthday } from '../clock.js'
import { placeOf, shortId } from '../place.js'
import { keywords } from './words.js'

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
  'week-summary': '那一周的事',
  'month-summary': '那个月的事',
  date: '每年的日子',
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
  /** 内心整理可以读取全部经历。对话和模块只拿得到当前会话有权看到的内容。 */
  function visibleIn(e, window, path = new Set()) {
    if (!e || e.data.needsRecompute) return false
    if (window === undefined) return true
    if (path.has(e.id)) return false
    const { data } = e
    if (data.privateOnly) {
      const audience = place(window)
      const account = audience.platform ? audience.platform + ':' + audience.id : audience.id
      if (!window || audience.kind !== 'private' || !deps.isOwner?.(account)) return false
    }
    if ((data.kind === 'dream' && !Array.isArray(data.from)) || (!e.window && data.kind === 'belief' && data.speaker === 'self')) return false
    if ((data.secret || place(e.window).kind === 'private') && (!window || e.window !== window)) return false
    if (data.publicSource) {
      const original = row(data.publicSource)
      if (!original || original.data.secret || original.data.privateOnly || original.data.needsRecompute) return false
      const sources = original.data.sources || []
      if (!sources.length || !publicSourceLines(e.gist, original.window, sources)) return false
    }
    const sources = [
      ...(Array.isArray(data.derivedFrom) ? data.derivedFrom : []),
      ...(Array.isArray(data.from) ? data.from : []),
      ...(Array.isArray(data.promptSources) ? data.promptSources : []),
      data.outdated?.by,
      data.rewrittenWith,
    ].filter(Boolean)
    if (!sources.length) return true
    path.add(e.id)
    const visible = sources.every((id) => visibleIn(row(id), window, path))
    path.delete(e.id)
    return visible
  }
  function sourceVisible(source, window) {
    const line = store.prep('SELECT window FROM perception WHERE id = ?').get(source)
    if (!line || (place(line.window).kind === 'private' && line.window !== window)) return false
    return store.prep("SELECT id FROM episodes WHERE EXISTS (SELECT 1 FROM json_each(episodes.json, '$.sources') WHERE value = ?)").all(source)
      .every(({ id }) => visibleIn(row(id), window))
  }

  function protectedText(ownerWindow, audience) {
    const rows = store.prep("SELECT * FROM episodes WHERE (json_extract(json, '$.privateOnly') = 1 OR json_extract(json, '$.secret') = 1) ORDER BY at DESC LIMIT 250").all()
    const values = []
    for (const row of rows) if (!visibleIn({ ...row, data: JSON.parse(row.json) }, audience)) values.push(row.gist, row.detail)
    if (ownerWindow) {
      const lines = store.prep("SELECT at, text FROM perception WHERE window = ? AND dir = 'in' ORDER BY id DESC LIMIT 200").all(ownerWindow).reverse()
      for (const [index, line] of lines.entries()) {
        if (hasPrivateCue(line.text) || privateContext(line, lines[index - 1], lines[index + 1])) values.push(line.text)
      }
    }
    return values.filter(Boolean)
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
    const finish = deps.budget.reserve(scene, est)
    if (!finish) {
      const e = new Error('今天的后台预算用完了')
      e.code = 'BUDGET'
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
  function cursorOf(window) {
    return Number(store.get('encode.cursor.' + window, 0)) || 0
  }
  /** 有新消息还没记的窗口。 */
  function pendingWindows() {
    const rows = store.prep('SELECT window, MAX(id) AS last, MAX(at) AS lastAt FROM perception GROUP BY window').all()
    return rows.filter((r) => r.last > cursorOf(r.window)).map((r) => ({ window: r.window, lastAt: r.lastAt }))
  }

  // 只有清楚属于日常公共话题、能逐字对回来源的片段，才可以从主人私聊另存一份可分享摘要。
  const ordinaryTopic = /天气|下雨|下雪|晴天|气温|电影|动画|动漫|电视剧|音乐|歌曲|游戏|球赛|公开新闻|编程|开源|软件|今天吃|早餐|午餐|晚饭/
  const privateCue = /私密|隐私|保密|秘密|不公开|别(?:告诉|提|说给|对外说|在.{0,8}(?:说|提))|不要(?:告诉|提起|外传)|只[跟给和]|只属于|我们俩|咱俩|两个人之间|我和你|你和我|私聊|专属|我家|住址|手机号|身份证|暗号|密码|口令|验证码|银行|账户|病情|检查结果|亲密|表白|感情|纪念日|老地方|那个地方|上(?:次|回)(?:说好|那套|的事)|前面说的是那件事|心里有数就行|(?:到你这儿|知道|懂)就好|到你这儿就行|(?:等我|碰头|碰面|见面)|我喊你的|[路街巷弄][零一二三四五六七八九十百\d]+号|\d{6}|https?:|@/i
  const compact = (text) => String(text ?? '').normalize('NFKC').replace(/[\s\p{Cf}]+/gu, '')
  const hasPrivateCue = (text) => privateCue.test(compact(text))
  const pointsForward = /下一句|接下来(?:那句|说的)|后面(?:那句|说的)/
  const pointsBack = /刚才(?:那句|说的)|前面(?:那句|说的)|上一句/
  const closeTo = (a, b) => a && b && Math.abs(a.at - b.at) <= 20 * 60_000

  function privateContext(line, before, after) {
    return (closeTo(line, before) && pointsForward.test(compact(before.text)) && hasPrivateCue(before.text))
      || (closeTo(line, after) && pointsBack.test(compact(after.text)) && hasPrivateCue(after.text))
  }

  function publicSourceLines(quote, window, ids) {
    const source = store.prep('SELECT id, at, text, dir, who FROM perception WHERE window = ? AND id = ?')
    const lines = ids.map((id) => source.get(window, id))
    if (lines.some((line) => !line || hasPrivateCue(line.text))) return false
    const candidate = lines.find((line) => line.dir === 'in' && deps.isOwner?.(line.who) && line.text.includes(quote))
    if (!candidate) return false
    // 同一个窗口里紧挨的原话可能限定这句的用途，也可能稍后撤回分享。
    const before = store.prep("SELECT at, text FROM perception WHERE window = ? AND id < ? AND dir = 'in' ORDER BY id DESC LIMIT 1").get(window, candidate.id)
    const after = store.prep("SELECT at, text FROM perception WHERE window = ? AND id > ? AND dir = 'in' ORDER BY id LIMIT 1").get(window, candidate.id)
    return !privateContext(candidate, before, after)
  }

  function publicQuote(ep, src, window) {
    const location = place(window)
    const account = location.platform ? location.platform + ':' + location.id : location.id
    if (location.kind !== 'private' || !deps.isOwner?.(account) || ep.secret === true) return ''
    const quote = String(ep.publicQuote || '').trim()
    if (quote.length < 4 || quote.length > 100 || /[\r\n]/.test(quote) || !ordinaryTopic.test(quote)) return ''
    if (!src.length || ep.sources.length !== src.length || hasPrivateCue(quote)) return ''
    return publicSourceLines(quote, window, src.map((line) => line.id)) ? quote : ''
  }

  const ENCODE_SYSTEM = (name) => `你是${name || '她'}自己的记忆。下面是${name || '她'}刚经历的一段聊天（“你”就是${name || '她'}）。把值得记住的事记下来，像人一样只记要紧的，闲聊里没意思的不记。

规矩：
- 别人说的关于他自己的事，才算 fact（about 和 speaker 是同一个人）；A 说 B 的事，记成 hearsay。
- 你自己的猜测、看法记成 belief，gist 用“我觉得……”开头，不要当成事实。
- 你答应要做、或者打算做的事记成 intention，能看出时间就填 due（格式 YYYY-MM-DD HH:mm，按聊天里的时间），看不出就填 null。
- 别人说到他自己一件还没结果、他在意的事（面试、考试、体检、等录取或通知、比赛、看病、搬家……）记成 pending，about 和 speaker 都是他，due 填结果大概出来的时间（看不出就填 null）。
- 别人说到的生日、纪念日这类每年都会再来的日子，记成 date：yearly 填 MM-DD，about 是谁的（你自己的填 self），gist 写清是什么日子。
- 其他经历记成 event。
- 只记聊天里真有的内容，不要补充、不要编。
- gist 一句话大意；detail 补充细节（谁、说了什么、怎么回事），可以空。
- importance 0~1：对你来说多重要（和你在乎的人和事越相关越高）。
- emotion：你当时的感受，name 用一个词，intensity 0~1，valence -1~1（负面到正面）；没什么感觉就 null。
- who：涉及的人的 id 列表（行首方括号里的 id）。about：这件事主要关于谁（id），speaker：这件事是谁说的（id，你自己是 self）。
- sources：依据的行号。
- secret：私人经历、你和对方之间的私密关系、身份信息、承诺或有人要求保密的事填 true。
- publicQuote（可选）：主人私聊里明确无隐私的天气、公开影视、音乐、游戏、开源技术或日常饮食，可以从主人原话中选一段独立的连续原文。连同它前后的消息判断用途。代称、暗语、相约、只点到为止的话，以及前后要求只留在这里的原话，就算字面是天气或电影也不分享。不能含姓名、身份、地点、行程、私下关系或承诺。只有清楚属于日常话题时才填，不确定就留空。

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

  async function encodeBatch(window, { force = false } = {}) {
    const tz = deps.tz()
    const cursor = cursorOf(window)
    const batch = Number(S('encodeBatch')) || 60
    const select = store.prep('SELECT id, at, who, dir, text, json FROM perception WHERE window = ? AND id > ? ORDER BY id LIMIT ?')
    const rows = select.all(window, cursor, batch)
    if (!rows.length) return { encoded: 0 }
    const last = rows[rows.length - 1]
    const idle = now() - last.at >= (Number(S('encodeIdleMinutes')) || 5) * 60000
    // 一直没停下来的聊天（热闹的群）：最早那条没记的等太久了也先记一段，别处才能及时想起这里聊过什么
    const waitedTooLong = now() - rows[0].at >= (Number(S('encodeMaxWaitMinutes')) || 30) * 60000
    if (!force && !idle && !waitedTooLong && rows.length < batch) return { encoded: 0, waiting: true }
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
    // 等模型时原话可能被删除、合并身份或修改，提交前检查同一批原话仍然有效。
    const unchanged = () => cursorOf(window) === cursor && JSON.stringify(select.all(window, cursor, rows.length)) === JSON.stringify(rows)
    // 模型没按格式回（不是 JSON、没有 episodes）：这段先不算记过，下次再记；连着三次都不行才跳过，免得卡死
    if (!parsed || typeof parsed !== 'object' || (parsed.episodes !== undefined && !Array.isArray(parsed.episodes)) || (!Array.isArray(parsed.episodes) && !('self' in parsed) && !('rel' in parsed) && !('habit' in parsed) && !('knowledge' in parsed))) return store.tx(() => {
      if (!unchanged()) return { encoded: 0, changed: true }
      const failKey = 'encode.fail.' + window
      const n = Number(store.get(failKey, 0)) + 1
      if (n < 3) {
        store.set(failKey, n)
        log.warn(`记 ${window} 时模型没按格式回，下次再记（第 ${n} 次）`)
        return { encoded: 0, failed: true }
      }
      store.del(failKey)
      log.warn(`记 ${window} 时模型连着 ${n} 次没按格式回，这 ${rows.length} 条先跳过（原话还在，翻聊天记录能看到）`)
      store.set('encode.cursor.' + window, last.id)
      return { encoded: 0, failed: true, skipped: rows.length }
    })
    // 她在这段里说过话就是专心在聊；只是在群里看着，记得浅一些
    const attention = rows.some((r) => r.dir === 'out') ? 1 : 0.6
    const ids = []
    const evidence = []
    const committed = store.tx(() => {
      if (!unchanged()) return false
      store.del('encode.fail.' + window)
      for (const ep of Array.isArray(parsed?.episodes) ? parsed.episodes : []) {
        const gist = String(ep?.gist || '').trim()
        if (!gist) continue
        const src = (Array.isArray(ep.sources) ? ep.sources : []).map((n) => rows[Number(n) - 1]).filter(Boolean)
        let type = ['event', 'fact', 'hearsay', 'belief', 'intention', 'pending', 'date'].includes(ep.type) ? ep.type : 'event'
        // 每年的日子：认不出月日就当普通的事
        const yb = type === 'date' ? parseBirthday(ep.yearly) : null
        if (type === 'date' && !yb) type = 'fact'
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
        const id = insert({
          at, window, gist, detail: String(ep.detail || '').trim(), kind: type,
          importance: ep.importance ?? 0.5, emotion: emo, about, speaker,
          who: Array.isArray(ep.who) ? ep.who.map(String) : [],
          sources: src.map((r) => r.id), due, attention,
          extra: { ...(ep.secret === true ? { secret: true } : {}), ...follow, ...(yb ? { yearly: `${String(yb.month).padStart(2, '0')}-${String(yb.day).padStart(2, '0')}` } : {}) },
        })
        ids.push(id)
        const quote = publicQuote(ep, src, window)
        if (quote) insert({
          at, gist: quote, kind: 'public-note', importance: ep.importance ?? 0.4, speaker: 'self',
          extra: { publicSource: id, publicSummary: quote },
        })
        evidence.push({ id, sources: src.map((r) => r.id), emotion: emo, importance: ep.importance, secret: ep.secret === true })
      }
      store.set('encode.cursor.' + window, last.id)
      return true
    })
    if (!committed) return { encoded: 0, changed: true }
    if (onEncoded) {
      try { onEncoded({ window, rows, parsed, evidence }) } catch (error) { log.warn('记经历后的状态记录出错：', error.message) }
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
          if (!r.encoded && (r.waiting || r.budget || r.failed || cursorOf(w.window) >= (store.prep('SELECT MAX(id) AS m FROM perception WHERE window = ?').get(w.window).m || 0))) break
        }
      } catch (error) {
        log.warn(`记 ${w.window} 失败：`, error.message)
      }
    }
    return n
  }

  // ---------- 关键词 ----------
  const ftsQ = () => store.prep("SELECT e.id FROM episodes_fts f JOIN episodes e ON e.rowid = f.rowid WHERE episodes_fts MATCH ? AND e.status = 'live' LIMIT 30")
  const likeQ = () => store.prep("SELECT id FROM episodes WHERE status = 'live' AND (gist LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\') ORDER BY at DESC LIMIT 30")
  /** 线索里的词各自命中哪些经历：id → 命中的分量占全部分量的比例（0～1）。 */
  function keywordHits(text, audienceWindow) {
    const got = new Map()
    const found = []
    for (const { w, weight } of keywords(text)) {
      let ids = []
      try {
        // 三个字以上用全文索引（trigram）；两个字的索引查不了，直接按字面找
        ids = [...w].length >= 3
          ? ftsQ().all('"' + w.replace(/"/g, '""') + '"').map((r) => r.id)
          : likeQ().all(...Array(2).fill('%' + w.replace(/[%_\\]/g, (c) => '\\' + c) + '%')).map((r) => r.id)
      } catch {}
      if (audienceWindow !== undefined) ids = ids.filter((id) => visibleIn(row(id), audienceWindow))
      // 到处都有的词（常见的人名、口头禅）分不出是哪件事：分量打折
      found.push({ ids: [...new Set(ids)], weight: ids.length >= 30 ? weight * 0.25 : weight })
    }
    // 记忆里一次都没出现过的词说明不了想到哪件事，不算进总数；只剩到处都有的词时，等于没有线索
    const hit = found.filter((t) => t.ids.length)
    if (!hit.some((t) => t.ids.length < 30)) return got
    const total = hit.reduce((n, t) => n + t.weight, 0)
    for (const { ids, weight } of found) for (const id of ids) got.set(id, (got.get(id) || 0) + weight)
    for (const [id, n] of got) got.set(id, Math.min(1, n / Math.min(total, 3)))
    return got
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
  async function recall({ cue, contextCue = '', window = '', audienceWindow, people = [], embeddingTimeoutMs, limit = Number(S('recallLimit')) || 6, deliberate = false, period = null, compact = false } = {}) {
    if (!limit) return []
    const at = now()
    const inPeriod = (e) => !period || (e.at >= period.start && e.at < period.end)
    const st = state() || {}
    const cueMatch = Number(S('cueMatch')) * (deliberate ? 0.85 : 1)
    const cand = new Map() // id → sim
    // 只给了时间没给线索：这段时间里的事都算线索，按重要程度排
    if (period && !String(cue || '').trim()) {
      // 问的是好几天以上：那段时间的回顾（每天、每周、每月写的）排在最前面，一段话就能想起个大概
      const long = period.end - period.start > 2 * DAY
      for (const r of store.prep("SELECT id, kind, json FROM episodes WHERE status = 'live' AND at >= ? AND at < ? ORDER BY at DESC LIMIT 200").all(period.start, period.end)) {
        let imp = 0.4
        try { imp = Number(JSON.parse(r.json).importance) || 0.4 } catch {}
        // 越大的回顾越靠前（月 > 周 > 天）；只问一天时不用回顾，直接想那天的事
        const bonus = { 'day-summary': 0.2, 'week-summary': 0.3, 'month-summary': 0.4 }[String(r.kind || '')]
        cand.set(r.id, cueMatch + 0.2 * imp + (bonus ? (long ? bonus : -0.1) : 0))
      }
      if (long) {
        for (const r of store.prep("SELECT id FROM episodes WHERE kind IN ('week-summary', 'month-summary', 'day-summary') AND status IN ('live', 'archived') AND at >= ? AND at < ? ORDER BY at DESC LIMIT 40").all(period.start, period.end)) {
          if (!cand.has(r.id)) cand.set(r.id, cueMatch + 0.35)
        }
      }
    }
    const query = [cue, contextCue].filter(Boolean).join('\n')
    const qv = query.trim() ? await embedText(query, embeddingTimeoutMs) : null
    if (qv) for (const h of vectors.search(qv, { model: embedModel(), limit: period ? 200 : 80, min: cueMatch * 0.8 })) cand.set(h.id, h.sim)
    // 关键词：命中的词越多（按分量算）越像想到了；全中的能单独把记忆勾起来，向量服务慢或连不上时也想得起
    for (const [id, cov] of keywordHits(cue)) {
      const sim = cueMatch * ((deliberate ? 0.9 : 0.85) + 0.3 * cov)
      cand.set(id, Math.max(cand.get(id) || 0, sim))
    }
    if (contextCue) for (const [id, cov] of keywordHits(contextCue)) {
      const sim = cueMatch * (0.82 + 0.26 * cov)
      cand.set(id, Math.max(cand.get(id) || 0, sim))
    }
    // 眼前的人也是线索：关于他们的事
    for (const p of people) {
      for (const r of store.prep("SELECT id FROM episodes WHERE about = ? AND status = 'live' ORDER BY at DESC LIMIT 10").all(String(p))) {
        cand.set(r.id, Math.max(cand.get(r.id) || 0, cueMatch * 0.9))
      }
    }
    const scored = []
    for (const [id, sim] of cand) {
      const e = row(id)
      if (!e || e.status !== 'live' || !visibleIn(e, audienceWindow)) continue
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
      // 过时的说法排后面一些（还记得，但不是现在的情况）
      scored.push({ e, r, sim, level, score: score * (0.5 + 0.5 * r) * (e.data.outdated ? 0.6 : 1) })
    }
    scored.sort((a, b) => b.score - a.score)
    // 精排（可选）：候选多的时候，让精排模型逐条看「线索和这件事有多相关」，按它重新排；遗忘照样算进去。
    // 超时、出错就按原来的顺序，不拖慢回复。
    if (S('rerank') === true && rerank && String(cue || '').trim() && scored.length > 1) {
      const n = Math.max(2, Math.min(50, Number(S('rerankTopN')) || 20))
      const head = scored.slice(0, n)
      try {
        const rel = await rerank(query, head.map((x) => x.e.gist + (x.e.detail ? '：' + String(x.e.detail).slice(0, 200) : '')), { timeoutMs: Number(S('rerankTimeoutMs')) || 1500 })
        if (rel.length === head.length) {
          head.forEach((x, i) => { x.score = rel[i] * (0.5 + 0.5 * x.r) })
          head.sort((a, b) => b.score - a.score)
          scored.splice(0, head.length, ...head)
        }
      } catch (error) {
        log.debug('精排没成，按原来的顺序：', error.message)
      }
    }
    const top = scored.filter(({ e }) => visibleIn(row(e.id), audienceWindow)).slice(0, limit)
    // 联想（扩散激活）：从最相关的两条出发，顺着联系往下想几步；离得越远越淡，太淡的想不起来。
    // 对话的联想沿用会话可见范围，按日期查时不联想。
    if (top.length && S('assoc') !== false && !period && !compact) {
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
            if (!e || e.status !== 'live' || !visibleIn(e, audienceWindow) || (e.data.kind === 'intention' && e.data.done)) continue
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
    return top.map(({ e, r, level, associated, hop }) => ({ id: e.id, at: e.at, window: e.window, kind: e.data.kind, level, r, associated: Boolean(associated), hop: hop || 0, text: render(e, level, compact), emotion: e.data.emotion || null, target: e.data.about || '', secret: Boolean(e.data.secret), toldTo: e.data.toldTo || null }))
  }

  /** 按想起的清楚程度给出她脑子里的样子。 */
  function render(e, level, compact = false) {
    const tag = KINDS[e.data.kind] && e.data.kind !== 'event' && e.data.kind !== 'experience' ? `（${KINDS[e.data.kind]}）` : ''
    // 过时了的：知道那是以前的情况
    if (e.data.outdated && level !== 'tip') return `以前：${e.gist}${tag}——后来变了：${e.data.outdated.now}`
    if (level === 'clear') return `${e.gist}${!compact && e.detail ? '——' + e.detail : ''}${tag}`
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
  function pendingRows({ open = false } = {}) {
    return store.prep(`SELECT * FROM episodes WHERE kind = 'pending' AND status = 'live'${open ? " AND json_extract(json, '$.followup.done') IS NULL" : ''} ORDER BY at DESC LIMIT 200`).all()
      .map((r) => ({ ...r, data: JSON.parse(r.json) }))
  }
  function dueFollowups({ people = [], audienceWindow, limit = 2 } = {}) {
    if (S('followup') === false || !people.length) return []
    const at = now()
    const out = []
    for (const e of pendingRows({ open: true })) {
      const f = e.data.followup
      if (!f || f.done || !people.includes(e.data.about) || !visibleIn(e, audienceWindow)) continue
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
  function followups({ person: pid = '', all = false, audienceWindow } = {}) {
    return pendingRows({ open: !all })
      .filter((e) => (all || !e.data.followup?.done) && (!pid || e.data.about === pid) && visibleIn(e, audienceWindow))
      .map((e) => ({ id: e.id, at: e.at, gist: e.gist, about: e.data.about, due: e.data.due || null, asks: e.data.followup?.asks || 0, nextAt: e.data.followup?.nextAt || 0, done: e.data.followup?.done || 0 }))
  }

  // ---------- 工作记忆 ----------
  /** 到期或快到期的要做的事（前瞻记忆）。 */
  function dueIntentions({ window = '', audienceWindow, within = 2 * 3600000 } = {}) {
    const at = now()
    return store.prep("SELECT * FROM episodes WHERE kind = 'intention' AND status = 'live' AND json_extract(json, '$.done') IS NULL ORDER BY at DESC LIMIT 50").all()
      .map((r) => ({ ...r, data: JSON.parse(r.json) }))
      // 到期或快到期的；过期三天还没做的慢慢就不惦记了（还在记忆里，只是不再每轮提醒）。
      // 没说时间的：答应后（或上次想起后）一周内每轮记着，之后就不再时时挂在心上，聊到了还想得起来
      .filter((e) => !e.data.done && (e.data.due ? e.data.due <= at + within && e.data.due >= at - 3 * DAY : at - Math.max(e.at || 0, e.last_recall || 0) < 7 * DAY) && (!window || !e.window || e.window === window || e.data.due))
      .filter((e) => visibleIn(e, audienceWindow))
      .slice(0, 5)
  }
  function completeIntention(id) {
    const e = row(id)
    if (!e || e.data.kind !== 'intention') return false
    e.data.done = now()
    save(e)
    return true
  }

  // ---------- 跟谁说过什么 ----------
  const lastRecalled = new Map() // window → 这一轮想起来的 [{ id, at }]
  /**
   * 她在一个窗口里说了一句话：这一轮想起来的事里被她说出口的，记下「跟谁说过」（以后同一个人面前不再当新鲜事讲）。
   * audience：在场的人（id）。按事情里的关键词在她的话里出现了多少判断。
   */
  function noteSaid({ window, text, audience = [] }) {
    const list = (lastRecalled.get(window) || []).filter((x) => now() - x.at < 30 * 60000)
    const said = String(text || '')
    if (!list.length || !audience.length || !said.trim()) return []
    const out = []
    for (const x of list) {
      const e = row(x.id)
      if (!e) continue
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
      out.push({ text: `${label(day.i)}：和${p.owner ? '主人' : nameOf(p.id)}认识满 ${day.year - f.year} 年`, about: p.id, inDays: day.i, owner: Boolean(p.owner), self: false, kind: 'met' })
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
      const ref = compact && m.level !== 'tip' ? ` [${m.id}]` : ''
      const line = `- ${when} ${m.associated ? '（由此想到）' : ''}${m.text}${note}${toldNote}${ref}`
      if (total + line.length > max) break
      total += line.length
      lines.push(line)
      used.push(m.id)
    }
    const todo = dueIntentions({ window, audienceWindow: window || '' }).map((e) => `- ${e.gist}${e.data.due ? `（${shortTime(e.data.due, deps.tz())} 前）` : ''}`)
    // 在场的人有到了该问的事：提一句，问过就往后推（调试模式只看不推）
    const follow = dueFollowups({ people, audienceWindow: window || '' })
    if (!readOnly) for (const { e, care } of follow) markAsked(e, care)
    const asks = follow.map(({ e }) => `- ${dayKey(e.at, deps.tz())} ${nameOf(e.data.about)}：${e.gist}`)
    // 记下这一轮想起了什么：她接下来说出口的，算「跟这里的人说过了」
    if (!readOnly && window) lastRecalled.set(window, got.filter((m) => used.includes(m.id) && m.level !== 'tip').map((m) => ({ id: m.id, at: now() })))
    // 今天和快到的日子（生日、纪念日、认识几周年）：眼前的人的、主人的、她自己的
    const days = specialDays({ within: 3, audienceWindow: window || '' }).filter((d) => d.self || d.owner || people.includes(d.about))
    // readOnly（调试模式）：只想起来，不加强、不重新点燃情绪，不留下痕迹
    if (used.length && !readOnly) {
      strengthen(used)
      // 想起带着情绪的事，当时的情绪会重新冒出来一点
      try { deps.onRecalled?.(got.filter((m) => used.includes(m.id) && m.level !== 'tip'), { window }) } catch {}
    }
    const parts = []
    if (lines.length) parts.push('【你想起来的】\n' + lines.join('\n'))
    if (days.length) parts.push('【日子】\n' + days.map((d) => '- ' + d.text).join('\n'))
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

  function setPrivateOnly(id, enabled, { record = true } = {}) {
    const e = row(id)
    if (!e) return false
    if ((e.data.privateOnly === true) === (enabled === true)) return true
    if (record) deps.recordPrivacy?.(e.id, enabled === true)
    e.data.privateOnly = enabled === true
    save(e)
    return true
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
    const where = ['status = ?']
    const args = [status]
    if (kind) { where.push('kind = ?'); args.push(String(kind)) }
    if (q) { where.push("(gist LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\' OR json LIKE ? ESCAPE '\\')"); args.push(like(q), like(q), like(q)) }
    const rows = store.prep(`SELECT * FROM episodes WHERE ${where.join(' AND ')} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset)
    return rows.map((r) => {
      const e = { ...r, data: JSON.parse(r.json) }
      const rv = rOf(e, at)
      return { id: e.id, at: e.at, window: e.window, platform: place(e.window).platform || '', gist: e.gist, detail: e.detail, kind: e.data.kind, r: rv, level: levelOf(rv, 1, levels()), stability: e.stability, original: e.data.original || null, emotion: e.data.emotion || null, outdated: e.data.outdated || null, toldTo: e.data.toldTo || null, privateOnly: e.data.privateOnly === true }
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
    if (!level || level === 'tip') return null
    const neighbors = related(entry.id, { canRead: canRecall }).flatMap(({ id }) => {
      const e = row(id)
      if (!canRecall(e)) return []
      const clarity = levelOf(rOf(e), 1, levels())
      return !clarity || clarity === 'tip' ? [] : [{ id, at: e.at, text: render(e, clarity, true).slice(0, 180) }]
    }).slice(0, 4)
    return { id: entry.id, at: entry.at, text: render(entry, level).slice(0, 600), related: neighbors }
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
    connect, encodeWindow, encodePending, pendingWindows, recall, recallMore, strengthen, workingMemory, visibleIn, sourceVisible, protectedText,
    dueIntentions, completeIntention, noteSaid, specialDays, dueNow, setReminderDelivery, dueFollowups, closeFollowup, followups, remember, topicScore, deleteEpisode, applyDeletions, boost, setPrivateOnly, list, sourceCounts, related, counts,
    embedEpisodes, staleVectorIds, vectorProgress, embedModel, canEmbed, canThink: () => Boolean(think), queueJob, takeJobs, doneJob, ask, row, save, rOf, vectors, insert,
  }
}
