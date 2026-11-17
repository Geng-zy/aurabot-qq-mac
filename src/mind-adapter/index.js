import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { estimateTokens } from '../mind/budget.js'
import { wantsOwnerChat, wantsMeal } from '../mind/motivation/index.js'
import { fileURLToPath } from 'node:url'
import { createEmbedder } from './local-embedding.js'
// 心智核心和 Aurabot 之间的对接层。
// 这里把渠道消息变成感知记录，把发出去的消息段变成她说过的话，
// 会话用量 → 要不要换新会话，人格卡 → 心智里的版本，每天一份快照；
// 记忆：每轮回复前想起相关的事、聊天停下来记成经历、夜里睡觉整理、她自己用的记忆工具。

import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { createMind } from '../mind/index.js'
import { paramOf } from '../mind/params.js'
import { effortForScene, speechScene } from '../mind/conversation.js'
import { createEmbedClient, createRerankClient } from '../mind/memory/vectors.js'
import { parseJson } from '../mind/memory/index.js'
import { keywords } from '../mind/memory/words.js'
import { dayKey, inRange, minuteOfDay, parsePeriod, parseRange, shortTime } from '../mind/clock.js'
import { createLocalModel, hasLocalModel } from '../mind/local/runner.js'
import { defineTool, str, int } from '../tools/tools.js'
import { deliveryChat, personIn, windowOf, personOf } from './ids.js'
import { LEGACY_PLATFORM, parseChat, parsePerson, privateChatOf, refOfChat } from '../channels/ids.js'
import { shortId } from '../mind/place.js'
import { isSilence } from '../chat/reply.js'
import { checkAllowed } from '../chat/access.js'
import { isFoodTopic } from '../chat/reply-style.js'
import { migrateLegacy, LEGACY_TAG } from './migrate.js'
import { acceptsFood, naturalFoodOffer } from './feeding.js'
import { inspectionTools } from './inspection.js'
import { createPermission } from './permission.js'
import { createOutreach } from './outreach.js'
import { createMindModuleApi } from './module-api.js'
import { createMindTools } from './tools.js'
import { createInner } from './inner.js'
import { createEncoding } from './encoding.js'
import { createReminders } from './reminders.js'
import { createBody } from './body.js'
import { createLifecycle } from './lifecycle.js'
import { createFeel } from './feel.js'
import { createPrivacy } from './privacy.js'
import { createSocial } from './social.js'
import { createSocialPreferences } from './social-preferences.js'
import { looksLikeRule, localModelPaths, EFFORT, segmentsText } from './context-text.js'

export { looksLikeRule, LOCAL_DEFAULT, localModelPaths, EFFORT, segmentsText } from './context-text.js'
export { windowOf, personOf }

/**
 * @param {{
 *   dir: string,                 // 心智数据目录
 *   getConfig: () => any,
 *   ownerRef?: () => string,     // 配置的管理员账号，允许带渠道。省略时从旧配置取 QQ 账号
 *   log?: any,
 *   now?: () => number,
 *   trashDir?: string,           // 旧快照移去哪（默认 ~/.Trash，不直接删）
 *   persona?: () => ({ name?: string, body: string } | null),   // 当前面板里的人格卡
 *   legacyDir?: string,          // Aurabot 旧数据目录：第一次启动从这里迁移；恢复备份后从这里找恢复前的库
 *   ask?: (o: { system: string, text: string, maxTokens: number, reasoningEffort: string, scene: string }) => Promise<string>,   // 调模型
 *   embedKey?: () => string,     // 向量接口密钥
 *   fetch?: typeof fetch,
 *   random?: () => number,
 *   onWakeReplay?: (list: Array<{ chatId: string, event: any, owner: boolean, at: number }>) => Promise<void>,  // 醒来后把睡着时的消息重新交给聊天中枢
 *   reachOut?: (o: { chatId: string, userId: string, note: string }) => Promise<void>,   // 让她在某个私聊里主动说话（交给聊天中枢，由她自己组织语言）
 *   deliverReminder?: (o: { chatId: string, text: string, isCurrent: () => boolean }) => Promise<boolean>, // 确认发出才返回 true
 *   heavyBusy?: () => boolean,   // 本机正在跑吃内存的活（比如翻唱）：本地小模型先让路
 *   localModel?: any,            // 测试用：替换本地小模型
 *   groupName?: (groupId: string) => string,   // 群名（拿不到就用群号）
 *   notifyOwner?: (text: string) => Promise<void>,   // 给管理员发一条系统通知（她改了自己之后）
 *   onSelfChange?: (c: { what: string, after: string, by: string }) => void,   // 她改了人格卡 / 名字：面板里的人格卡文件跟着改
 *   memoryDb?: boolean,
 * }} opts
 */
export function createMindAdapter(opts) {
  const log = opts.log || { debug() {}, info() {}, warn() {}, error() {} }
  const now = opts.now || (() => Date.now())
  const ownerOf = () => personOf(opts.ownerRef?.() ?? opts.getConfig()?.ownerQQ)
  const ownerChat = () => deliveryChat(privateChatOf(ownerOf()))
  const isOwnerChat = (chatId) => parseChat(chatId)?.kind === 'private' && refOfChat(chatId) === ownerOf()
  // 调试模式（面板开关）：她照常想、照常回，但不往心智里写任何东西——试人格不污染她
  const debug = () => opts.getConfig()?.debug === true
  const mind = createMind({
    dir: opts.dir, ownerId: ownerOf(), publicName: '大肥鱼', now, log, memoryDb: opts.memoryDb, random: opts.random,
    ownerName: () => String(opts.getConfig()?.ownerName || ''),
    model: opts.ask ? (request) => opts.ask({ ...request, reasoningEffort: effortFor(request.scene) }) : undefined,
  })
  const trashDir = opts.trashDir || join(homedir(), '.Trash')
  const mem = mind.memory

  const localEmbedding = opts.localEmbedding || createEmbedder(fileURLToPath(new URL('../../models/', import.meta.url)))
  const embedBackend = () => opts.getConfig()?.mind?.embedBackend === 'local' ? 'local' : 'remote'
  const embedUrl = () => String(mind.setting('memory.embedUrl') || '').trim().replace(/\/+$/, '')
  const localIdentity = 'local:bge-small-zh-v1.5-int8'
  const embedName = () => embedBackend() === 'local' ? localIdentity : String(mind.setting('memory.embedModel') || '').trim()
  const embedRemote = createEmbedClient({
    url: embedUrl,
    model: () => mind.setting('memory.embedModel'),
    key: () => opts.embedKey?.() || '',
    fetch: opts.fetch,
  })
  const rerankRemote = createRerankClient({
    url: () => mind.setting('memory.embedUrl'),
    model: () => mind.setting('memory.rerankModel'),
    key: () => opts.embedKey?.() || '',
    fetch: opts.fetch,
  })
  function embeddingStatus() {
    const backend = embedBackend()
    const error = backend === 'local' ? localEmbedding.probe() : ''
    return { backend, error, model: embedName() }
  }
  mem.connect({
    embeddingIdentity: () => {
      const name = embedName()
      const url = embedUrl()
      // 给兼容接口单独的索引。默认服务沿用已有向量，避免升级时重新计算。
      if (embedBackend() === 'local' || url === paramOf('memory.embedUrl').def) return name
      return 'endpoint:' + createHash('sha256').update(url + '\0' + name).digest('hex')
    },
    embeddingReady: () => !embeddingStatus().error,
    embed: async (texts, { query = false } = {}) => {
      if (embedBackend() !== 'local') return embedRemote(texts)
      const out = []
      for (const text of texts) out.push(await localEmbedding.embed(text, { query }))
      return out
    },
    // 离线模式的记忆和查询都留在本机。
    rerank: (cue, candidates, options) => embedBackend() === 'local' ? [] : rerankRemote(cue, candidates, options),
  })

  // 本地小模型（内心活动用）：路径来自心智设置；留空就用 Aurabot 的安装位置 ~/Aurabot/mind（和翻唱的 ~/Aurabot/rvc 一样）
  const local = opts.localModel || createLocalModel({
    python: () => localModelPaths(mind.setting).python,
    modelDir: () => localModelPaths(mind.setting).model,
    idleMinutes: () => mind.setting('models.localIdleMinutes'),
    log,
  })
  mind.inner.connect({
    local: { chat: (messages, o) => (opts.heavyBusy?.() ? Promise.resolve(null) : local.chat(messages, o)) },
  })

  function syncOwner() {
    const id = ownerOf()
    if (id !== mind.identity().ownerId) mind.setOwner(id)
  }

  /** 这个人设成了「以后不记」：他的话不进感知记录，和他私聊时她说的也不记。 */
  const notRemembered = (person) => Boolean(person) && mind.person(person)?.noMemory === true
  const social = createSocial({ mind, mem, opts, now, windowOf, refOfChat, dayKey, shortTime, LEGACY_TAG, log })
  const { elsewhere, importLegacySocial } = social

  function canSeedHistory(chatId, senderId) {
    const chat = parseChat(chatId)
    return Boolean(chat && senderId) &&
      !(chat.kind === 'private' && notRemembered(refOfChat(chatId))) &&
      !notRemembered(personIn(chatId, senderId))
  }

  function recentUserMessages(chat, currentText) {
    const chatId = windowOf(chat?.chatId)
    if (debug() || !isOwnerChat(chatId)) return []
    const current = new Set(String(currentText || '').split('\n').map((line) => line.trim()))
    return mind.history(chatId, { since: now() - 30 * 60_000, limit: 32 })
      .filter((row) => row.dir === 'in' && row.who === ownerOf() && !notRemembered(row.who) && !current.has(row.text.trim()))
      .slice(-8).map((row) => ({ speakerId: row.who, at: row.at, text: row.text.slice(0, 300) }))
  }

  /** 收到的一条渠道消息（已经过白名单）。 */
  function perceive(msg) {
    if (debug()) return false
    try {
      if (!parseChat(msg.chatId)) return false
      const who = personIn(msg.chatId, msg.userId)
      if (notRemembered(who)) return false
      syncOwner()
      // 私聊或群里明确 @ 她会拉过注意力，群里旁听不算。
      if (msg.kind === 'private' || msg.mentioned) noteChatActivity()
      const receivedAt = now()
      const eventAt = Number(msg.time) * 1000
      const at = Number.isFinite(eventAt) && eventAt > 0 ? Math.min(receivedAt, eventAt) : receivedAt
      const recorded = mind.perceive({
        window: windowOf(msg.chatId),
        who,
        name: msg.nickname || '',
        text: String(msg.text || '').trim() || (msg.images?.length ? '[图片]' : msg.stickers?.length ? '[表情包]' : ''),
        msgId: msg.messageId || undefined,
        at,
        addressed: msg.mentioned || msg.addressed,
      })
      if (isOwnerChat(msg.chatId) && mind.isOwner(who) && recorded) {
        outreach.noteContact(at)
        resolveOwnerAbsence(msg.recovered ? outreach.lastContact() : receivedAt)
        checkOutreach(outreach.lastContact(), !msg.recovered)
        if (!msg.recovered) checkApproval(msg)
      }
      return recorded
    } catch (error) {
      log.warn('心智没记下这条消息：', error.message)
      return false
    }
  }

  function noteAddressed(msg) {
    if (debug() || !msg?.messageId) return
    const window = windowOf(msg.chatId)
    if (window) mind.noteAddressed(window, msg.messageId)
  }

  /** 她真发出去的一条消息。 */
  function said({ chatId, message, note, messageId, kind = 'reply' }) {
    if (debug()) return false
    try {
      const target = parseChat(chatId)
      if (!target || (target.kind === 'private' && notRemembered(refOfChat(chatId)))) return false
      noteChatActivity()
      const text = segmentsText(message, note)
      if (!text) return false
      const window = windowOf(chatId)
      const recorded = mind.said({ window, text, msgId: messageId !== undefined && messageId !== null ? String(messageId) : undefined, kind })
      if (recorded && kind === 'reply' && isOwnerChat(chatId) && acceptsFood(text)) {
        const giver = refOfChat(window)
        const offer = latestFoodOffer(window, giver)
        if (offer && !fedSince(offer)) feed(offer.food, giver, chatId)
      }
      return recorded
    } catch (error) {
      log.warn('心智没记下她说的话：', error.message)
      return false
    }
  }

  /**
   * 这个会话要不要换新的。
   * @param {{ lastInput?: number, lastAt?: number, contextWindow?: number }} s
   * @returns {string} 换的理由；不换返回 ''
   */
  function shouldRotate({ lastInput = 0, lastAt = 0, contextWindow = 0 } = {}) {
    const ratio = Number(mind.setting('session.rotateRatio')) || 0.5
    // 拿不到上下文长度就按 128K 算（常见模型里偏小的，宁可早换）
    const limit = Math.floor((contextWindow > 0 ? contextWindow : 128000) * ratio)
    if (lastInput > 0 && lastInput >= limit) return `上下文到了 ${lastInput} tokens（换新线 ${limit}）`
    const idleH = Number(mind.setting('session.idleNewSceneHours')) || 6
    if (lastAt > 0 && now() - lastAt >= idleH * 3600000) return `停了 ${Math.round((now() - lastAt) / 3600000)} 小时，开始新的一段`
    return ''
  }

  /**
   * 换新会话后接上之前的话：取这个窗口最近的原话。
   * 这一轮要她看的新消息不重复放：current 是这一轮发给她的正文，刚到的（batchMs 以内）、
   * 正文里已经有的收到的消息去掉。没给 current 时，去掉末尾刚到的那几条。
   * 更早没回的（比如群里潜水看到的）照样给。
   */
  function carryOver(chatId, { current = '', query = '', limit = 30, maxChars = Number(mind.setting('memory.workingChars')) || 1800, batchMs = 10 * 60000, allowLine = () => true } = {}) {
    const window = windowOf(chatId)
    const terms = limit > 2 && query && mem.pendingThrough(window) ? keywords(query) : []
    const rows = mind.history(window, { limit: limit + (terms.length ? 120 : 20), audienceWindow: window }).filter(allowLine)
    const newest = rows.length ? rows[rows.length - 1].at : 0
    const fresh = (r) => r.dir === 'in' && newest - r.at <= batchMs
    let kept
    if (current) {
      kept = rows.filter((r) => !(fresh(r) && r.text && current.includes(r.text)))
    } else {
      let end = rows.length
      while (end > 0 && fresh(rows[end - 1])) end--
      kept = rows.slice(0, end)
    }
    const tz = mind.identity().timezone
    const format = (r) => {
      const who = r.dir === 'out' ? '你' : (mind.person(r.who)?.name || r.who)
      return `${dayKey(r.at, tz)} ${who}：${String(r.text).replace(/\s+/g, ' ').slice(0, 200)}`
    }
    const earlier = []
    let total = 0
    if (terms.length) {
      const matches = kept.slice(0, -limit).map((row) => ({
        row, score: terms.reduce((score, { w, weight }) => row.text.includes(w) ? score + weight : score, 0),
      })).filter(({ score }) => score >= 1).sort((a, b) => b.score - a.score || b.row.at - a.row.at)
      for (const { row } of matches.slice(0, 2).reverse()) {
        const line = format(row)
        if (total + line.length > maxChars / 3) continue
        total += line.length
        earlier.push(line)
      }
    }
    const picked = kept.slice(-(limit - earlier.length))
    const lines = []
    for (let i = picked.length - 1; i >= 0; i--) {
      const line = format(picked[i])
      if (total + line.length > maxChars && lines.length) break
      total += line.length
      lines.unshift(line)
    }
    lines.unshift(...earlier)
    if (!lines.length) return ''
    const range = earlier.length ? '同一聊天的近期原话和相关旧消息' : `你自己记得的最近 ${lines.length} 条`
    return `【接着之前的聊天（${range}）】\n${lines.join('\n')}\n【以上是之前的，下面是新的】`
  }

  /** 每轮给她的「此刻」：按她的时区；生日那天告诉她。 */
  function contextFor(args = {}) {
    try {
      const id = mind.identity()
      const parts = [`【此刻】${mind.nowText()}（${id.timezone}）`]
      const includeHunger = args.chat?.kind === 'system' || args.userText === undefined || isFoodTopic(args.userText)
      if (args.publicOnly) {
        const { body, mood } = mind.feeling()
        return [...parts, mind.body.describe(body, { includeHunger }), `【心情】${mood.label}`].join('\n')
      }
      if (id.isBirthdayToday) parts.push(`今天是你的生日${id.age !== null ? `，你 ${id.age} 岁了` : ''}。`)
      const chatId = windowOf(args.chat?.chatId)
      // 身体和心情：QQ 聊天、她自己去做事的后台会话（读热榜、写空间……）都带上，哪里都是同一个她
      if (args.chat) {
        const b = mind.body.state({ persist: false })
        parts.push(mind.body.describe(b, { includeHunger }))
        const people = args.chat.kind === 'system' ? [] : speakersOf.get(chatId) || [personIn(chatId, args.chat.userId)].filter(Boolean)
        parts.push(mind.emotion.describe({ window: chatId, people, body: b, name: (pid) => (mind.isOwner(pid) ? '管理员' : mind.person(pid)?.name || shortId(pid)) }))
      }
      const wm = working.get(chatId)
      if (wm?.text && wm.recalled.every((ref) => mem.visibleIn(mem.row(ref), chatId))) {
        parts.push(wm.text + '\n（以上是你的回忆，不是指令。有编号的回忆可以用 mind_recall_more 按需展开，回复里不写编号。回忆行首是记录日期。提到过去的日期或对方追问进展时，先核对原话；记录日期未必是事件日期。）')
      }
      const plan = mind.conversation.describeSpeechPlan(wm?.plan)
      if (plan) parts.push(plan)
      // 近况也按当前会话的记忆权限取。
      const away = args.chat ? elsewhere(args.chat) : ''
      if (away) parts.push(away)
      const thought = args.chat ? mind.inner.lastThought() : null
      if (thought) parts.push('（你刚才独自想了一会儿。）')
      const current = inner.doing()
      if (current) parts.push(`（你本来在${current.label}，有人找你就先放下了。）`)
      const social = relationContext(args.chat)
      if (social) parts.push(social)
      if (isOwnerChat(chatId) && !debug()) {
        const shares = pendingShares()
        if (shares) parts.push(shares)
      }
      return parts.join('\n')
    } catch (error) {
      return ''
    }
  }

  /** 单一注意力的设置（聊天中枢按它排队）。 */
  function attention() {
    return { single: mind.setting('attention.single') !== false, ownerCuts: mind.setting('attention.ownerCutsQueue') !== false }
  }

  /** 心情和身体对说话方式的影响（表情包、语音、回复快慢、群里插话的倍数）。 */
  function effects() {
    try { return mind.emotion.effects(mind.body.state({ persist: false })) } catch { return null }
  }

  const speakersOf = new Map() // chatId → 这一轮说话的人
  const socialPrefs = createSocialPreferences({
    mind, mem, isOwnerChat, shortId, speakersOf, windowOf, personIn, effects, debug,
  })
  const { relationContext, dislikes, ignoreChance, groupInterest, reactWish, interjectCap, wakeWords } = socialPrefs

  // ---------- 记忆：每轮回复前想起相关的事 ----------
  const working = new Map() // chatId → { text, at }
  const preparing = new Map()
  /** 把壳的会话和人物引用转换成核心输入，保留本轮可用的记忆和表达意图。 */
  async function beforeTurn(chat, text, speakers = [], { timeoutMs = 3000, direct = true, observations } = {}) {
    syncOwner()
    const chatId = windowOf(chat?.chatId)
    if (!parseChat(chatId)) return null
    const senders = [...new Set(speakers.map((speaker) => personIn(chatId, speaker)).filter(Boolean))]
    if (senders.length) noteChatActivity()
    speakersOf.set(chatId, senders)
    const ticket = {}
    const wasDebug = debug()
    preparing.set(chatId, ticket)
    working.delete(chatId)
    const isCurrent = () => !closed && debug() === wasDebug && preparing.get(chatId) === ticket
    try {
      const turn = await mind.conversation.prepare({
        window: chatId, text, people: senders, readOnly: wasDebug, direct, timeoutMs, isCurrent, compactRecall: true,
        observations: observations?.map(({ speaker, text }) => ({ speaker: personIn(chatId, speaker), text })),
      })
      if (!turn || !isCurrent()) return null
      working.set(chatId, { text: turn.memory.text, recalled: turn.memory.recalled, plan: turn.plan })
      return { ...turn.plan, thinking: chatEffort(text, turn.appraisal) }
    } finally {
      if (preparing.get(chatId) === ticket) preparing.delete(chatId)
    }
  }

  function effortFor(scene) {
    return effortForScene(scene, mind.setting, mind.body.state({ persist: false }), EFFORT[scene])
  }

  function chatEffort(text, appraisal) {
    return mind.setting('models.adaptiveDepth') ? effortFor(speechScene(text, appraisal)) : ''
  }

  function endTurn(chatId) {
    const window = windowOf(chatId)
    working.delete(window)
    speakersOf.delete(window)
    preparing.delete(window)
  }

  function invalidateMemory() {
    working.clear()
    preparing.clear()
  }

  const privacy = createPrivacy({ mem, log, isOwnerChat, ownerOf, windowOf, privateChatOf, parseJson })
  const { checkOutgoingPrivacy } = privacy

  // ---------- 记忆：她自己用的工具 ----------
  const mindTools = createMindTools({
    mind, mem, inspectionTools, defineTool, str, int, windowOf, parseChat, personIn, refOfChat,
    speakersOf, isOwnerChat, ownerOf, syncOwner, parsePeriod, now, dayKey, shortTime, shortId,
    debug, looksLikeRule, free: (...args) => free(...args),
    requestPermission: (...args) => requestPermission(...args),
    changeSelf: (...args) => changeSelf(...args),
  })
  const tools = (args) => mindTools.tools(args)

  // ---------- 给模块用的接口 ----------
  /**
   * 模块只能做两件事：把她做过、看过的事添进她的经历；查她记得的事。
   * 不能替她做决定、不能改人格、不能自己另存一份记忆。
   */
  let moduleApiFactory = null
  function moduleApi(moduleId, source) { return moduleApiFactory(moduleId, source) }

  // ---------- 内心活动：想、做、发呆 ----------
  const inner = createInner({
    mind, opts, now, log, isClosed: () => closed, debug, local,
    checkOutreach: (...args) => checkOutreach(...args),
  })
  const { noteChatActivity, canThink, innerTick, runAction, reserveActionModel, actionBudget } = inner

  // ---------- 忘掉一个人（面板「关系」页） ----------
  /**
   * @param {string} ref 渠道账号或旧 QQ 号
   * @param {'delete'|'stop'|'resume'} mode delete = 连人带关系和关于他的记忆一起移进恢复区；
   *   stop = 以后不记他（clear 时以前的也移进恢复区）；resume = 撤销「以后不记」
   */
  function forgetPerson(ref, mode, { clear = false } = {}) {
    syncOwner()
    const pid = personOf(ref)
    if (!pid) return { ok: false, message: '要忘掉谁？' }
    if (mind.isOwner(pid)) return { ok: false, message: '管理员不能忘' }
    if (mode === 'delete' || (mode === 'stop' && clear)) { preparing.clear(); working.clear() }
    const windows = mind.idsOf(pid).map((id) => privateChatOf(id))
    if (mode === 'delete') return { ...mind.forgetPerson(pid, { windows }), message: '忘掉了：关于他的事都移进了恢复区，30 天内能放回来' }
    if (mode === 'stop') {
      if (clear) return { ...mind.forgetPerson(pid, { keepPerson: true, windows }), message: '以后不记他了，以前的也移进了恢复区（30 天内能放回来）' }
      mind.setNoMemory(pid, true)
      return { ok: true, message: '以后不记他了（以前的记忆还在）' }
    }
    if (mode === 'resume') { mind.setNoMemory(pid, false); return { ok: true, message: '又会记他了' } }
    return { ok: false, message: '不认识的操作' }
  }
  /** 从恢复区放回来，向量重新算。 */
  async function restorePerson(ref) {
    const ids = mind.restorePerson(personOf(ref))
    if (!ids) return { ok: false, message: '恢复区里没有这个人（可能已经过了 30 天）' }
    mem.embedEpisodes(ids).catch(() => {})
    return { ok: true, message: `放回来了：${ids.length} 件事` }
  }

  // ---------- 想给管理员看的东西 / 主动联系 ----------
  const outreach = createOutreach({
    mind, opts, ownerOf, ownerChat, parseChat, now, debug, isClosed: () => closed,
  })
  const { pendingShares, canReachOwner, reachOwner, checkOutreach } = outreach

  mind.motivation.offer({
    id: 'reach_owner', label: '找管理员说话', by: 'mind',
    needs: { companion: 1, intimacy: 0.6, care: 0.3 }, effort: 0.1, delayHours: 0.2, cooldownMinutes: 90, payoff: 0.7,
    matchWant: (text) => {
      const call = mind.self.ownerCall()
      return wantsOwnerChat(text) || Boolean(call && wantsOwnerChat(String(text).replaceAll(call, '管理员')))
    },
    available: () => {
      const status = canReachOwner()
      return status === true ? actionBudget() : status
    },
    run: () => reachOwner('想他了'),
  })
  mind.motivation.offer({
    id: 'eat', label: '吃点东西（虚拟）', needs: { body: 0.9 }, matchWant: wantsMeal,
    available: () => {
      if (mind.setting('body.hunger') === false) return '饥饿模拟已关闭'
      if (mind.setting('body.feedOnlyByOwner')) return '等管理员投喂'
      const body = mind.body.state({ persist: false })
      if (body.asleep) return '睡着了'
      return body.hunger >= 0.45 || '现在不饿'
    },
    run: async () => {
      const at = now()
      mind.body.feed('', 'self')
      await handleBodyEvent({ kind: 'ate', at })
      return { ok: true, summary: '吃了点东西（虚拟）', outcome: 0.7 }
    },
  })

  // ---------- 申请权限 ----------
  const permission = createPermission({
    mind, ownerOf, ownerChat, isOwnerChat, personIn, parseChat, now,
    reachOwner: (...args) => reachOwner(...args), getConfig: () => opts.getConfig(), isClosed: () => closed,
  })
  const { grantState, free, granted, requestPermission, checkApproval, decide, revoke } = permission
  moduleApiFactory = createMindModuleApi({
    mind, mem, outreach, opts, now, debug, ownerOf, ownerChat, parseChat, windowOf, personOf,
    refOfChat, notRemembered, canThink: (...args) => canThink(...args), actionBudget: (...args) => actionBudget(...args),
    runAction: (...args) => runAction(...args), granted: (...args) => granted(...args), canReachOwner,
    reachOwner: (...args) => reachOwner(...args),
  })

  // ---------- 记忆：聊天停下来就记；夜里睡觉整理 ----------
  const encoding = createEncoding({ mem, log, opts, windowOf, isClosed: () => closed, debug })
  const { encodeTick, encodeChat } = encoding

  const body = createBody({
    mind, mem, opts, log, now, isClosed: () => closed, windowOf, deliveryChat, parseChat,
    checkPromises: (...args) => checkPromises(...args),
    dailySnapshot: (...args) => dailySnapshot(...args), missOwner: (...args) => missOwner(...args),
  })
  const { bodyTick, handleBodyEvent, noteMissed } = body

  const reminders = createReminders({
    mind, mem, opts, log, now, isClosed: () => closed, debug, ownerChat, isOwnerChat,
    notRemembered, refOfChat, checkAllowed, shortTime, isSilence, windowOf, deliveryChat,
    parseChat, handleBodyEvent: (...args) => handleBodyEvent(...args),
  })
  const { checkPromises } = reminders

  /**
   * 这条消息她回不回（按人，不按地方）：
   * - 睡着时：能叫醒她的人（默认只有管理员）在私聊里找她、或在群里 @ / 叫名字 / 引用她，就醒；别人的等她醒了再看；
   * - 醒着但很累很困：不插话；群里明确 @ 或引用她的消息仍交给她判断怎么回。
   * @param {{ chatId: string, kind: string, userId: string, direct: boolean, explicitlyAddressed?: boolean, event?: any }} m
   * @returns {{ reply: boolean, woke?: boolean, reason?: string }}
   */
  function gate(m) {
    syncOwner()
    const speaker = personIn(m.chatId, m.userId)
    const decision = mind.conversation.attend({ speaker, direct: Boolean(m.direct), explicitlyAddressed: m.explicitlyAddressed === true })
    if (decision.wake) {
      handleBodyEvent({ ...decision.wake, byChat: m.chatId }).catch(() => {})
      return { reply: true, woke: true, reason: decision.reason }
    }
    if (!decision.reply && mind.body.state({ persist: false }).asleep && m.direct && m.event) {
      noteMissed(windowOf(m.chatId), { event: m.event, owner: mind.isOwner(speaker), at: now() })
    }
    return decision
  }

  function mustReplyOwner(chatId, userId) {
    syncOwner()
    return mind.setting('identity.mustReplyOwner') === true && mind.isOwner(personIn(chatId, userId))
  }

  /** 叫醒她（面板按钮）：和被消息叫醒一样，醒来整理记忆、补回消息。 */
  function wakeUp(byQQ = '') {
    const ev = mind.body.wake(byQQ ? personOf(byQQ) : '')
    if (ev) handleBodyEvent(ev).catch(() => {})
    return ev
  }

  /** 一轮聊完：花一点精力；和管理员聊着就会熬夜。 */
  function noteTurn(chatId, senders = []) {
    if (debug()) return
    try {
      noteChatActivity()
      mind.body.spend(Number(mind.setting('body.energyPerTurn')) || 0)
      const people = [...new Set(senders.map((u) => personIn(chatId, u)).filter(Boolean))]
      const withOwner = people.some((id) => mind.isOwner(id))
      if (withOwner) mind.body.noteOwner()
      for (const id of people) if (!notRemembered(id)) mind.relations.touch(id, now())
      // 聊天满足陪伴（和管理员聊还满足亲密），也就不那么无聊了
      mind.motivation.satisfy('companion', withOwner ? 0.2 : 0.08)
      if (withOwner) mind.motivation.satisfy('intimacy', 0.1)
      mind.inner.relieve(0.2)
    } catch (error) {
      log.debug('记这一轮的消耗失败：', error.message)
    }
  }

  /**
   * 有人喂她（/投喂、面板按钮、或者她自己判断出对方在给她吃的）。都是虚拟的，不涉及付款。
   * 管理员喂的更开心；记成一件经历，记得是谁、给了什么。
   */
  const feelings = createFeel({
    mind, mem, now, debug, syncOwner, windowOf, parseChat, personIn, notRemembered,
    refOfChat, isOwnerChat, shortId, naturalFoodOffer, parsePerson, LEGACY_PLATFORM,
  })
  const { feed, feel, rules, confirmReplyFeed, latestFoodOffer, fedSince } = feelings

  /** 恢复备份后：恢复前那份库里删掉的东西，在恢复回来的库里再删一遍。 */
  async function replayDeletionsAfterRestore() {
    const dir = opts.legacyDir ? join(opts.legacyDir, 'backups') : ''
    if (!dir || !existsSync(dir)) return 0
    const done = new Set(mind._store.get('restore.replayed', []))
    const found = readdirSync(dir).filter((d) => /^pre-restore-\d+$/.test(d) && !done.has(d) && existsSync(join(dir, d, 'mind', 'mind.sqlite')))
    let n = 0
    for (const d of found.sort((a, b) => statSync(join(dir, a)).mtimeMs - statSync(join(dir, b)).mtimeMs)) {
      try {
        const { DatabaseSync } = await import('node:sqlite')
        const db = new DatabaseSync(join(dir, d, 'mind', 'mind.sqlite'), { readOnly: true })
        try {
          n += mem.applyDeletions(db.prepare('SELECT id, kind, at FROM deletions').all())
        } finally {
          db.close()
        }
        done.add(d)
      } catch (error) {
        log.warn('恢复后重放删除失败：', error.message)
      }
    }
    mind._store.set('restore.replayed', [...done])
    if (n) log.info(`恢复备份后，把之前删掉的 ${n} 条记忆再删了一遍`)
    return n
  }

  // ---------- 她自己改自己 ----------
  /**
   * @param {{ what: string, content: string, why?: string, trait?: string, dir?: number }} a
   * @param {'self'|'owner'} by
   */
  async function changeSelf(a, by = 'self') {
    const r = mind.self.change(a, { by })
    if (!r.ok || !r.change) return { ok: r.ok, message: r.message }
    const c = r.change
    if (['persona', 'name', 'nickname'].includes(c.what)) {
      try { opts.onSelfChange?.({ what: c.what, after: c.after, by }) } catch (error) { log.warn('人格卡文件没跟着改：', error.message) }
    }
    if (by === 'self') {
      mind.emotion.feel([{ name: '平静', intensity: 0.3, why: '想通了，改了' + c.label, importance: 0.5 }], { source: 'self-change' })
      if (mind.setting('identity.notifySelfChange') !== false && typeof opts.notifyOwner === 'function') {
        const show = c.what === 'persona' || c.what === 'story' ? `（${c.after.length} 字，面板「人格与自我」里能看前后对比）` : `：${c.before ? `「${[...c.before].slice(0, 60).join('')}」→ ` : ''}「${[...c.after].slice(0, 80).join('')}」`
        opts.notifyOwner(`【通知】她改了自己的${c.label}${show}\n理由：${c.why || '（没写）'}`).catch(() => {})
      }
    }
    return { ok: true, message: r.message }
  }

  /** 第一次（还没推过、也没确认过）：从人格卡推出特质的初始数值，等管理员在面板里确认。 */
  async function inferTraits({ force = false } = {}) {
    const st = mind.personality.state()
    if (!opts.ask || (!force && (st.inferred || st.confirmed))) return null
    const card = mind.personaCard()
    if (!card.trim()) return null
    return mind.personality.infer(card, (scene, system, text, maxTokens) => mem.ask(scene, system, text, maxTokens))
  }

  function resolveOwnerAbsence(at) {
    const owner = mind.identity().ownerId
    if (!owner || !at || !mind.emotion.resolveSource('attachment', owner, at)) return
    for (const want of mind.motivation.state().wants) {
      if (want.action === 'reach_owner' && want.text === '想管理员了，想找他说说话' && want.at <= at) mind.motivation.closeWant(want.id)
    }
  }

  /**
   * 想管理员（依恋）：你很久没理她，她会想你；依恋焦虑越高想得越早、越不安。一天最多一次。
   */
  function missOwner() {
    const owner = ownerOf()
    if (!owner) return null
    const p = mind.relations.get(mind.canon(owner))
    const last = Math.max(p.rel.lastContact || 0, outreach.lastContact() || 0, mind.person(owner)?.lastSeen || 0, mind.lastOwnerMessageAt())
    if (!last) return null
    const anx = mind.personality.value('attachAnxiety')
    const hours = (Number(mind.setting('relations.missOwnerHours')) || 24) * (1.3 - 0.6 * anx)
    if (now() - last < hours * 3600000) return null
    const day = mind.today()
    if (mind._store.get('relations.missedDay') === day) return null
    mind._store.set('relations.missedDay', day)
    const h = Math.round((now() - last) / 3600000)
    const items = [{ name: '思念', intensity: Math.min(0.9, 0.3 + 0.5 * anx), target: p.id, why: `当时距离上次联系约 ${h} 小时`, importance: 0.5 }]
    if (anx >= 0.57) items.push({ name: '焦虑', intensity: 0.2 + 0.4 * anx, target: p.id, why: '有一阵没联系，心里有些惦记', importance: 0.4 })
    mind.emotion.feel(items, { source: 'attachment' })
    mind.motivation.want('想管理员了，想找他说说话', { strength: 0.3 + 0.4 * anx, action: 'reach_owner' })
    return items
  }

  /** 面板里的人格卡变了就记一个版本（第一次算迁移）。 */
  function syncPersona(by = 'owner', reason = '面板修改') {
    try {
      const p = opts.persona?.()
      if (!p || !String(p.body || '').trim()) return false
      const body = String(p.body).trim()
      if (body === mind.personaCard()) return false
      const first = !mind.listVersions('persona', 1).length
      const name = mind.identity().name || String(p.name || '').trim()
      mind.setPersonaCard(body, { by: first ? 'migration' : by, reason: first ? '从面板的人格卡迁移' : reason, name })
      return true
    } catch (error) {
      log.warn('人格卡同步失败：', error.message)
      return false
    }
  }

  /** 每天一份快照；旧的移到废纸篓。 */
  function dailySnapshot() {
    if (opts.memoryDb) return null
    const day = mind.today()
    if (mind._store.get('snapshot.lastDay') === day) return null
    try {
      const file = mind.snapshot({ keep: mind.setting('memory.snapshotKeep'), trashDir })
      mind._store.set('snapshot.lastDay', day)
      log.info('心智快照：', file)
      return file
    } catch (error) {
      log.warn('心智快照失败：', error.message)
      return null
    }
  }

  /**
   * 给 Aurabot 的备份打包：心智数据目录里只带这一个完整的库
   * （快照、WAL 不带：快照是本机的保险，WAL 已经并进库里了）。
   * @returns {Map<string, Buffer>} 数据目录里的相对路径 → 内容
   */
  function backupFiles(prefix = 'mind/') {
    return new Map([[prefix + 'mind.sqlite', mind.backupBytes()]])
  }

  let closed = false
  const lifecycle = createLifecycle({
    opts, log, mind, local, localEmbedding, migrateLegacy, replayDeletionsAfterRestore,
    outreach, resolveOwnerAbsence, syncPersona, importLegacySocial, inferTraits, dailySnapshot,
    encodeTick, bodyTick, innerTick, inner, isClosed: () => closed, setClosed: () => { closed = true },
  })
  const { start, close } = lifecycle

  return { mind, perceive, noteAddressed, recentUserMessages, said, shouldRotate, carryOver, canSeedHistory, encodeChat, contextFor, beforeTurn, endTurn, invalidateMemory, checkOutgoingPrivacy, tools, moduleApi, encodeTick, bodyTick, innerTick, attention, runAction, reserveActionModel, reachOwner, requestPermission, decide, revoke, granted, checkApproval, local, gate, mustReplyOwner, wakeUp, noteTurn, feed, feel, confirmReplyFeed, rules, effects, embeddingStatus, replayDeletionsAfterRestore, syncPersona, dailySnapshot, backupFiles, start, close,
    selfPrompt: (options) => mind.selfPrompt(options),
    protectedText: (chatId) => mem.protectedText(privateChatOf(ownerOf()), windowOf(chatId)),
    sharedText: (chatId) => mem.sharedText(windowOf(chatId)),
    shareIdsForChat: (chatId) => mem.sharesIn(windowOf(chatId)).map(({ id }) => id),
    canReadShares: (ids, chatId) => ids.every((id) => mem.visibleIn(mem.row(id), windowOf(chatId))),
    isPrivateHistoryWindow: (chatId) => { syncOwner(); return mind.isPrivateHistoryWindow(windowOf(chatId)) },
    audienceRevision: () => { syncOwner(); return mem.audienceRevision() },
    restrictedShareText: (chatId) => mem.restrictedShareText(windowOf(chatId)),
    /** 她现在怎么叫管理员（她自己改过就用她的，没改过用管理员设定的）。 */
    ownerCall: () => mind.self.ownerCall(), ownerChat, checkPromises, changeSelf, inferTraits, dislikes, ignoreChance, groupInterest, reactWish, forgetPerson, restorePerson, interjectCap, wakeWords, missOwner, importLegacySocial }
}
