import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { estimateTokens } from '../mind/budget.js'
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
import { createSelf } from './self.js'
import { createTurnPolicy } from './turn-policy.js'
import { createEmbedding } from './embedding.js'
import { createPerception } from './perception.js'
import { createPeople } from './people.js'
import { createTurnFlow } from './turn-flow.js'
import { createRestore } from './restore.js'
import { createTurnContext } from './turn-context.js'
import { createSnapshot } from './snapshot.js'
import { createContextAssembly } from './context.js'
import { registerOffers } from './offers.js'
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
  // 心智模型调用必须有超时：编码/人格推断挂住时不能把该窗口的整条队列永久占死。
  const rawAsk = opts.ask
  const askWithTimeout = rawAsk ? (request) => new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value) }
    const timer = setTimeout(() => {
      const error = new Error('心智模型调用超时')
      error.code = 'MIND_ASK_TIMEOUT'
      finish(reject, error)
    }, 120_000)
    timer.unref?.()
    try { Promise.resolve(rawAsk(request)).then((v) => finish(resolve, v), (e) => finish(reject, e)) } catch (error) { finish(reject, error) }
  }) : undefined
  const mind = createMind({
    dir: opts.dir, ownerId: ownerOf(), publicName: '大肥鱼', now, log, memoryDb: opts.memoryDb, random: opts.random,
    ownerName: () => String(opts.getConfig()?.ownerName || ''),
    model: askWithTimeout ? (request) => askWithTimeout({ ...request, reasoningEffort: request.reasoningEffort || effortFor(request.scene) }) : undefined,
  })
  const trashDir = opts.trashDir || join(homedir(), '.Trash')
  const mem = mind.memory

  const localEmbedding = opts.localEmbedding || createEmbedder(fileURLToPath(new URL('../../models/', import.meta.url)))
  const embedding = createEmbedding({ mind, opts, localEmbedding, createEmbedClient, createRerankClient, paramOf, createHash })
  embedding.connect(mem)
  const { embeddingStatus } = embedding

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
  const turnPolicy = createTurnPolicy({ mind, now, debug, isOwnerChat, ownerOf, notRemembered, parseChat, personIn, refOfChat })
  const { canSeedHistory, recentUserMessages, shouldRotate, attention, effects } = turnPolicy


  /** 收到的一条渠道消息（已经过白名单）。 */
  let outreachRef = null
  const perception = createPerception({
    mind, log, now, debug, syncOwner, noteChatActivity: (...args) => noteChatActivity(...args),
    notRemembered, parseChat, personIn, refOfChat, windowOf, isOwnerChat, segmentsText, acceptsFood,
    getOutreach: () => outreachRef,
    resolveOwnerAbsence: (...args) => resolveOwnerAbsence(...args),
    checkOutreach: (...args) => checkOutreach(...args),
    checkApproval: (...args) => checkApproval(...args),
    latestFoodOffer: (...args) => latestFoodOffer(...args),
    fedSince: (...args) => fedSince(...args),
    feed: (...args) => feed(...args),
  })
  const { perceive, noteAddressed, said } = perception

  const speakersOf = new Map() // chatId → 这一轮说话的人
  const socialPrefs = createSocialPreferences({
    mind, mem, isOwnerChat, shortId, speakersOf, windowOf, personIn, effects, debug,
  })
  const { relationContext, dislikes, ignoreChance, groupInterest, reactWish, interjectCap, wakeWords } = socialPrefs
  const contextAssembly = createContextAssembly({
    mind, mem, windowOf, keywords, dayKey, personIn, shortId, speakersOf, isOwnerChat, debug,
    isFoodTopic, elsewhere, getTurnContext: () => turnContext, getInner: () => inner,
    getRelationContext: () => relationContext, getPendingShares: () => pendingShares,
  })
  const { carryOver, contextFor } = contextAssembly


  // ---------- 记忆：每轮回复前想起相关的事 ----------
  let turnContext = null
  function beforeTurn(...args) { return turnContext.beforeTurn(...args) }

  function effortFor(scene) {
    return effortForScene(scene, mind.setting, mind.body.state({ persist: false }), EFFORT[scene])
  }

  function chatEffort(text, appraisal, owner = false) {
    return mind.setting('models.adaptiveDepth') ? effortFor(speechScene(text, appraisal, owner)) : ''
  }

  function endTurn(chatId) { return turnContext.endTurn(chatId) }
  function invalidateMemory() { return turnContext.invalidateMemory() }

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

  turnContext = createTurnContext({ mind, windowOf, parseChat, personIn, noteChatActivity, syncOwner, speakersOf, debug, isClosed: () => closed, isOwnerChat, chatEffort })


  // ---------- 忘掉一个人（面板「关系」页） ----------
  const people = createPeople({ mind, mem, syncOwner, personOf, privateChatOf, clearWorking: () => turnContext?.clearWorking() })
  const { forgetPerson, restorePerson } = people

  // ---------- 想给管理员看的东西 / 主动联系 ----------
  const outreach = createOutreach({
    mind, opts, ownerOf, ownerChat, parseChat, now, debug, isClosed: () => closed,
  })
  const { pendingShares, canReachOwner, reachOwner, checkOutreach } = outreach
  outreachRef = outreach
  registerOffers({ mind, now, canReachOwner, actionBudget, reachOwner, handleBodyEvent: (...args) => handleBodyEvent(...args) })

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
  let turnFlow = null
  turnFlow = createTurnFlow({ mind, log, now, debug, syncOwner, noteChatActivity, notRemembered, personIn, personOf, windowOf, handleBodyEvent, noteMissed })


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
  function gate(m) { return turnFlow.gate(m) }
  function mustReplyOwner(chatId, userId) { return turnFlow.mustReplyOwner(chatId, userId) }
  function wakeUp(byQQ = '') { return turnFlow.wakeUp(byQQ) }
  function noteTurn(chatId, senders = []) { return turnFlow.noteTurn(chatId, senders) }

  /**
   * 有人喂她（/投喂、面板按钮、或者她自己判断出对方在给她吃的）。都是虚拟的，不涉及付款。
   * 管理员喂的更开心；记成一件经历，记得是谁、给了什么。
   */
  const feelings = createFeel({
    mind, mem, now, debug, syncOwner, windowOf, parseChat, personIn, notRemembered,
    refOfChat, isOwnerChat, shortId, naturalFoodOffer, parsePerson, LEGACY_PLATFORM,
  })
  const { feed, feel, rules, confirmReplyFeed, latestFoodOffer, fedSince } = feelings

  const { replayDeletionsAfterRestore } = createRestore({ opts, mind, mem, log })

  const selfKit = createSelf({ mind, mem, opts, log, ownerOf, outreach, now })
  const { changeSelf, inferTraits, resolveOwnerAbsence, missOwner, syncPersona } = selfKit

  const { dailySnapshot, backupFiles } = createSnapshot({ opts, mind, log, trashDir })

  let closed = false
  const lifecycle = createLifecycle({
    opts, log, mind, local, localEmbedding, migrateLegacy, replayDeletionsAfterRestore,
    outreach, resolveOwnerAbsence, syncPersona, importLegacySocial, inferTraits, dailySnapshot,
    encodeTick, bodyTick, innerTick, inner, drain: encoding.drain, isClosed: () => closed, setClosed: () => { closed = true },
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
