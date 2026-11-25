// 消息中枢：QQ 会话 ↔ DSH 会话。
//   收：OneBot 事件 → 白名单 / 群聊策略 → 拼好文案（带发言人、群上下文、图片、语音转写）→ 喂进对应 DSH 会话
//   发：DSH 会话一轮结束 → 取最终正文 → 拆条 / 语音 / 表情 → 发回原来的 QQ 会话
// 每个 QQ 会话一个 DSH 会话，统一放在「Aurabot · QQ」工作区，管理员可以在 DSH 侧栏点开看、插手。

import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { ownerAuthorizationRevision } from '../core/config.js'
import { dataDir, readJson, writeJson } from '../core/store.js'
import { gifFrames } from '../core/image-info.js'
import { parseReply, bubbleDelay, wantsVoice, itemsToLine, deliveredItems, cleanOutboundText, cleanOutboundSegments, capOutboundText, isSilence } from './reply.js'
import { CHAT_STYLE_INSTRUCTION, polishChatProse } from './reply-style.js'
import { decideGroupReply, engagedHint, pickAutoReply, policyFor, sameNameNote, topicRelevance } from './group-policy.js'
import { guardReply, extractReply, CODE_INSTRUCTION, DIRECT_REPLY_INSTRUCTION, MARKER_INSTRUCTION } from './output-guard.js'
import { checkAllowed, levelFor, presetFor, isOwner } from './access.js'
import { fetchImage, segmentBytes } from '../core/net.js'
import { toMono16k } from '../voice/wav.js'
import { asrConfigured, transcribeAudio } from '../voice/asr.js'
import { mimeOf } from '../core/image-info.js'
import { normalizeForMatch } from '../security/leak-guard.js'
import { forwardBody } from '../channels/qq/forward.js'
import { findFfmpeg, findSharp, shrinkImage, shrinkWithSharp } from '../core/img.js'
import { redact } from '../core/redact.js'
import { askModel, defaultModel, pickReasoningEffort, modelVision, modelContextWindow } from '../core/llm.js'
import { resolveChatModel } from './chat-model.js'
import { stripFaceTags, splitSpeakable } from './tags.js'
import { expandMentions, hasMention } from './mentions.js'
import { cleanContent, cleanText } from '../core/text.js'
import { createRecentMedia } from './recent-media.js'
import { createTitleFilter } from './title-filter.js'
import { createChannels, LEGACY_PLATFORM, normChat, parseChat } from '../channels/index.js'
import { createQqChannel } from '../channels/qq/index.js'
import { takeInterim, reasoningOf, rescueFromThinking } from './steps.js'
import { withPromptCapture, currentPromptSources, memoryPromptRanges } from '../security/leak-guard.js'
import { createFileRelay } from './file-relay.js'
import { FILE_TIMEOUT_MS, fileRootsOf, insideRoots, checkSendableFile } from './file-policy.js'
import { createFileSender } from './send-file.js'
import { localImageBlocked } from './image-policy.js'
import { audioDurationSec, createVoiceFileSender } from './voice-file.js'
import { createTextSender } from './send-text.js'
import { createStickerSender } from './send-sticker.js'
import { createImageSender } from './send-image.js'
import { createOnDelivered } from './on-delivered.js'
import { createReplyJournal } from './reply-journal.js'
import { createQuoteResolver } from './quote.js'
import { inlineLabel, indentBody, quoteWho, quoteBody, quoteWhen, quoteInline } from './quote-format.js'
import { createReferenceTools } from './reference.js'
import { createTranscriber } from './transcribe.js'
import { createImageTools } from './images.js'
import { createSessionEventHandler } from './session-events.js'
import { createOnMessageHandler } from './on-message.js'
import { createNotifyEvents } from './notify-events.js'
import { createSendSegments } from './send-segments.js'
import { createDeliverTurn } from './deliver-turn.js'
import { createTurnHelpers } from './turn-helpers.js'
import { createGroupContext } from './group-context.js'
import { createRunSubagentTurn } from './run-subagent-turn.js'
import { createRunSystemTurn } from './run-system-turn.js'
import { createVoiceSender } from './send-voice.js'
import { SESSION_BACKOFF, isSessionBackoff } from './session-backoff.js'
import { recordUsage, moduleLabel, moduleOfTool } from '../core/usage.js'
import { createToolScope, isGuestSafeTool } from './tool-scope.js'
import { createStickerStash } from './sticker-stash.js'
import { createChatLog } from './chat-log.js'
import { isPrivilegedQqTool } from './privileged-tools.js'
import { createPurgeScope } from '../integration/purge-scope.js'

// QQ 会话的工作区目录，第一次收到消息时自动创建。面板「连接」页能改（config.workspaceDir，#32）；
// 没填就用环境变量 AURABOT_WORKSPACE，再没有就是 ~/Aurabot/qq-chats
const MAX_IMAGE_BYTES = 20 * 1024 * 1024 // 单张聊天图片上限，防网关/恶意大图把内存打爆
const MODEL_IMAGE_BYTES = 8 * 1024 * 1024 // 超过这个大小先缩小再给模型
const MAX_MESSAGE_IMAGES = 8 // 一条消息最多给她看几张，合并转发里的图算在内
export const WORKSPACE_DIR = process.env.AURABOT_WORKSPACE || join(homedir(), 'Aurabot', 'qq-chats')
/** 现在用的工作区目录：平台单独填了就用平台的，否则用全局 QQ 旧配置，再否则默认。 */
export const workspaceDirOf = (cfg, platform = 'qq') => {
  const perPlatform = String(cfg?.platforms?.[platform]?.workspaceDir || '').trim()
  const global = String(cfg?.workspaceDir || '').trim()
  if (perPlatform) return perPlatform
  if (global) return global
  return platform === 'qq' ? WORKSPACE_DIR : join(homedir(), 'Aurabot', `${platform}-chats`)
}
export const WORKSPACE_TITLE = 'Aurabot · QQ'
export const workspaceTitleOf = (platform = 'qq') => platform === 'qq' ? WORKSPACE_TITLE : `Aurabot · ${platform}`
const SOURCE_KIND = 'aurabot'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 只给了一个 OneBot 网关（测试、老调用方）时，包成只有 QQ 的连接层。 */
function channelsFromOnebot({ onebot, outbox, getConfig, log }) {
  const chans = createChannels()
  chans.add(createQqChannel({ getConfig, log, client: onebot || { call: async () => { throw new Error('没有 QQ 网关') }, start() {}, stop() {}, restart() {}, state: 'stopped' }, outbox: outbox || false, flushEveryMs: 0 }))
  return chans
}
const sessionKey = (id) => {
  const s = String(id ?? '')
  return s.startsWith('session-') ? s.slice(8) : s
}
const chatInfo = (chatId) => parseChat(chatId) || { kind: '', id: '', platform: '' }
const groupKey = (chatId) => { const c = parseChat(chatId); return c?.kind === 'group' ? normChat(chatId) : String(chatId || '') }
const topicKey = (gid) => { const c = parseChat(gid); return c?.kind === 'group' ? normChat(gid) : `qq:group:${String(gid)}` }

/**
 * hooks（扩展模块用，都可以不传）：
 *   message(msg) → true 表示这条消息被模块接管了，她不再处理
 *   reply(text, {chatId}) → 改写她要发的话；返回 null 表示这次不发
 *   deniedTools() → 不许出现在她 QQ 会话里的全局工具名（给其他 DSH 会话用的联动工具）
 *   groupDecide(decision, info) → 改群聊「回不回、怎么回」的决定 { reply, mode, reason }
 *   prompt(content, info) → 改交给她的内容（文字 / 图片块）；返回 null 表示这次不交给她
 *   items(items, info) → 改拆好的回复（每条 { kind: text|voice|sticker|poke|image, value, replyTo }）
 *   send(message, info) → 改最终发出去的 OneBot 消息段；返回 null 表示不发
 *   model(selection, chat) → 这个聊天用哪个模型 { provider, model, reasoningEffort }（同步）；selection 已经按管理员「按聊天选模型」的设置算过
 *   poke(event) → true 表示戳一戳被模块接管了
 */
// 模拟测试：这里面发出去的消息只记下来，不真发
const captureStore = new AsyncLocalStorage()
const failStore = new AsyncLocalStorage() // deliver 这一次里发失败的原因，好让调用方如实告诉她
/**
 * 一轮结束时该发到 QQ 的文字：只认「这一轮最后一条 assistant 消息」里的 text 块。
 * 带工具调用的 assistant 消息是过程性发言（模型在调工具前写的计划/心里话），不是给用户看的回复；
 * 如果把它当回复补发，就会出现「模型把自己的思考发出来」——这种情况宁可沉默，也不要把过程性文字发出去。
 */
export function assistantReplyText (message) {
  if (!message || !Array.isArray(message.content)) return ''
  const hasToolCall = message.content.some((b) => b && (b.type === 'tool-call' || b.type === 'tool_use'))
  if (hasToolCall) return ''
  return message.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim()
}

export function createHub({ dsh, getConfig, log, channels, onebot, outbox, stickers, tts, buildTools, contextProviders, onActivity, memoryScore, onCommand, isMuted, dislikes, random = Math.random, moodEffects, localApi, hooks, availableModels, toolsGeneration, capabilitiesOf, mind, trashDir, purge }) {
  const purgeScope = purge || createPurgeScope({ log })
  const toolScope = createToolScope({ log })
  // 心情对行为的影响（表情 / 语音概率、回复快慢、插话积极程度），没接就是 1
  /** 她现在怎么叫管理员：心智核心里她自己改过就用她的，没改过用管理员设定的。 */
  const ownerLabel = () => { try { return mind?.ownerCall?.() || getConfig().ownerName || '管理员' } catch { return getConfig().ownerName || '管理员' } }
  const mood = () => (typeof moodEffects === 'function' ? moodEffects() : null) || { sticker: 1, voice: 1, delay: 1, chatty: 1 }
  // 聊天平台的连接：所有收发都经过它（见 src/channels/）
  if (!channels) channels = channelsFromOnebot({ onebot, outbox, getConfig, log })
  const channelOf = (chatId) => channels.of(chatId)
  /** 网关明确说没发出去（可以换一种方式再发）；超时、结果不确定的不算。 */
  const definiteFailure = (chatId, error) => Boolean(channelOf(chatId)?.isDefiniteFailure?.(error))
  const mapFile = () => dataDir('sessions.json')
  const map = () => readJson(mapFile(), () => ({ chats: {} }))
  const saveMap = (m) => writeJson(mapFile(), m)
  function audienceRevision(chatId) {
    const target = parseChat(chatId)
    if (!target || (target.kind === 'private' && isOwner(getConfig(), target.id, chatId))) return ''
    return mind?.audienceRevision?.() || ''
  }

  const mounted = new Map() // sessionKey → { agent, offs, chatId, toolsKey }  按会话记，agent 对象换了也能清掉旧工具（#90）

  const mounts = new Set() // 可遍历的挂载记录：插件卸载时要撤掉仍存活会话里的注册
  const toolDisposers = new Map() // `${sessionKey}|${工具名}` → disposer，防注册表里残留同名工具时挂不上（#90）
  const sessionToChat = new Map() // sessionKey → chatId
  const sessionTarget = new Map() // sessionKey → { provider, model }：记 token 用量时按这次会话用的模型计价
  const turnState = new Map() // sessionKey → { lastTurn, text, images, senders:Set, system?: {resolve, reject, timedOutAt} }
  const systemTurns = new Map() // chatId → 当前后台轮次，权限档位变化时也不能绕过它
  const systemStarting = new Set() // 建会话和恢复期间，同一个聊天只能有一个调用
  const systemFailures = new Map() // 已启动轮次的失败 / 超时恢复；建会话失败发生在它之前
  const sessionFailures = new Map() // chatId → 工作区挂载失败退避，QQ 和后台共用
  const sessionCreating = new Map() // chatId → 正在创建的 Promise，防 QQ 并发绕过退避
  const SESSION_BACKOFF_MS = [1, 5, 15, 30, 60].map((minutes) => minutes * 60_000)
  const SYSTEM_STUCK_GRACE_MS = 5 * 60_000
  const SYSTEM_BACKOFF = [2, 5, 15, 30, 60, 120].map((minutes) => minutes * 60_000)
  const groupBuf = new Map() // groupId → [{t, uid, nick, text, at, replyId, quote}]
  const groupInterjects = new Map() // groupId → [t]  她主动开口（插话、接话）的时间
  const groupSaid = new Map() // groupId → [t]  她每次在群里说话的时间（刹车用）
  const groupMusts = new Map() // groupId → [t]  她因被 @/叫到而必回的时间（每小时必回上限用；管理员触发的不计入）
  const groupRefs = new Map() // groupId → { 编号: { mid, uid } }  上一段提示词里的编号，引用回复用
  const groupEngaged = new Map() // groupId → 加入话题到什么时候（毫秒）
  const groupEngagedRun = new Map() // groupId → 没人叫她、连着接了几次话
  const ENGAGE_MS = 3 * 60_000
  const groupNames = new Map()
  const privateSources = new Map() // 带渠道的私聊 ID → 最近一次临时会话的来源群
  const recentMedia = createRecentMedia({ log }) // 最近发来的图片和表情，短期落盘恢复
  const recentFiles = new Map() // chatId → 最近发来的文件
  const stickerStash = createStickerStash({ file: () => dataDir('sticker-stash.json'), log })

  const slowNoticeSent = new Set() // sessionKey → 这一轮已经发过「正在做」提示（慢工具，issue #74）
  const slowTimers = new Map() // timer → sessionKey，轮次结束、替换挂载、卸载时一并撤销
  const pauses = new Set() // 拆条间隔：卸载时立即结束，后面的消息不再投递
  const replyWaits = new Set() // 正在等回复的后台轮次：卸载时立即拒绝，不用等模型或超时
  const sendChain = new Map() // chatId → 串行发送链：中间段和最后一段排同一条队列，保证发出顺序和生成顺序一致

  /**
   * 把一次发送排到该聊天队列的尾巴上，前一条发完（无论成败）再发下一条。
   * 中间段的 deliver 是不 await 的，连续几段各自在内部 await sendText + pause(bubbleDelay)，
   * 不排队就会交错，用户看到的消息顺序可能和生成顺序不一致（#214 review 提出）。
   */
  function chainSend (chatId, run, label) {
    const start = () => { try { return Promise.resolve(run()) } catch (error) { return Promise.reject(error) } }
    const prev = sendChain.get(chatId)
    // 队列空的时候直接同步开工：调用时机和没排队时完全一样，别因为多包一层 then 把时序往后挪
    const next = (prev ? prev.then(start, start) : start()).catch((error) => log.warn(label, error.message))
    sendChain.set(chatId, next)
    const done = () => { if (sendChain.get(chatId) === next) sendChain.delete(chatId) }
    next.then(done, done)
    return next
  }
  // 主动贴表情：看到消息就可能贴一个，跟「回不回复」无关——她可以只窥屏、不出声。
  // 概率跟 stickers.autoChance 同源（reactChance 留空即完全跟随），同样吃心情系数；
  // 每个会话每小时有上限（reactMaxPerHour），免得在热闹的群里变成刷屏。
  // 自己被禁言（isMuted）时不贴；自己发的消息在入口就 filtered 掉了。
  const reactStamps = new Map() // chatId → [时间戳]
  const REACT_POOL = ['呲牙', '偷笑', '调皮', '赞', '爱心', '笑哭', '捂脸', '玫瑰']
  async function maybeReact(msg) {
    try {
      const cfg = getConfig()
      // 贴表情也是「对外做了个动作」，必须和发消息走同一套闸（#216 review）：
      // 总开关关掉就什么都不做；试运行开着只记一笔，不真往对方消息上贴。
      if (cfg.enabled === false) return
      if (cfg.dryRun) {
        log.debug?.(`${msg.chatId}：试运行模式，不真贴表情`)
        return
      }
      if (cfg.stickers?.enabled === false || cfg.stickers?.react === false) return
      const chance = cfg.stickers?.reactChance ?? 0
      if (!(chance > 0) || !msg.messageId || msg.messageId === '0') return
      // 心智核心在：想不想贴、贴哪种由她（睡着、讨厌、正生 ta 气就不贴；按心情和这条在说什么挑）
      let wish = null
      try { wish = mind?.reactWish?.({ chatId: msg.chatId, userId: msg.userId, text: msg.text }) || null } catch (error) {}
      if (Math.random() >= chance * (wish ? wish.scale : mood().sticker)) return
      const cap = cfg.stickers?.reactMaxPerHour ?? 10
      const ts = Date.now()
      const recent = (reactStamps.get(msg.chatId) || []).filter((t) => ts - t < 3600_000)
      if (cap <= 0 || recent.length >= cap) { reactStamps.set(msg.chatId, recent); return }
      const channel = channelOf(msg.chatId)
      const faces = channel?.caps?.react && channel.faces
      if (!faces) return
      const pool = (wish?.pool || []).filter((n) => faces.idOf(n))
      const from = pool.length ? pool : REACT_POOL
      const name = from[Math.floor(Math.random() * from.length)]
      const id = faces.idOf(name)
      if (!id) return
      // NapCat 只按位数猜类型（data length > 3 → emoji 码点，否则系统表情）：
      // 四位以上的编号（EMCode 那种）会被当成码点送出去，QQ 收下但不渲染，贴出来是空白，直接不贴。
      if (String(id).length > 3) {
        log.debug?.(`跳过「${name}」（${id}）：编号超过三位，贴出去会是空白`)
        return
      }
      await channelOf(msg.chatId).react(msg.chatId, msg.messageId, id)
      recent.push(ts)
      reactStamps.set(msg.chatId, recent)
      log.info(`${msg.chatId}：给这条消息贴了个「${name}」（${id}）${wish ? '｜' + wish.why : ''}`)
      // 贴表情也是她做过的事：记进她的经历（不发消息）
      try { mind?.said?.({ chatId: msg.chatId, message: `（给${msg.nickname || msg.userId}刚才那条消息贴了个「${name}」）`, kind: 'reaction' }) } catch (error) {}
    } catch (error) {
      log.debug?.('贴表情失败：', error?.message || error)
    }
  }
  // 按头衔过滤是 QQ 才有的（群头衔），走 QQ 连接
  const titleFilter = createTitleFilter({ getConfig, onebot: { call: (a, p, o) => { const q = channels.get('qq'); return q ? q.call(a, p, o) : Promise.reject(new Error('没有 QQ 连接')) } }, log }) // 勾选的群里，头衔是某个词的成员（别的机器人）不理
  const groupMembers = new Map() // groupId → { at, list }  群成员（真 @ 时按名字找人，缓存 10 分钟）
  const noticesFor = new Map() // chatId → [一句话]  下次交给她时带上的群事件（撤回、禁言、进群……）
  const saidElsewhere = new Map() // chatId → [{ at, text }]  别处安排她在这里发的话，下次这个聊天交给她时补进去
  const outputSources = new Map() // 只保存本聊天实际渲染/注入的这一轮原文
  const outputScope = new AsyncLocalStorage() // 投递期间固定快照，下一轮渲染不能改掉它
  const turnSendLocks = new Map() // chatId → 多气泡发送 job；后台通知/补发等它结束
  function sourcesFor(chatId) {
    if (!outputSources.has(chatId)) outputSources.set(chatId, { chatId, system: new Map(), context: '', memory: [], userText: '' })
    return outputSources.get(chatId)
  }
  function cleaningFor(chatId) {
    const active = currentPromptSources()
    const sources = outputScope.getStore()?.chatId === chatId ? outputScope.getStore().sources : active || outputSources.get(chatId)
    const target = parseChat(chatId)
    const ownerPrivate = target?.kind === 'private' && isOwner(getConfig(), target.id, chatId)
    let protectedGrams
    let protectedTokens
    let shared
    let restrictedShares
    function protectedText(text) {
      if (!mind?.protectedText || !text.trim()) return false
      shared ??= mind.sharedText?.(chatId) || []
      for (const excerpt of shared) text = text.replaceAll(excerpt, ' ')
      const chars = normalizeForMatch(text).chars
      restrictedShares ??= (mind.restrictedShareText?.(chatId) || []).map((excerpt) => normalizeForMatch(excerpt).chars.join('')).filter(Boolean)
      if (restrictedShares.some((excerpt) => chars.join('').includes(excerpt))) return true
      if (!protectedGrams) {
        protectedGrams = new Set()
        protectedTokens = new Set()
        for (const value of mind.protectedText(chatId)) {
          const privateChars = normalizeForMatch(value).chars
          for (let i = 0; i + 10 <= privateChars.length; i++) protectedGrams.add(privateChars.slice(i, i + 10).join(''))
          for (const [, token] of value.matchAll(/(?:暗号|口令|密码|验证码)\s*(?:是|[：:=])\s*[`「“"']?([a-z\d_-]{4,32})\b/gi)) protectedTokens.add(token.toLowerCase())
        }
      }
      if (protectedTokens.size && text.toLowerCase().split(/[^a-z\d_-]+/).some((token) => protectedTokens.has(token))) return true
      for (let i = 0; i + 10 <= chars.length; i++) if (protectedGrams.has(chars.slice(i, i + 10).join(''))) return true
      return false
    }
    return {
      warn: (message) => {
        log.warn(`${chatId}：${message}`)
        const scope = outputScope.getStore()
        if (scope?.chatId === chatId) scope.blocked = true
      },
      allowPromptEcho: outputScope.getStore()?.chatId === chatId && outputScope.getStore().allowPromptEcho,
      promptSources: [...(sources?.system.size ? sources.system.values() : hooks?.secrets?.({ chatId }) || []), sources?.context || '', ...(sources?.memory || [])],
      userText: sources?.userText || '',
      ownerPrivate,
      protectedText: ownerPrivate ? undefined : protectedText,
    }
  }

  let disposed = false
  // 大文件下载口：网关在 Docker / 虚拟机里看不到本机路径、文件又大到不能塞 base64 时用（见 file-relay.js）
  const fileRelay = createFileRelay({ host: () => getConfig().files?.relayHost, log })
  const disposedError = () => Object.assign(new Error('Aurabot 插件已卸载'), { code: 'AURABOT_DISPOSED' })
  const assertActive = () => { if (disposed) throw disposedError() }

  // 拆条间隔可在卸载时立即结束，后面的消息不再投递。
  function pause(ms) {
    if (disposed) return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); pauses.delete(done); resolve() }
      const timer = setTimeout(done, ms)
      pauses.add(done)
    })
  }

  function clearSlowNotices(key) {
    for (const [timer, sid] of slowTimers) {
      if (key !== undefined && sid !== key) continue
      clearTimeout(timer)
      slowTimers.delete(timer)
    }
  }

  async function membersOf(groupId, platform = 'qq') {
    const key = `${platform}:${groupId}`
    const hit = groupMembers.get(key)
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.list
    try {
      const chatId = `${platform}:group:${groupId}`
      const list = await channelOf(chatId).members(chatId)
      groupMembers.set(key, { at: Date.now(), list })
      return list
    } catch (error) {
      log.debug('拉群成员失败，@ 按文字发：', error.message)
      return hit?.list || []
    }
  }
  const sentIds = new Set()
  const stats = { received: 0, sent: 0, voice: 0, stickers: 0, errors: 0, day: new Date().toDateString() }
  let selfId = ''
  let lastChatAt = 0
  let lastOwnerChatAt = 0
  let lastOwnerChatId = ''
  const lastPrivateAt = new Map() // QQ 号 → 最后一次和这个人私聊的时间（主动搭话白名单用）
  const lastPoker = new Map() // chatId → 最后一次戳她的人
  const lastSpeaker = new Map() // chatId → 群里最后说话的人
  const pokeAt = new Map() // chatId → 最后一次处理戳一戳的时间
  let lastBotToOwner = { at: 0, text: '' } // 她在管理员私聊里最后说的话

  function bump(k) {
    const d = new Date().toDateString()
    if (stats.day !== d) Object.assign(stats, { received: 0, sent: 0, voice: 0, stickers: 0, errors: 0, day: d })
    stats[k]++
  }

  // ---------- 聊天流水（给空间日记、主动搭话、面板用） ----------
  const { logChat, chatLogDays, chatLogOf, canReadChatLog, resetPruneForTest } = createChatLog({
    getConfig, log, trashDir, mind, hooks, cleaningFor,
  })

  /** 外部模块在 QQ 之外说的话：记进这个聊天，对方在 QQ 回她时她知道在接哪句（#133）。 */
  function noteSaid(chatId, text) {
    logChat(chatId, 'bot', text)
    saidElsewhere.set(chatId, [...(saidElsewhere.get(chatId) || []), { at: Date.now(), text: String(text).slice(0, 300) }].slice(-5))
  }

  // ---------- 工作区与会话 ----------
  async function ensureWorkspace(platform = 'qq') {
    const reg = dsh.workspaceRegistry || dsh.get('workspaceRegistry')
    if (!reg) throw new Error('宿主没有 workspaceRegistry')
    const dir = workspaceDirOf(getConfig(), platform)
    mkdirSync(dir, { recursive: true })
    const norm = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase()
    let ws = reg.list().find((w) => norm(w.path) === norm(dir))
    if (!ws) {
      const title = workspaceTitleOf(platform)
      ws = await reg.create(dir, title)
      log.info('建好了工作区「' + title + '」：' + dir)
    }
    return ws
  }

  function controller() {
    const c = dsh.get('sessionController')
    if (!c) throw new Error('宿主没有 sessionController（需要 DSH 桌面版 / Web 组合）')
    return c
  }

  function platformLabel(chatId) {
    const platform = parseChat(chatId)?.platform || channels.platforms?.()[0]
    return channels.get(platform)?.label || (platform === 'qq' ? 'QQ' : platform || '平台')
  }
  function titleFor(chat) {
    const owner = ownerLabel()
    const label = platformLabel(chat.chatId)
    if (chat.kind === 'system') {
      // 扩展模块传进来的 title 可能自带「QQ · 」前缀，别再拼一次
      const t = String(chat.title || '后台')
      return t.startsWith(`${label} · `) ? t : `${label} · ${t}`
    }
    if (chat.kind === 'group') return `${label} 群 · ${groupNames.get(groupKey(chat.chatId)) || chat.groupId}`
    const info = chatInfo(chat.chatId)
    const ownerId = String(getConfig().platforms?.[info.platform]?.ownerQQ || getConfig().ownerQQ || '')
    return info.id === ownerId ? `${label} · ${owner}私聊` : `${label} 私聊 · ${chat.nickname || chat.userId}`
  }

  // ---------- 新会话挂不上工作区：按 1、5、15、30、60 分钟退避（来自原项目 4d65ee7） ----------
  const workspacePlatform = (chatId) => parseChat(chatId)?.platform || 'qq'
  const workspacePathOf = (chatId) => workspaceDirOf(getConfig(), workspacePlatform(chatId))
  const isCurrentWorkspacePath = (path) => channels.platforms().some((p) => workspaceDirOf(getConfig(), p) === path)
  function sessionFailure(chatId) {
    const failure = sessionFailures.get(chatId)
    // 管理员换了工作区后立即允许尝试，不把旧工作区的故障带过去。
    if (failure && failure.workspacePath !== workspacePathOf(chatId)) {
      sessionFailures.delete(chatId)
      return null
    }
    return failure
  }
  function backoffError(chatId, failure, cause) {
    return Object.assign(new Error(`${chatId}：会话冷却中，${Math.ceil(Math.max(0, failure.until - Date.now()) / 60_000)} 分钟后再试${failure.message ? `；${failure.message}` : ''}`, cause ? { cause } : undefined), {
      code: SESSION_BACKOFF, chatId, retryAt: failure.until,
    })
  }
  const systemChatId = (name, scope = '') => {
    const suffix = String(scope || '').trim().replace(/[^\w:-]/g, '').slice(0, 32)
    return suffix ? `system:${name}:${suffix}` : `system:${name}`
  }
  /** 某个后台用途的会话在冷却中吗。 */
  function systemSessionCooldown(name, { key = '' } = {}) {
    const chatId = systemChatId(name, key)
    const failure = [sessionFailure(chatId), systemFailures.get(chatId)].find((item) => item && Date.now() < item.until)
    return failure ? { ...failure, chatId, retryAt: failure.until } : null
  }
  function freshSessionId(error, ws) {
    const details = error?.details ?? error?.data
    const structured = error?.code === 'session/workspace-attach-failed'
    const match = structured ? null : String(error?.message || '').match(/session ["']([^"']+)["'] was created but could not attach to workspace ["']([^"']+)["']/i)
    const sid = structured ? details?.sessionId : match?.[1]
    if (typeof sid !== 'string' || !sid || (structured ? details?.workspaceId : match?.[2]) !== ws.id) return ''
    if (sessionToChat.has(sessionKey(sid)) || Object.values(map().chats).some((entry) =>
      [entry.sessionId, ...Object.values(entry.sessions || {})].some((id) => sessionKey(id) === sessionKey(sid)))) return ''
    return sid
  }

  function workspaceHasSession(workspace, sid) {
    return (workspace.sessionIds || []).some((id) => sessionKey(id) === sessionKey(sid))
  }

  function recoveryWorkspace(ws, sid) {
    const reg = dsh.workspaceRegistry || dsh.get('workspaceRegistry')
    const workspaces = reg?.list?.() || []
    const current = workspaces.find((entry) => entry.id === ws.id && entry.path === ws.path)
    if (!current ||
        workspaces.some((entry) => entry.id !== ws.id && workspaceHasSession(entry, sid)) ||
        (reg.archivedSessionIds || []).some((id) => sessionKey(id) === sessionKey(sid))) return null
    return current
  }

  function recoveredAttachStillCurrent(ws, sid, workspacePath) {
    if (!isCurrentWorkspacePath(workspacePath)) return false
    const current = recoveryWorkspace(ws, sid)
    return Boolean(current && workspaceHasSession(current, sid))
  }

  async function recoverSessionAttach(error, ws, workspacePath, assertCurrent) {
    if (error?.code !== 'session/workspace-attach-failed' || !isCurrentWorkspacePath(workspacePath)) return ''
    const sid = freshSessionId(error, ws)
    if (!sid) return ''
    const current = recoveryWorkspace(ws, sid)
    if (!current) return ''
    assertActive()
    assertCurrent?.()
    if (!workspaceHasSession(current, sid) && typeof current.attachSession === 'function') {
      try { await current.attachSession(sid) }
      catch (cause) { log.debug?.('重试挂载新会话失败：', cause.message) }
    }
    assertActive()
    assertCurrent?.()
    return recoveredAttachStillCurrent(ws, sid, workspacePath) ? sid : ''
  }

  /** 只处理 create 确认的新会话，已有归属或已归档的会话交给宿主管理。 */
  async function cleanOrphan(error, ws, c) {
    const sid = freshSessionId(error, ws)
    const reg = dsh.workspaceRegistry || dsh.get('workspaceRegistry')
    if (!sid || (reg?.list?.() || []).some((workspace) => workspaceHasSession(workspace, sid)) ||
        (reg?.archivedSessionIds || []).some((id) => sessionKey(id) === sessionKey(sid))) {
      log.debug?.('新会话挂载失败：无法确认孤儿会话身份，未清理')
      return
    }
    const cleanup = typeof c.delete === 'function' ? c.delete : typeof c.close === 'function' ? c.close : null
    const archive = !cleanup && error?.code === 'session/workspace-attach-failed' && typeof reg?.archiveSession === 'function'
    if (!cleanup && !archive) { log.debug?.(`孤儿会话 ${sid} 无法清理：宿主 sessionController 没有删除或关闭接口`); return }
    try {
      const result = cleanup ? await cleanup.call(c, { sessionId: sid }) : await reg.archiveSession(sid)
      if (result === false || result?.ok === false) throw new Error(result?.message || '宿主拒绝清理')
      log.debug?.(`已${archive ? '归档' : '清理'}未挂上工作区的孤儿会话 ${sid}`)
    } catch (cleanupError) {
      log.debug?.(`孤儿会话 ${sid} 清理失败：${cleanupError.message}`)
    }
  }

  async function createSession(chat, level, assertCurrent) {
    const failure = sessionFailure(chat.chatId)
    if (failure && Date.now() < failure.until) throw backoffError(chat.chatId, failure)
    // 正式和调试是两条会话：按模式分开去重，切模式时不会被在途的旧创建挡住
    const creatingKey = chat.chatId + ':' + (getConfig().debug ? 'debug' : 'live')
    if (sessionCreating.has(creatingKey)) return sessionCreating.get(creatingKey)
    const task = Promise.resolve().then(() => createSessionNow(chat, level, assertCurrent))
    sessionCreating.set(creatingKey, task)
    try { return await task } finally { if (sessionCreating.get(creatingKey) === task) sessionCreating.delete(creatingKey) }
  }

  async function recordAttachFailure(chat, workspacePath, ws, c, error) {
    const previous = sessionFailure(chat.chatId)
    const count = (previous?.count || 0) + 1
    const tier = Math.min(count - 1, chat.kind === 'system' ? SESSION_BACKOFF_MS.length - 1 : 1)
    const delay = SESSION_BACKOFF_MS[tier]
    const message = `DSH 无法把新会话挂到工作区 ${workspacePath}，可在 DSH 里检查该工作区或删掉重建`
    const failure = { count, tier, until: Date.now() + delay, workspacePath, message, error: String(error?.message || error) }
    sessionFailures.set(chat.chatId, failure)
    if (!previous || tier > previous.tier) log.warn(`${chat.chatId}：${message}；${delay / 60_000} 分钟后再试${chat.kind === 'system' ? '' : '；QQ 消息已保留，下次消息到来时重试'}`)
    try { await cleanOrphan(error, ws, c) } catch (cleanupError) { log.debug?.(`检查孤儿会话失败，未清理：${cleanupError.message}`) }
    assertActive()
    throw backoffError(chat.chatId, failure, error)
  }

  async function createSessionNow(chat, level, assertCurrent) {
    const platform = parseChat(chat.chatId)?.platform || 'qq'
    const workspacePath = workspaceDirOf(getConfig(), platform)
    const ws = await ensureWorkspace(platform)
    assertActive()
    const preset = presetFor(level, getConfig())
    const c = controller()
    let r, recoveredFrom
    try {
      r = await c.create({ workspaceId: ws.id, agentPreset: preset })
    } catch (error) {
      if (disposed || !(error?.code === 'session/workspace-attach-failed' || /could not attach to workspace/i.test(String(error?.message || '')))) throw error
      const recovered = await recoverSessionAttach(error, ws, workspacePath, assertCurrent)
      assertActive()
      if (recovered) {
        r = { sessionId: recovered }
        recoveredFrom = error
      } else {
        await recordAttachFailure(chat, workspacePath, ws, c, error)
      }
    }
    assertActive()
    // 调试会话和正式会话分开，标题也标出来，免得在侧栏里点错
    const debug = getConfig().debug
    const title = titleFor(chat) + (debug ? '（调试）' : '')
    const sid = String(r.sessionId)
    try {
      await controller().rename({ sessionId: sid, title })
    } catch (error) {
      log.debug('改会话标题失败：', error.message)
    }
    // 旧实例在创建或改名期间卸载时，不能覆盖新实例的会话映射。
    assertActive()
    assertCurrent?.()
    if (recoveredFrom) {
      if (!recoveredAttachStillCurrent(ws, sid, workspacePath)) await recordAttachFailure(chat, workspacePath, ws, c, recoveredFrom)
      log.info(`${chat.chatId}：已将原会话重新挂到工作区`)
    }
    sessionFailures.delete(chat.chatId)
    const m = map()
    const prev = m.chats[chat.chatId] || {}
    const mode = debug ? 'debug' : 'live'
    // 每种模式各记一条：切回调试 / 正式时能接上原来那条；档位（preset / level）变了就都作废（来自原项目 2a89b90）
    const sessions = prev.preset === preset && prev.level === level ? { ...(prev.sessions || {}) } : {}
    const privacyRevision = { ...prev.privacyRevision, [mode]: audienceRevision(chat.chatId) }
    if (prev.sessionId && prev.preset === preset && prev.level === level && !sessions[prev.mode || 'live']) sessions[prev.mode || 'live'] = prev.sessionId
    sessions[mode] = sid
    m.chats[chat.chatId] = { ...prev, sessionId: sid, mode, sessions, privacyRevision, preset, level, createdAt: Date.now(), lastInput: 0, lastAt: 0, title }
    saveMap(m)
    log.info(`为 ${chat.chatId} 新建了 DSH 会话 ${sid.slice(-8)}（${preset}${debug ? '，调试' : ''}）`)
    return sid
  }

  async function resolveAgent(sid) {
    const live = dsh.agents.get(sid) || dsh.agents.get('session-' + sid)
    if (live) return live
    const r = await controller().resolveAgent(sid)
    if (r && r.agent) return r.agent
    const e = r && r.error
    throw Object.assign(new Error(e?.message || '恢复会话失败'), { code: e?.code })
  }

  const handoffEncodings = new Map()
  function encodeForHandoff(chatId) {
    if (!mind?.encodeChat || parseChat(chatId)?.kind === 'system' || getConfig().debug) return
    if (handoffEncodings.has(chatId)) return
    const task = Promise.resolve().then(() => mind.encodeChat(chatId))
      .catch((error) => log.debug('换新会话时记经历失败：', error.message))
      .finally(() => handoffEncodings.delete(chatId))
    handoffEncodings.set(chatId, { task, wait: null })
  }

  async function waitForHandoff(chatId) {
    const handoff = handoffEncodings.get(chatId)
    if (!handoff) return
    if (!handoff.wait) {
      let timer
      // 模型慢或额度不足时先用同聊天的近期原话接续，经历在后台接着记。
      handoff.wait = Promise.race([handoff.task, new Promise((resolve) => { timer = setTimeout(resolve, 1500) })])
        .finally(() => clearTimeout(timer))
    }
    await handoff.wait
  }

  /** 拿到这个 QQ 会话对应的活 agent（没有就建，权限档位变了就换新会话）。 */
  async function agentFor(chat) {
    const cfg = getConfig()
    const level = chat.kind === 'system' ? (chat.noTools ? 'chat' : 'social') : levelFor(cfg, chat)
    const preset = presetFor(level, cfg)
    const entry = map().chats[chat.chatId]
    // 调试和正式用不同的会话：不然切回正式时，调试期间那些对话还在上下文里，等于被她"记住"了
    const mode = cfg.debug ? 'debug' : 'live'
    // 每种模式各记一条（entry.sessions）；老数据没有 mode / sessions 字段的一律当正式（来自原项目 2a89b90 / 141c145）
    const sameLevel = Boolean(entry && entry.preset === preset && entry.level === level)
    let sid = sameLevel ? ((entry.sessions && entry.sessions[mode]) || ((entry.mode || 'live') === mode ? entry.sessionId : '')) : ''
    let agent = null
    const revision = audienceRevision(chat.chatId)
    if (sid && (entry.privacyBlocked?.[mode] === sid || (revision && entry.privacyRevision?.[mode] !== revision))) {
      archiveQuietly(sid)
      sessionToChat.delete(sessionKey(sid))
      turnState.delete(sessionKey(sid))
      sid = ''
    }
    const reg = optionalService('workspaceRegistry')
    if (sid && chat.kind !== 'system' && (reg?.archivedSessionIds || []).includes(sid)) {
      sessionToChat.delete(sessionKey(sid))
      turnState.delete(sessionKey(sid))
      log.info(`${chat.chatId} 的会话已归档，下一轮用新会话`)
      sid = ''
    }
    if (sid) {
      try {
        agent = await resolveAgent(sid)
      } catch (error) {
        assertActive()
        log.warn(`会话 ${sid.slice(-8)} 恢复不了（${error.message}），换一个新的`)
        sid = ''
      }
      assertActive()
      if (sid && reg && (reg.archivedSessionIds || []).includes(sid)) {
        // 后台专用会话继续复用。用户归档的真实聊天下一轮换新。
        let restored = false
        try {
          if (chat.kind === 'system' && reg.unarchiveSession) {
            await reg.unarchiveSession(sid)
            restored = true
          }
        } catch (error) {
          log.debug(`会话 ${sid.slice(-8)} 解归档失败：${error.message}`)
        }
        if (restored) {
          log.info(`会话 ${sid.slice(-8)} 被归档了，已解归档，继续用这间`)
        } else {
          log.info(`会话 ${sid.slice(-8)} 被归档了，换一个新的`)
          sid = ''
          agent = null
        }
      }
    }
    // 心智核心：上下文快到 DSH 自动压缩之前、或者停了很久，就换新会话。
    // 不靠会话历史活着：新会话里接上的话由心智的感知记录给（见 seedHistoryOnce）。
    // 这一轮还在跑时不换（新消息是排队或插话进去的）。
    if (sid && mind?.shouldRotate && chat.kind !== 'system' && !running.has(chat.chatId)) {
      let reason = ''
      try {
        const t = targetModel(chat)
        const contextWindow = t ? await modelContextWindow(dsh, t.provider, t.model) : 0
        assertActive()
        reason = mind.shouldRotate({ lastInput: Number(entry.lastInput) || 0, lastAt: Number(entry.lastAt || entry.createdAt) || 0, contextWindow })
      } catch (error) {
        log.debug('换会话判断失败（不换）：', error.message)
      }
      if (reason) {
        archiveQuietly(sid)
        log.info(`${chat.chatId} 换新会话（${reason}），旧会话 ${sid.slice(-8)} 保留历史`)
        sessionToChat.delete(sessionKey(sid))
        turnState.delete(sessionKey(sid))
        sid = ''
        agent = null
      }
    }
    if (!sid) {
      if (entry && mode === 'live') encodeForHandoff(chat.chatId)
      sid = await createSession(chat, level)
      assertActive()
      agent = await resolveAgent(sid)
    }
    assertActive()
    // 模型 / 思考强度和设置不一致就切过去（面板改了模型，下一条消息起生效）
    const target = await resolveTarget(chat)
    assertActive()
    const want = keyOf(target)
    const m = map()
    const entryModel = m.chats[chat.chatId]?.model
    const currentModel = typeof agent.model?.current === 'function' ? keyOf(agent.model.current()) : entryModel
    if (want && m.chats[chat.chatId] && (currentModel !== want || entryModel !== want)) {
      if (applyModel(agent, target)) {
        m.chats[chat.chatId].model = want
        saveMap(m)
        log.info(`${chat.chatId} 的模型切到 ${want}`)
      }
    }
    // 把这一轮实际用的会话写回映射：复用旧会话时映射可能还停在另一个模式那条，投递守卫会把回复当旧会话的丢掉（来自原项目 2ccbf73）
    const sync = map()
    const curEntry = sync.chats[chat.chatId] || {}
    if (curEntry.sessionId !== sid || (curEntry.mode || 'live') !== mode) {
      sync.chats[chat.chatId] = { ...curEntry, sessionId: sid, mode, sessions: { ...(curEntry.sessions || {}), [mode]: sid } }
      saveMap(sync)
    }
    sessionToChat.set(sessionKey(sid), chat.chatId)
    if (target) sessionTarget.set(sessionKey(sid), { provider: target.provider, model: target.model })
    mount(agent, chat, level)
    return { agent, sessionId: sid, level }
  }

  /**
   * 调试模式：把管理员私聊的调试会话先建出来。
   * 否则要等你先发一条 QQ 消息，侧栏里才会有会话可点 —— 而调试本来就是为了不碰 QQ。
   */
  async function ensureDebugSession() {
    const cfg = getConfig()
    if (!cfg.debug) return { ok: false, message: '没开调试模式' }
    if (!cfg.ownerQQ) return { ok: false, message: '还没填管理员 QQ' }
    const chat = { kind: 'private', chatId: `private:${cfg.ownerQQ}`, userId: String(cfg.ownerQQ), groupId: '', nickname: ownerLabel() }
    const before = map().chats[chat.chatId]
    const existed = Boolean(before && ((before.sessions && before.sessions.debug) || (before.mode || 'live') === 'debug'))
    const r = await agentFor(chat)
    if (!existed) log.info(`调试会话建好了：${r.sessionId.slice(-8)}（在左侧栏「Aurabot · QQ」里打开就能直接跟她说话）`)
    // 空会话在 DSH 侧栏里是看不见的：第一次建出来、或者之前那条还没开过场，就让她先打个招呼（来自原项目 a6c2220）。
    // 调试模式下这一轮只进日志，不发 QQ、不写进心智
    const entry = map().chats[chat.chatId]
    if (!entry?.debugSeeded && !isBusy(chat.chatId)) {
      const stillDebugging = () => !disposed && getConfig().debug && String(getConfig().ownerQQ) === chat.userId
      const reservation = Date.now()
      busy.set(chat.chatId, reservation)
      pushToSession(chat, [{ type: 'text', text: '（调试模式刚开始，这条只有你们俩在面板和侧栏里看得到。轻轻打个招呼，一句话就好。）' }], String(cfg.ownerQQ), {
        internal: true,
        assertAuthorized: () => { if (!stillDebugging()) throw new Error('调试模式已切换') },
      }).then(() => {
        const m = map()
        const saved = m.chats[chat.chatId]
        if (stillDebugging() && saved?.sessionId === r.sessionId && saved.mode === 'debug') {
          saved.debugSeeded = true
          saveMap(m)
        }
      }).catch((error) => {
        if (!disposed && busy.get(chat.chatId) === reservation) release(chat.chatId)
        log.debug('调试会话开场白失败：', error.message)
      })
    }
    return {
      ok: true, sessionId: r.sessionId, created: !existed,
      message: existed ? '调试会话已经在了：左侧栏没看到就刷新一下 DSH 页面；也可以直接用下面的「调试对话」说话' : '建好了一条调试会话，已经让她先打了个招呼：左侧栏「Aurabot · QQ」里刷新一下就能看到',
    }
  }

  /** 这个聊天要用的模型：管理员按聊天指定的 > 面板里选的全局模型（或 DSH 默认），扩展模块还可以再按聊天改。 */
  function targetModel(chat) {
    const cfg = getConfig()
    const t = defaultModel(dsh, cfg)
    let sel = t ? { provider: t.provider, model: t.model, reasoningEffort: cfg.model.reasoningEffort || '' } : null
    // 管理员按聊天指定的模型（私聊 QQ 号 > 群号 > 所有私聊 / 所有群默认）；没指定或指定的模型已不存在就用上面的
    try {
      const r = resolveChatModel(cfg, chat, typeof availableModels === 'function' ? availableModels() : null)
      if (r) sel = { provider: r.provider, model: r.model, reasoningEffort: r.reasoningEffort || cfg.model.reasoningEffort || '' }
    } catch (error) {}
    if (hooks?.model && chat) {
      try {
        const r = hooks.model(sel, chat)
        if (r && r.provider && r.model) sel = { reasoningEffort: '', ...r }
      } catch (error) {}
    }
    return sel
  }
  /**
   * 想要的思考强度要先按模型能力收敛：没有推理元数据的模型（本地 Ollama、部分手写 provider）
   * 只要收到 reasoningEffort 就会被 DSH 整轮拒掉（UNSUPPORTED_REASONING_EFFORT），
   * 等于这个模型直接没法用。不支持就不传这个参数，让 DSH 用模型自己的默认。
   */
  async function resolveTarget(chat) {
    const t = targetModel(chat)
    if (!t) return null
    const effort = await pickReasoningEffort(dsh, t.provider, t.model, t.reasoningEffort)
    return { provider: t.provider, model: t.model, ...(effort ? { reasoningEffort: effort } : {}) }
  }
  const keyOf = (t) => (t ? `${t.provider}::${t.model}::${t.reasoningEffort || ''}` : '')

  /** 让聊天会话用面板里选的模型和思考强度；只改这个会话，不改 DSH 的默认模型。 */
  function applyModel(agent, target) {
    try {
      if (!target) return false
      const sel = { provider: target.provider, model: target.model }
      if (target.reasoningEffort) sel.reasoningEffort = target.reasoningEffort
      // agent.model.select 只作用于当前会话。旧宿主用控制器内部的会话选择接口。
      if (typeof agent.model?.select === 'function') agent.model.select(sel)
      else {
        const agents = controller().agents
        if (typeof agents?.selectForNextRequest === 'function') agents.selectForNextRequest(agent, sel)
        else agent.session.append('model/selection', sel)
      }
      return true
    } catch (error) {
      log.debug('设置会话模型失败（用默认）：', error.message)
      return false
    }
  }

  function unmount(rec) {
    mounts.delete(rec)
    toolScope.releaseAgent(rec.agent)
    for (const off of rec.offs.splice(0).reverse()) {
      try { if (typeof off === 'function') off() } catch (error) { log.warn('注销会话挂载失败：', error.message) }
    }
  }

  function mount(agent, chat, level) {
    assertActive()
    const sid = sessionKey(agent.session?.id ?? agent.id)
    const tools = level !== 'chat' && typeof buildTools === 'function' ? buildTools({ chat, level, sessionId: sid }) : []
    const denied = (() => { try { return hooks?.deniedTools?.() || [] } catch (error) { return [] } })()
    // Purge 把宿主维护工具注册成全局工具，社交预设也会继承。只有完整权限的管理员私聊可以用它们。
    const configAtMount = getConfig()
    const ownerMaintenance = chat.kind === 'private' && level === 'full' && levelFor(configAtMount, chat) === 'full'
    const maintenanceRevision = ownerMaintenance ? ownerAuthorizationRevision(configAtMount) : ''
    const maintenanceBot = configAtMount.botQQ
    const maintenance = ownerMaintenance ? [] : purgeScope.toolNames(agent)
    // 模块（重）启动代际也进 key：热重载后工具名通常不变，但工具对象是旧实例的闭包（issue #73），
    // 只比名字会一直 return，会话里永远用旧实现/旧状态；带上代际就整套重挂。
    let gen = 0
    try { gen = typeof toolsGeneration === 'function' ? Number(toolsGeneration()) || 0 : 0 } catch (error) { gen = 0 }
    const maintenanceKey = ownerMaintenance ? `owner:${maintenanceBot}:${maintenanceRevision}` : maintenance.join(',')
    const toolsKey = tools.map((t) => t.name).sort().join(',') + '|' + denied.join(',') + '|' + maintenanceKey + '|gen:' + gen
    const prev = mounted.get(sid)
    // 工具清单变了（比如面板里开了生图）就整套重挂；同一个 agent 且没变就别动（改工具会让前缀缓存失效）
    if (prev && prev.agent === agent && prev.chatId === chat.chatId && prev.toolsKey === toolsKey) return
    if (prev) unmount(prev)
    const offs = []
    // 联动工具是给 DSH 其他会话用的，她自己的 QQ 会话里不该有（陌生人的会话更不行）
    if (denied.length) {
      try { offs.push(agent.ctx.tools.restrict({ deny: denied })) } catch (error) { log.debug('屏蔽联动工具：', error.message) }
    }
    if (maintenance.length) {
      try { offs.push(agent.ctx.tools.restrict({ deny: maintenance })) } catch (error) { log.warn('屏蔽宿主维护工具失败：', error.message) }
    }
    {
      for (const tool of tools) {
        try {
          // 慢工具（生图 / 翻唱……）卡超过 1.5 秒就先发一条提示：不让管理员以为她没收到（issue #74）。
          // 包装只加在挂给 agent 的这份工具上；面板里直接调工具（host 路由）照旧。
          const execute = async (args, exec) => {
            const state = turnState.get(sid)
            if (state?.rewriting || state?.recovering) return { ok: false, message: '这一步只重写回复正文' }
            if (state) state.retry = null
            if (isPrivilegedQqTool(tool.name) && !turnSendersAllOwner(sid)) return { ok: false, message: '只有管理员开口时才能使用这个工具。' }
            return tool.execute(args, exec)
          }
          let reg = { ...tool, execute }
          if (tool.slow) {
            const { slow, ...base } = tool
            const notice = typeof slow === 'string' ? slow : '好，我这就去做，做完跟你说一声。'
            reg = {
              ...base,
              async execute(args, exec) {
                let fired = false
                const token = running.get(chat.chatId)
                const isCurrent = () => !disposed && token !== undefined && running.get(chat.chatId) === token
                const timer = setTimeout(() => {
                  slowTimers.delete(timer)
                  if (fired) return
                  fired = true
                  if (!isCurrent()) return
                  if (slowNoticeSent.has(sid)) return
                  slowNoticeSent.add(sid)
                  sendText(chat.chatId, notice, undefined, [], undefined, { isCurrent }).catch((error) => log.debug('慢工具提示没发出去：', error.message))
                }, 1500)
                slowTimers.set(timer, sid)
                timer.unref?.()
                try {
                  return await execute(args, exec)
                } finally {
                  clearTimeout(timer)
                  slowTimers.delete(timer)
                }
              },
            }
          }
          // 注册表里如果残留同名工具（旧 agent 作用域/旧版泄漏），先把我们记着的旧 disposer 清掉再注册
          const dkey = sid + '|' + tool.name
          const stale = toolDisposers.get(dkey)
          if (stale) { try { stale() } catch (error) {} toolDisposers.delete(dkey) }
          const off = agent.ctx.tools.register(reg)
          toolDisposers.set(dkey, off)
          offs.push(() => { toolDisposers.delete(dkey); try { off() } catch (error) {} })
        } catch (error) {
          log.warn(`工具 ${tool.name} 挂不上：`, error.message)
        }
      }
    }
    try {
      offs.push(agent.ctx.systemPrompt.context({
        name: 'aurabot-context',
        order: 905,
        text: () => {
          const parts = []
          const active = currentPromptSources()
          const sources = active?.chatId === chat.chatId ? active : sourcesFor(chat.chatId)
          for (const p of contextProviders || []) {
            try {
              const t = p({ chat, sessionId: sid, publicOnly: sources.publicOnly === true, userText: sources.userText })
              if (t) parts.push(t)
            } catch (error) {}
          }
          if (chat.kind !== 'system') {
            const cfg = getConfig()
            parts.push(CHAT_STYLE_INSTRUCTION)
            if (cfg.chat?.thinkingGuard !== false) parts.push(CODE_INSTRUCTION, DIRECT_REPLY_INSTRUCTION)
            if (cfg.chat?.replyMarker) parts.push(MARKER_INSTRUCTION)
          }
          const text = cleanText(parts.join('\n\n'))
          sources.context = text
          outputSources.set(chat.chatId, sources)
          return text
        },
      }))
    } catch (error) {
      log.debug('挂上下文失败：', error.message)
    }
    if (chat.kind !== 'system' && !ownerMaintenance && level !== 'group-full') {
      offs.push(toolScope.restrictGuest(agent))
    }
    if (typeof agent.ctx.tools.guard === 'function') {
      const localNames = new Set(tools.map((tool) => tool.name))
      offs.push(agent.ctx.tools.guard((exec) => {
        const name = String(exec?.name || '')
        if (purgeScope.isTool(name)) {
          const current = getConfig()
          if (!ownerMaintenance || levelFor(current, chat) !== 'full' || current.botQQ !== maintenanceBot
            || ownerAuthorizationRevision(current) !== maintenanceRevision) return '宿主维护工具仅限完整权限的管理员私聊。'
          return
        }
        if (ownerMaintenance || localNames.has(name)) return
        if (chat.kind === 'group' && level === 'group-full' && turnSendersAllOwner(sid)) return
        if (chat.kind !== 'system' && !isGuestSafeTool(name)) return '当前会话没有本机或宿主工具权限。'
      }))
    }
    if (chat.kind === 'group' && level === 'group-full') {
      toolScope.openGate(sid, agent)
      toolScope.applyGate(sid, false) // 先收起，管理员开口那一轮再放开
    }
    const rec = { agent, chatId: chat.chatId, offs, toolsKey }
    mounted.set(sid, rec)
    mounts.add(rec)
  }

  // ---------- 发到 QQ ----------
  function targetOf(chatId) {
    return parseChat(chatId)
  }

  const onDelivered = createOnDelivered({
    isDisposed: () => disposed, parseChat, sentIds, mind, log, recordReply: (...args) => recordReply(...args), deliveredItems, bump,
  })

  // system：系统通知，不算她说的话。
  // quiet：额外消息（如语音后的表情）失败只写日志，不进入本轮错误列表。
  const sendSegments = createSendSegments({
    isDisposed: () => disposed, targetOf, cleaningFor, cleanOutboundSegments, hooks, log, outputScope,
    audienceRevision, getMind: () => mind, capOutboundText, captureStore, getConfig, channelOf,
    privateSources, normChat, deliveredItems, onDelivered, bump, failStore,
  })

  /** replyId：要引用回复的那条 QQ 消息（可选）。 */
  const quote = (replyId) => (replyId ? [{ type: 'reply', data: { id: String(replyId) } }] : [])

  const mention = (userId, segs = []) => (userId && !segs.some((s) => s.type === 'at' && String(s.data?.qq) === String(userId)) ? [{ type: 'at', data: { qq: String(userId) } }, { type: 'text', data: { text: ' ' } }] : [])

  const sendText = createTextSender({
    cleanOutboundText, cleaningFor, channelOf, getConfig, stripFaceTags,
    chatInfo, hasMention, membersOf, expandMentions, quote, mention,
    sendSegments, definiteFailure, log,
  })

  const sendVoice = createVoiceSender({
    cleanOutboundText, cleaningFor, channelOf, getConfig, audienceRevision, outputScope,
    mind, tts, sendText, sendSegments, log, failStore, definiteFailure,
  })

  const sendVoiceFile = createVoiceFileSender({ isDisposed: () => disposed, channelOf, getConfig, sendSegments, durationOf: (file) => audioDurationSec(file, getConfig) })

  // 发文件：网关可能和插件不在同一台机器上（Docker / 远程 OneBot），它看不到本机路径，
  // 所以按本机路径发失败时，小文件会用 base64 再试一次；超时留长一点，别把大文件上传误判成失败。
  // 安全默认（#52）：功能默认关；只允许发 QQ 工作区（她平时写文件的地方）和面板里额外加的目录里的文件；
  // 单个文件有大小上限；只在管理员私聊里能触发；发了什么会写进日志。
  const sendFile = createFileSender({
    isDisposed: () => disposed,
    getConfig,
    targetOf,
    channelOf,
    definiteFailure,
    cleanOutboundText,
    cleaningFor,
    captureStore,
    fileRelay,
    bump,
    log,
    workspaceDirOf,
  })

  const sendSticker = createStickerSender({ channelOf, getConfig, stickers, sendSegments, quote, mention, bump })

  /**
   * 发一张图。本地绝对路径（或 file://）先试「路径直发」——网关和 NapCat 在同一台机器/共享挂载时，省掉读盘和
   * base64 膨胀（#169）。只有网关明确拒绝（路径读不到、retcode 非 0）才改用 base64；超时、断线可能已经发出去了，
   * 再发会变成两张，所以不回退。files.imageByPath 关掉就一直是 base64。
   */
  const sendImage = createImageSender({
    isDisposed: () => disposed, getConfig, quote, mention, sendSegments, log, definiteFailure, fetchImage, maxBytes: MAX_IMAGE_BYTES,
  })

  const recordReply = createReplyJournal({
    chatInfo, groupKey, groupSaid, groupEngaged, engageMs: ENGAGE_MS, logChat, saidElsewhere,
    getConfig, itemsToLine, onActivity,
    touchLastChat: () => { lastChatAt = Date.now() },
    touchPrivate: (id) => lastPrivateAt.set(id, Date.now()),
    setLastBotToOwner: (value) => { lastBotToOwner = value },
  })

  // ---------- 盯 DSH 会话：一轮结束就发 ----------
  function textOf(message) {
    if (!message || !Array.isArray(message.content)) return ''
    return message.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim()
  }

  /** 记下这个会话最近一次请求的输入量和时间（换新会话用）。 */
  function noteUsage(chatId, key, usage) {
    try {
      const u = usage || {}
      const input = (Number(u.inputTokens) || 0) + (Number(u.cacheReadTokens) || 0) + (Number(u.cacheWriteTokens) || 0)
      const m = map()
      const e = m.chats[chatId]
      if (!e || sessionKey(e.sessionId) !== key) return
      if (input > 0) e.lastInput = input
      e.lastAt = Date.now()
      saveMap(m)
    } catch (error) {
      log.debug('记录会话用量失败：', error.message)
    }
  }

  const completedTurn = (d) => Boolean(d?.reason && d.reason.kind === 'completed')

  function blockSessionPrivacy(chatId, key) {
    const sessions = map()
    const entry = sessions.chats[chatId]
    if (!entry || (key && sessionKey(entry.sessionId) !== key)) return
    const mode = entry.mode || 'live'
    entry.privacyBlocked = { ...entry.privacyBlocked, [mode]: entry.sessionId }
    saveMap(sessions)
  }

  async function groupName(gid, platform = 'qq') {
    const chatId = parseChat(gid)?.kind === 'group' ? normChat(gid) : `${platform}:group:${gid}`
    const key = groupKey(chatId)
    if (groupNames.has(key)) return groupNames.get(key)
    try {
      // 查群名是锦上添花：失败就退回群号，别在网关抖动时白等重试
      const info = await channelOf(chatId)?.group?.(chatId)
      if (info?.name) groupNames.set(key, info.name)
    } catch (error) {}
    return groupNames.get(key) || gid
  }

  // ---------- 引用消息 ----------
  const quotedInfo = createQuoteResolver({ channelOf, getConfig, selfId, log })
  const quoteCache = quotedInfo.cache

  const { senderLabel, quoteImages, referenceImage, repliedToBot } = createReferenceTools({
    isDisposed: () => disposed, disposedError, getConfig, isOwner, quotedInfo, quoteCache, imagesOf: (...args) => imagesOf(...args),
    recentMedia, segmentBytes, channelOf, maxImageBytes: MAX_IMAGE_BYTES, sentIds, parseChat,
  })

  const { transcribe, localTranscribe } = createTranscriber({
    getConfig, channelOf, localApi, log, dsh, toMono16k, asrConfigured, transcribeAudio,
  })

  const { animatedNote, fitForModel, imagesOf } = createImageTools({
    getConfig, channelOf, segmentBytes, log, maxImageBytes: MAX_IMAGE_BYTES, maxMessageImages: MAX_MESSAGE_IMAGES, modelImageBytes: MODEL_IMAGE_BYTES,
  })

  /** 收到一条消息。msg 是连接拆好的通用形状（src/channels/qq/convert.js 的 parseMessageEvent）。 */
  /** 没触发回复的群消息带的图：如果正有一段在等她回，把图也带上（最多 4 张）。 */
  const pending = new Map() // chatId → { chat, texts, images, senders, wantVoice, timer, firstAt, mode, count }
  const attentionRetryTimers = new Map() // chatId → timer：注意力/忙碌兜底重试，dispose 时清理
  const secretaryLogs = new Map() // chatId → 最近几次秘书判断（面板排错用）
  const secretaryStatsFile = dataDir('secretary-stats.json')
  const secretaryStats = (() => { const v = readJson(secretaryStatsFile, {}); return v && typeof v === 'object' ? v : {} })()
  const busy = new Map() // chatId → 这一轮开始的时间（她正在想 / 正在发）
  const flushing = new Set() // chatId：flush 正在准备提示词/等网络，避免第二个定时器并发
  const BUSY_MAX_MS = 4 * 60_000 // 卡住保护：超过这么久就当她已经回完了
  const RANK = { engaged: 1, interject: 2, must: 3 }
  const running = new Map() // chatId → 这一轮的编号（模型 / 工具还没结束，turn/end 之前）；私聊此时新消息直接 steer 进去
  // 轮次兜底（来自原项目 9c8c0f5 / 077b56c）：模型或工具卡住时 turn/end 永远不来，running 一直挂着，
  // 后面的私聊消息全被当成 steer 塞进那一轮，看上去就是「不理人」。超过上限就强制放开，下一条消息正常开新一轮。
  const turnEpochs = new Map()
  const runningTimers = new Map() // chatId → timer
  let turnSeq = 0
  const turnMaxMs = () => {
    const mins = Number(getConfig()?.chat?.turnTimeoutMinutes)
    if (!Number.isFinite(mins)) return 30 * 60_000
    return mins <= 0 ? 0 : mins * 60_000 // 0 = 关掉兜底
  }
  function turnSessionCurrent(chatId, key) {
    if (disposed) return false
    if (chatId.startsWith('system:')) return true
    const entry = map().chats[chatId]
    const mode = getConfig().debug ? 'debug' : 'live'
    const revision = audienceRevision(chatId)
    return Boolean(entry && sessionKey(entry.sessionId) === key && (entry.mode || 'live') === mode && (!revision || entry.privacyRevision?.[mode] === revision))
  }
  const turnCurrent = (chatId, key, token) => turnEpochs.get(chatId)?.token === token && turnSessionCurrent(chatId, key)

  function rememberFinished(st, turn) {
    if (turn == null) return
    st.finishedTurns ??= new Set()
    st.finishedTurns.add(turn)
    if (st.finishedTurns.size > 24) st.finishedTurns.delete(st.finishedTurns.values().next().value)
  }

  /** 失败后只补写正文，旧轮次的工具和投递不会重放。 */
  function recoverReply(chatId, key, st, token, { timedOut = false } = {}) {
    const request = st.retry
    if (!request || st.recovering || !turnCurrent(chatId, key, token)) return false
    st.retry = null
    st.recovering = true
    clearRunning(chatId)
    busy.set(chatId, Date.now())
    let activeKey = key
    const active = () => {
      if (!turnCurrent(chatId, activeKey, token)) return false
      const cfg = getConfig()
      if ((!cfg.enabled && !cfg.debug) || !checkAllowed(cfg, request.chat).allowed || isMuted?.(chatId)) return false
      try { request.assertAuthorized?.(); return true } catch { return false }
    }
    const rotate = async () => {
      const old = map().chats[chatId]?.sessionId
      const fresh = await createSession(request.chat, levelFor(getConfig(), request.chat), () => {
        if (!active()) throw new Error('原会话已失效')
      })
      encodeForHandoff(chatId)
      activeKey = sessionKey(fresh)
      sessionToChat.delete(key)
      stopTyping(key)
      archiveQuietly(old)
    }
    const generate = async (context) => {
      const signal = AbortSignal.timeout(9000)
      const abort = new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      const out = await Promise.race([askModel(dsh, {
        cfg: getConfig(), model: request.model, system: request.persona + '\n' + context +
          '\n' + CHAT_STYLE_INSTRUCTION + '\n按人设回答对方刚说的话。只输出要交给对方的正文。不要声称执行了任何操作。',
        text: request.text, maxTokens: 400, reasoningEffort: 'low', module: 'chat-recovery', signal, retryEmpty: false,
      }), abort]).catch((error) => {
        log.debug('补写回复失败：', error?.code || error.name)
        return ''
      })
      const text = guardReply(out)
      return text && isSilence(text) ? null : text
    }
    void (async () => {
      if (timedOut) {
        const agent = mounted.get(key)?.agent
        if (typeof agent?.cancel !== 'function' || typeof agent?.whenIdle !== 'function') return
        const signal = AbortSignal.timeout(5000)
        await Promise.race([
          (async () => { await agent.cancel({ kind: 'user' }); await agent.whenIdle() })(),
          new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
        ])
      }
      if (!active()) return
      let text = await generate(String(mind.contextFor?.({ chat: request.chat, userText: request.text }) || '').slice(0, 1400))
      if (text === '' && active()) {
        if (activeKey === key) await rotate()
        if (active()) text = await generate('')
      }
      if (!text || !active()) return
      const waiter = debugWaiters.get(chatId)
      if (waiter) { debugWaiters.delete(chatId); waiter(text) }
      await deliver(chatId, text, { own: true, userText: request.text, isCurrent: active, sources: request.sources })
    })().catch((error) => log.debug('恢复聊天轮次失败：', error?.code || error.name))
      .finally(() => release(chatId, token))
    return true
  }

  function requestReplyRewrite(chatId, key, st) {
    st.rewriting = true
    busy.set(chatId, Date.now())
    st.text = ''
    st.lastTurn = -1
    st.interimTurn = null
    st.interimText = ''
    const token = markRunning(chatId, st, { rewrite: true })
    const agent = mounted.get(key)?.agent
    const fail = (error) => {
      if (!turnCurrent(chatId, key, token)) return
      log.debug('重写正文未完成：', error?.message || '会话不可用')
      release(chatId, token)
    }
    if (!agent?.followup) return fail()
    const request = { id: randomUUID(), role: 'user', content: [{ type: 'text', text: '请把上一轮的最终正文重写一次。保留原意，只输出给对方看的话，不要调用工具。' + MARKER_INSTRUCTION }], source: { kind: SOURCE_KIND, speaker: { role: 'none' } } }
    Promise.resolve().then(() => {
      if (turnCurrent(chatId, key, token)) return withPromptCapture(sourcesFor(chatId), () => agent.followup(request))
    }).catch(fail)
  }

  function markRunning(chatId, st, { rewrite = false } = {}) {
    const token = ++turnSeq
    running.set(chatId, token)
    turnEpochs.set(chatId, { token, st })
    if (st) {
      st.runToken = token
      st.activeTurn = null
      st.rewriting = rewrite
    }
    const old = runningTimers.get(chatId)
    if (old) { clearTimeout(old); runningTimers.delete(chatId) }
    const max = turnMaxMs()
    const limit = rewrite ? Math.min(max || 20000, 20000) : max
    if (!limit) return token
    const timer = setTimeout(() => {
      // 只放开卡住的那一轮：已经换成新一轮就别误伤
      if (running.get(chatId) !== token) return
      if (st) rememberFinished(st, st.activeTurn)
      log.warn(`${chatId}：${rewrite ? '重写回复' : '这一轮'}超时，强制放开`)
      if (!rewrite && st && recoverReply(chatId, sessionKey(map().chats[chatId]?.sessionId), st, token, { timedOut: true })) return
      release(chatId, token)
    }, limit)
    timer.unref?.()
    runningTimers.set(chatId, timer)
    return token
  }
  function clearRunning(chatId) {
    running.delete(chatId)
    const timer = runningTimers.get(chatId)
    if (timer) { clearTimeout(timer); runningTimers.delete(chatId) }
  }
  const isBusy = (chatId) => busy.has(chatId) && Date.now() - busy.get(chatId) < BUSY_MAX_MS

  function enqueue(chat, content, senderId, wantVoice, mode = 'must', extra = {}) {
    const m = getConfig().merge
    const p = pending.get(chat.chatId) || { chat, texts: [], images: [], observations: [], senders: new Set(), wantVoice: false, timer: null, firstAt: Date.now(), mode, count: 0 }
    p.chat = chat
    p.count++
    if ((RANK[mode] || 3) > (RANK[p.mode] || 3)) p.mode = mode
    for (const c of content) {
      if (c.type === 'text') p.texts.push(c.text)
      else if (c.type === 'image' && p.images.length < MAX_MESSAGE_IMAGES) p.images.push(c)
    }
    if (extra.stickerPick) p.stickerPick = (p.stickerPick || 0) + extra.stickerPick
    if (chat.kind === 'private' && senderId && extra.observedText) p.observations.push({ speaker: senderId, text: extra.observedText, replyId: extra.replyId })
    if (senderId) p.senders.add(String(senderId))
    if (mode === 'must' && senderId && mind?.mustReplyOwner?.(chat.chatId, senderId)) p.mustReply = true
    if (mode === 'must' && chat.kind === 'group' && senderId && !isOwner(getConfig(), senderId, chat.chatId)) p.nonOwnerCall = true
    p.wantVoice = p.wantVoice || wantVoice
    pending.set(chat.chatId, p)
    clearTimeout(p.timer)
    if (!m.enabled) return flush(chat.chatId)
    // 群里大家一来一回说得慢，多等一会儿把一段话攒齐
    const group = chat.kind === 'group'
    const wait = (group ? m.groupWaitSec : m.waitSec) * 1000
    const max = (group ? m.groupMaxSec : m.maxSec) * 1000
    const left = Math.max(0, max - (Date.now() - p.firstAt))
    p.timer = setTimeout(() => flush(chat.chatId), Math.min(wait, left))
    p.timer.unref?.()
  }

  function scheduleAttentionRetry(chatId, delay = 30_000) {
    if (disposed || attentionRetryTimers.has(chatId)) return
    const timer = setTimeout(() => {
      attentionRetryTimers.delete(chatId)
      if (!disposed && pending.get(chatId)?.waiting) flush(chatId).catch(() => {})
    }, delay)
    timer.unref?.()
    attentionRetryTimers.set(chatId, timer)
  }

  /** 可选的群聊秘书闸：用便宜模型先判断这段值不值得叫主模型；关着时零影响。 */
  function recordSecretary(chatId, allowed, reason = '') {
    const at = Date.now()
    const list = secretaryLogs.get(chatId) || []
    list.push({ at, allowed: Boolean(allowed), reason: String(reason || '').slice(0, 160) })
    secretaryLogs.set(chatId, list.slice(-20))
    try {
      const row = secretaryStats[chatId] || { allowed: 0, blocked: 0, lastAt: 0, days: {} }
      const day = new Date(at).toISOString().slice(0, 10)
      row.days = row.days || {}
      const today = row.days[day] || { allowed: 0, blocked: 0 }
      if (allowed) { row.allowed += 1; today.allowed += 1 } else { row.blocked += 1; today.blocked += 1 }
      row.days[day] = today
      row.days = Object.fromEntries(Object.entries(row.days).sort(([a], [b]) => b.localeCompare(a)).slice(0, 30))
      row.lastAt = at
      secretaryStats[chatId] = row
      writeJson(secretaryStatsFile, secretaryStats)
    } catch (error) { log.debug('秘书统计写入失败：', error.message) }
  }

  async function secretaryVeto(p) {
    const base = getConfig().chat?.secretary
    const sec = base?.groups?.[p.chat.chatId] ? { ...base, ...base.groups[p.chat.chatId] } : base
    if (!sec?.enabled || p.chat.kind !== 'group' || p.mode === 'must') return false
    const model = sec.provider && sec.model ? { provider: sec.provider, model: sec.model } : (targetModel(p.chat) || defaultModel(dsh, getConfig()))
    if (!model) return false
    const recent = (groupBuf.get(groupKey(p.chat.chatId)) || []).slice(-Math.max(1, Number(sec.maxRecent) || 20))
      .map((x) => `${x.nick || x.uid}: ${x.text || '（图片/表情）'}`)
    const text = [...recent, ...p.texts].filter(Boolean).join('\n').slice(0, 6000)
    try {
      const out = await askModel(dsh, {
        cfg: getConfig(), model,
        system: '你是群聊接话判断器。只根据这段聊天判断她此刻接一句是否自然、有价值。不要回复聊天内容。只输出 JSON：{"should_reply":true} 或 {"should_reply":false}。被明确叫到必须 true；没人叫她、话题接不上、刷屏或重复时 false。',
        text, maxTokens: 80, reasoningEffort: 'low', module: 'chat-secretary', signal: AbortSignal.timeout(8000), retryEmpty: false,
      })
      const raw = String(out || '').trim()
      const start = raw.indexOf('{'); const end = raw.lastIndexOf('}')
      if (start >= 0 && end > start) {
        const blocked = JSON.parse(raw.slice(start, end + 1)).should_reply === false
        recordSecretary(p.chat.chatId, !blocked, blocked ? '秘书判断不接' : '秘书判断可以接')
        return blocked
      }
    } catch (error) {
      log.debug('群聊秘书判断失败，按原逻辑继续：', error.message)
      recordSecretary(p.chat.chatId, true, '判断失败，放行：' + error.message)
    }
    return false
  }

  async function flush(chatId) {
    if (disposed) return
    const p = pending.get(chatId)
    if (!p) return
    if (flushing.has(chatId)) { p.waiting = true; return }
    flushing.add(chatId)
    try {
    clearTimeout(p.timer)
    // 「她挑」的提示统一在这里补：私聊、群聊、插话三条路都要带上
    const hint = p.stickerPick ? '\n\n' + stickerStash.hint(p.stickerPick) : ''
    // 私聊：她这一轮还在跑（想 / 调工具），新消息直接 steer 进当前这一轮，像在 DSH 界面里插话一样（#7）
    if (isBusy(chatId) && p.chat.kind === 'private' && running.has(chatId) && !turnEpochs.get(chatId)?.st?.rewriting) {
      pending.delete(chatId)
      if (p.count > 1) log.info(`${chatId}：合并了 ${p.count} 条消息一起插给她`)
      const content = [{ type: 'text', text: p.texts.join('\n') + hint }, ...p.images]
      const query = p.observations.map((x) => x.text).join('\n')
      const [first, ...rest] = [...p.senders]
      try {
        flushing.delete(chatId) // 已经进入这一轮，后续消息应走 steer，而不是被互斥挡在外面
        await pushToSession(p.chat, content, first, { wantVoice: p.wantVoice, extraSenders: rest, queryText: query, observations: p.observations, mustReply: p.mustReply, steer: true })
      } catch (error) {
        bump('errors')
        log.error(`插话进 DSH 失败（${chatId}）：`, error.message)
      }
      return
    }
    // 她还在回上一段：先攒着，回完了再交（release 会叫 flush）
    if (isBusy(chatId)) {
      p.waiting = true
      scheduleAttentionRetry(chatId, 35_000)
      return
    }
    // 心智核心：单一注意力——她正在别的聊天里回话，这一段先等着，回完再看（管理员的可以插队）
    if (attentionBlocked(chatId, p)) {
      p.waiting = true
      attentionQueue.set(chatId, { at: Date.now(), priority: attentionPriority(chatId, p) })
      // 兜底：那边卡住没 release，过一会儿再看一眼
      scheduleAttentionRetry(chatId)
      return
    }
    attentionQueue.delete(chatId)
    pending.delete(chatId)
    if (await secretaryVeto(p)) {
      // 判断为不接：把这段标成已读，避免下一条消息又把同一段重复交给她。
      for (const x of groupBuf.get(groupKey(chatId)) || []) x.fed = true
      log.debug(`${chatId}：群聊秘书判断这次不接`)
      return
    }
    if (p.count > 1) log.info(`${chatId}：合并了 ${p.count} 条消息一起交给她`)
    let content
    if (p.chat.kind === 'group') {
      const gkey = groupKey(p.chat.chatId)
      groupEngagedRun.set(gkey, p.mode === 'engaged' ? (groupEngagedRun.get(gkey) || 0) + 1 : 0)
      if (p.mode === 'interject' || p.mode === 'engaged') {
        const arr = (groupInterjects.get(gkey) || []).filter((t) => Date.now() - t < 3600_000)
        arr.push(Date.now())
        groupInterjects.set(gkey, arr)
      }
      // 必回也按小时记账：这段里只要有群友（非管理员）@/叫到她就记一次；管理员触发的不计入（管理员除外）
      if (p.mode === 'must' && p.nonOwnerCall) {
        const arr = (groupMusts.get(gkey) || []).filter((t) => Date.now() - t < 3600_000)
        arr.push(Date.now())
        groupMusts.set(gkey, arr)
      }
      // 上次会话建不起来时留下的那段（已经标成交给她了）：这次接在前面一起给，编号接着往下排
      const refOffset = Math.max(0, ...Object.keys(p.retryRefs || {}).map(Number))
      const gp = await groupPrompt(p.chat, p.mode, p.images, refOffset)
      if (disposed) return
      if (p.retryRefs) groupRefs.set(gkey, { ...p.retryRefs, ...groupRefs.get(gkey) })
      if (gp.speakers.length) lastSpeaker.set(chatId, [...p.senders].pop() || gp.speakers.at(-1))
      const fresh = [{ type: 'text', text: gp.text + hint }, ...gp.images]
      content = p.retryContent ? [...p.retryContent, ...fresh] : fresh
      p.query = [p.retryQuery, gp.query].filter(Boolean).join('\n')
      p.observations = [...(p.retryObservations || []), ...gp.observations]
      p.speakers = [...new Set([...(p.retrySpeakers || []), ...gp.speakers])]
      p.autoReply = gp.autoReply
    } else {
      content = [{ type: 'text', text: p.texts.join('\n') + hint }, ...p.images]
    }
    busy.set(chatId, Date.now())
    flushing.delete(chatId) // 后续消息由 isBusy/steer 处理，不再占用准备阶段的互斥
    try {
      const [first, ...rest] = [...p.senders]
      const query = p.query ?? (p.observations.length ? p.observations.map((x) => x.text).join('\n') : p.texts.map((t) => t.replace(/^【私聊】[^：]*：/, '')).join('\n'))
      await pushToSession(p.chat, content, first, { wantVoice: p.wantVoice, extraSenders: rest, queryText: query, observations: p.observations, speakers: p.speakers, autoReply: p.autoReply, mindDirect: p.chat.kind === 'private' || p.mode === 'must', mustReply: p.mustReply })
    } catch (error) {
      if (isSessionBackoff(error)) {
        // 会话建不起来、在冷却：这段原文和图片都留着，下一条消息来时一起重试（不设定时器）
        busy.delete(chatId)
        mind?.endTurn?.(chatId)
        retainSessionMessages(chatId, p, content)
        log.info(`${chatId}：${error.message}`)
        return
      }
      if (!error.aurabotTurnReleased) release(chatId)
      bump('errors')
      log.error(`转进 DSH 失败（${chatId}）：`, error.message)
    }
    } finally { flushing.delete(chatId) }
  }

  /** 会话冷却时把这段留下：群聊的已经标成交给她了，要连内容带编号一起留；期间又来的消息并进来。 */
  function retainSessionMessages(chatId, p, content) {
    if (p.chat.kind === 'group') {
      p.retryContent = content
      p.retryQuery = p.query
      p.retryObservations = p.observations
      p.retrySpeakers = p.speakers
      p.retryRefs = groupRefs.get(groupKey(p.chat.chatId)) || {}
      p.images = []
    }
    const next = pending.get(chatId)
    if (next) {
      clearTimeout(next.timer)
      p.texts.push(...next.texts)
      if (p.chat.kind === 'private') p.observations.push(...next.observations)
      p.images = [...p.images, ...next.images]
      for (const sender of next.senders) p.senders.add(sender)
      p.count += next.count
      p.wantVoice ||= next.wantVoice
      p.stickerPick = (p.stickerPick || 0) + (next.stickerPick || 0)
    }
    p.waiting = false
    p.timer = null
    pending.set(chatId, p)
  }

  /** 她这一轮说完了（或者没说）：放开，把这期间攒下的消息交给她。 */
  function release(chatId, token) {
    if (token !== undefined && turnEpochs.get(chatId)?.token !== token) return
    const state = turnEpochs.get(chatId)?.st
    if (state) {
      const key = sessionKey(map().chats[chatId]?.sessionId)
      if (turnState.get(key) === state) {
        slowNoticeSent.delete(key)
        clearSlowNotices(key)
        stopTyping(key)
      }
      rememberFinished(state, state.activeTurn)
      state.runToken = undefined
      state.activeTurn = null
      state.rewriting = false
      state.recovering = false
      state.retry = null
      state.deliveryReceipt?.(false)
      state.deliveryReceipt = null
      state.deliveryTokens = 0
    }
    turnEpochs.delete(chatId)
    const waiter = debugWaiters.get(chatId)
    if (waiter) { debugWaiters.delete(chatId); waiter('') }
    busy.delete(chatId)
    clearRunning(chatId)
    mind?.endTurn?.(chatId)
    const p = pending.get(chatId)
    if (p && p.waiting) {
      p.waiting = false
      flush(chatId).catch(() => {})
      return
    }
    drainAttention()
  }

  // ---------- 单一注意力（心智核心的设置）----------
  const attentionQueue = new Map() // chatId → { at, priority }：在等她回完别处的聊天
  const ownerIn = (p) => [...(p?.senders || [])].some((u) => isOwner(getConfig(), u, p.chat.chatId)) || (p?.chat?.kind === 'private' && isOwner(getConfig(), p.chat.userId, p.chat.chatId))
  function attentionPriority(chatId, p) {
    if (ownerIn(p)) return 3
    if (p?.chat?.kind === 'private') return 2
    if (p?.mustReply) return 1
    return 0
  }
  function attentionBlocked(chatId, p) {
    let a = null
    try { a = mind?.attention?.() } catch (error) {}
    if (!a?.single) return false
    if (a.ownerCuts && ownerIn(p)) return false
    return [...busy.keys()].some((k) => k !== chatId && !k.startsWith('system:') && isBusy(k))
  }
  /** 她回完一个聊天：看看谁在等（管理员的先，其次先来的）。 */
  function drainAttention() {
    if (!attentionQueue.size || disposed) return
    if ([...busy.keys()].some((k) => !k.startsWith('system:') && isBusy(k))) return
    const waiting = [...attentionQueue.entries()].filter(([id]) => pending.get(id)?.waiting)
    attentionQueue.clear()
    for (const [id, item] of waiting) attentionQueue.set(id, item)
    if (!waiting.length) return
    waiting.sort((a, b) => b[1].priority - a[1].priority || a[1].at - b[1].at)
    const next = waiting[0][0]
    attentionQueue.delete(next)
    const p = pending.get(next)
    if (p) p.waiting = false
    flush(next).catch(() => {})
  }

  const IMAGE_SOURCE_PREFIX = '【下一张图的来源】'

  function withoutImageBlocks(content, keep) {
    return content.filter((part, i) => {
      if (part.type === 'image') return part === keep
      if (part.type !== 'text' || !part.text.startsWith(IMAGE_SOURCE_PREFIX)) return true
      const next = content[i + 1]
      return next?.type !== 'image' || next === keep
    })
  }

  async function admit(content) {
    const images = content.filter((part) => part.type === 'image')
    if (!images.length) return content
    const att = optionalService('attachments')
    const nonImages = withoutImageBlocks(content)
    if (typeof att?.admitPromptContent === 'function') {
      try {
        return await att.admitPromptContent(content)
      } catch (error) {
        const code = String(error?.code || '')
        log.warn(`DSH 图片准入失败${code ? `（${code}）` : ''}：`, redact(error?.message || String(error)))
        // DSH 对整批图片原子校验。数量或总大小超限时，留一张可查看的图继续这一轮。
        if (images.length > 1 && ['TOO_MANY_IMAGES', 'IMAGES_TOO_LARGE'].includes(code)) {
          try {
            const first = images[0]
            const reduced = withoutImageBlocks(content, first)
            const admitted = await att.admitPromptContent(reduced)
            return [...admitted, { type: 'text', text: '（这次只交给你第一张图片，其余图片超出宿主的单次限制。）' }]
          } catch {}
        }
      }
    }
    return [...nonImages, { type: 'text', text: `（这次的 ${images.length} 张图片未能交给你查看，可请对方重发。）` }]
  }

  // 私聊里等她回复时，在 QQ 上显示「对方正在输入…」（模型慢的时候让人知道她在想）
  const typing = new Map() // sessionKey → timer
  function startTyping(key, chat) {
    if (disposed) return
    const cfg = getConfig()
    if (chat.kind !== 'private' || !cfg.enabled || cfg.dryRun || typing.has(key)) return
    const channel = channelOf(chat.chatId)
    if (!channel?.typing || !channel.caps?.typing) return
    const ping = () => { if (!disposed) channel.typing(chat.chatId).catch(() => {}) }
    ping()
    const started = Date.now()
    const t = setInterval(() => {
      if (Date.now() - started > 6 * 60_000) return stopTyping(key)
      ping()
    }, 15_000)
    t.unref?.()
    typing.set(key, t)
  }
  function stopTyping(key) {
    const t = typing.get(key)
    if (t) clearInterval(t)
    typing.delete(key)
  }

  // 新会话第一次收到消息时，补看最近几条历史（默认关，开 chat.seedHistory 才生效）
  const historySeeded = new Set()
  const historyReads = new Map()
  const historyRetry = new Set()

  /** 把 OneBot 的历史消息拍平成「谁：内容」。 */
  function flatHistory(list, allowSender) {
    const out = []
    for (const m of Array.isArray(list) ? list : []) {
      const senderId = String(m?.sender?.user_id ?? m?.user_id ?? '')
      if (!allowSender(senderId)) continue
      const who = m?.sender?.card || m?.sender?.nickname || m?.nickname || senderId
      let text = ''
      const seg = m?.message ?? m?.raw_message ?? ''
      if (typeof seg === 'string') text = seg
      else if (Array.isArray(seg)) text = seg.map((s) => (s?.type === 'text' ? (s.data?.text || '') : s?.type === 'image' ? '[图片]' : s?.type === 'face' ? '[表情]' : '')).join('')
      text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120)
      if (!who && !text) continue
      out.push(`${who}：${text}`)
    }
    return out
  }

  /** 只在这个会话第一次说话时，把最近的历史补给她的上下文。 */
  async function seedHistoryOnce(sessionId, chat, content, query) {
    const key = sessionKey(sessionId)
    if (historySeeded.has(key)) return content
    let withRecent = content
    try {
      const cfg = getConfig()
      if (!cfg.enabled || cfg.dryRun) return content
      // 心智核心记得这个聊天之前说过什么：直接接上（换新会话、重启后都一样）
      const protectedText = cleaningFor(chat.chatId).protectedText
      const current = content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n')
      const carried = mind?.carryOver?.(chat.chatId, { current, query, allowLine: (r) => !protectedText?.(r.text) })
      if (carried) withRecent = [{ type: 'text', text: carried }, ...content]
      if (carried && (!historyRetry.has(key) || !cfg.chat?.seedHistory)) {
        historySeeded.add(key)
        historyRetry.delete(key)
        log.info(`${chat.chatId}：新会话，接上之前的聊天`)
        return withRecent
      }
      if (!cfg.chat?.seedHistory) return content
      const count = Math.min(50, Math.max(1, Number(cfg.chat?.seedHistoryCount) || 20))
      const tgt = targetOf(chat.chatId)
      if (!tgt) return withRecent
      const channel = channelOf(chat.chatId)
      if (!channel?.history || !channel.caps?.history) return withRecent
      let reading = historyReads.get(key)
      if (!reading) {
        reading = Promise.resolve().then(() => channel.history(chat.chatId, count, { retries: 0 }))
          .catch((error) => { historyRetry.add(key); throw error })
          .finally(() => historyReads.delete(key))
        historyReads.set(key, reading)
      }
      const list = await reading
      if (historySeeded.has(key) || !getConfig().enabled || getConfig().dryRun || !getConfig().chat?.seedHistory) return content
      const lines = flatHistory(list, (id) => mind?.canSeedHistory?.(chat.chatId, id) ?? true)
        .filter((line) => !protectedText?.(line)).slice(-count)
      historySeeded.add(key)
      historyRetry.delete(key)
      if (!lines.length) return withRecent
      log.info(`${chat.chatId}：新会话，补看最近 ${lines.length} 条历史`)
      const block = `【你刚上线，先补看最近 ${lines.length} 条${tgt.kind === 'group' ? '群' : '私聊'}记录】\n${lines.join('\n')}\n【补看结束，接着回下面这条】`
      return [{ type: 'text', text: block }, ...content]
    } catch (error) {
      log.debug?.('补历史失败（不影响正常回复）：', error.message)
      return withRecent
    }
  }

  async function canSeeFor(chat) {
    const cfg = getConfig()
    if (cfg.model?.vision === 'on') return true
    if (cfg.model?.vision === 'off') return false
    const selected = targetModel(chat)
    return selected ? modelVision(dsh, selected.provider, selected.model) : null
  }

  /** 模型明确不支持看图：硬塞图片块会让整轮请求被拒（她就一个字都回不了），改成一行文字提示。 */
  async function dropUnseenImages(chat, content) {
    const count = content.filter((c) => c?.type === 'image').length
    if (!count || (await canSeeFor(chat)) !== false) return content
    log.debug(`模型不支持看图：${chat.chatId} 的 ${count} 张图换成文字提示`)
    return [...withoutImageBlocks(content), { type: 'text', text: `（这里有 ${count} 张图片，你现在的模型看不了图，只能知道有这么回事）` }]
  }

  async function pushToSession(chat, content, senderId, opts = {}) {
    assertActive(); opts.assertAuthorized?.()
    const busyForConfirmedDelivery = () => opts.confirmDelivery && (running.has(chat.chatId) || sendChain.has(chat.chatId) || turnEpochs.get(chat.chatId)?.st?.deliveryReceipt)
    if (busyForConfirmedDelivery()) return false
    const { agent, sessionId } = await agentFor(chat)
    if (!opts.steer) await waitForHandoff(chat.chatId)
    assertActive(); opts.assertAuthorized?.()
    const key = sessionKey(sessionId)
    const st = turnState.get(key) || { lastTurn: -1, text: '', senders: new Set() }
    // 上一句也带上：相关记忆检索遇到「嗯嗯」这种短句时，用上一句一起找（#79 之后由模块在提示词里加）
    const prevText = st.lastText || st.prevText || ''
    const previousSources = sourcesFor(chat.chatId)
    const sources = opts.steer ? previousSources : { chatId: chat.chatId, system: new Map(previousSources.system), context: previousSources.context, memory: [], userText: '' }
    // 只把注入块加入指纹；不能把用户正文当作系统提示。排队的轮次各持一份。
    const userText = String(opts.queryText ?? content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'))
    sources.userText += '\n' + userText
    if (hooks?.prompt) {
      try {
        const canShareRecent = getConfig().chat?.shareRecentWithModules && !opts.internal && senderId
          && [senderId, ...(opts.extraSenders || [])].every((id) => isOwner(getConfig(), id, chat.chatId))
        const recentMessages = canShareRecent ? mind?.recentUserMessages?.(chat, userText) || [] : []
        const next = await hooks.prompt(content, { chat, sessionId, senderId, prevText, ...opts, recentMessages })
        if (next === null) {
          log.info(`${chat.chatId}：扩展模块决定这次不交给她`)
          if (!opts.steer && !opts.confirmDelivery) release(chat.chatId) // 插话被拦下时，当前这一轮还在跑，不能放开
          return
        }
        if (Array.isArray(next)) content = next
      } catch (error) {
        log.warn('扩展模块改提示词出错：', error.message)
      }
    }
    content = await dropUnseenImages(chat, content)
    assertActive()
    // 心智核心：这一轮要看的话当线索，想起相关的事放进工作记忆（插话进行中的一轮不重新想）
    if (mind?.beforeTurn && !opts.steer) {
      try {
        const speakers = opts.speakers?.length ? opts.speakers : [senderId, ...(opts.extraSenders || [])]
        const plan = await mind.beforeTurn(chat, userText, speakers, { direct: opts.mindDirect !== false, observations: opts.observations })
        if (plan?.speak === false) return opts.confirmDelivery ? false : release(chat.chatId)
        const configured = getConfig()
        if (plan?.thinking && !running.has(chat.chatId) && !resolveChatModel(configured, chat)?.reasoningEffort &&
            (!configured.model.reasoningEffort || configured.model.reasoningEffort === 'low')) {
          const model = targetModel(chat)
          if (model && model.reasoningEffort !== plan.thinking) {
            const effort = await pickReasoningEffort(dsh, model.provider, model.model, plan.thinking)
            assertActive()
            applyModel(agent, { ...model, reasoningEffort: effort })
          }
        }
      } catch (error) { log.debug('心智准备回复失败：', error.message) }
      assertActive()
    }
    const happened = noticesFor.get(chat.chatId)
    if (happened?.length) {
      noticesFor.delete(chat.chatId)
      content = [{ type: 'text', text: `【这个聊天刚才发生的事，只是记录，不用逐条回应】\n${happened.join('\n')}\n` }, ...content]
    }
    const earlier = saidElsewhere.get(chat.chatId)
    if (earlier?.length) {
      saidElsewhere.delete(chat.chatId)
      const lines = earlier.map((x) => `${new Date(x.at).toTimeString().slice(0, 5)} 你：${x.text}`)
      content = [{ type: 'text', text: `【你之前在这个聊天里主动说过（是在别处安排下发的，这里的人都看到了）】\n${lines.join('\n')}\n` }, ...content]
    }
    if (opts.mustReply) content = [...content, { type: 'text', text: '【本轮回应要求】管理员正在叫你。请给他一条简短的正文回应；需要确认时问一句。' }]
    content = cleanContent(content)
    // 这一轮还在跑、这句是排队给下一轮的：额外记到 pendingSenders，等上一轮 turn/end 时接过去（#90）
    // ⚠ 不能用 busy：flush 一开始就把 busy 置上了，否则会把这一批自己的说话人塞进下一轮，
    //    管理员和群友混在一起会让「仅管理员」判断误拒（sticker-owner 回归抓到过）。
    if (busyForConfirmedDelivery()) return false
    const queuedNextTurn = !opts.steer && running.has(chat.chatId)
    const addSender = (u) => {
      st.senders.add(String(u))
      if (queuedNextTurn) {
        if (!st.pendingSenders) st.pendingSenders = new Set()
        st.pendingSenders.add(String(u))
      }
    }
    if (senderId) addSender(senderId)
    for (const s of opts.extraSenders || []) addSender(s)
    turnState.set(key, st)
    // 群聊本机工具按「这一轮说话的人」开合：全是管理员就放开，掺了别人就收回去
    if (chat.kind === 'group') toolScope.applyGate(key, turnSendersAllOwner(sessionId))
    // 上一句也留着：这一句太短（「嗯嗯」「然后呢」）时一起拿去想起相关的事
    if (st.lastText) st.prevText = st.lastText
    st.lastText = String(opts.queryText ?? content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')).slice(-600)
    const quoteId = opts.observations?.findLast(({ replyId }) => replyId)?.replyId || ''
    if (queuedNextTurn) st.pendingQuoteId = quoteId
    else if (!opts.steer || quoteId) st.quoteId = quoteId
    st.speakers = opts.speakers || (senderId ? [String(senderId), ...(opts.extraSenders || []).map(String)] : [])
    if (opts.wantVoice) st.wantVoice = true
    if (!opts.steer) st.autoReply = opts.autoReply || null
    content = await seedHistoryOnce(sessionId, chat, content, userText)
    const admitted = await admit(content)
    for (const block of admitted.filter((c) => c.type === 'text')) {
      for (const r of memoryPromptRanges(block.text, { toEndOfText: true })) sources.memory.push(block.text.slice(r.start, r.end))
    }
    assertActive(); opts.assertAuthorized?.()
    if (busyForConfirmedDelivery()) return false
    startTyping(key, chat)
    // 告诉同一会话里的其他插件是谁在说（#145）：说话的全是管理员才标 owner，混着别人或不知道是谁都是 guest。
    // chat 标私聊还是群聊：群里管理员说话也是 owner，但回复全群都看得到，要不要放私事由插件自己判断
    const speakers = (chat.kind === 'group' && opts.speakers?.length ? opts.speakers : [senderId, ...(opts.extraSenders || [])]).filter(Boolean).map(String)
    const speakerRole = opts.internal ? 'none' : speakers.length && speakers.every((u) => isOwner(getConfig(), u, chat.chatId)) ? 'owner' : 'guest'
    const message = { id: randomUUID(), role: 'user', content: admitted, source: { kind: SOURCE_KIND, speaker: { role: speakerRole, chat: chat.kind } } }
    // 正在跑的这一轮：steer = 下一步就看到这句（DSH 界面插话走的也是它）；空闲时照旧 followup 开新一轮
    outputSources.set(chat.chatId, sources)
    let receipt
    if (opts.steer && typeof agent.steer === 'function') {
      st.retry = null
      log.info(`${chat.chatId}：她还在忙，这句直接插进当前这一轮（steer）`)
      await withPromptCapture(sources, () => agent.steer(message))
    } else {
      const token = markRunning(chat.chatId, st)
      let receiptTimer
      if (opts.confirmDelivery) {
        receipt = new Promise((resolve) => {
          st.deliveryTokens = 0
          const finish = (delivered) => {
            clearTimeout(receiptTimer)
            resolve({ delivered, tokens: st.deliveryTokens })
          }
          st.deliveryReceipt = finish
          receiptTimer = setTimeout(() => finish(false), BUSY_MAX_MS)
          receiptTimer.unref?.()
        })
      }
      st.retry = null
      try {
        if (mind?.mind && senderId && !opts.internal && opts.mindDirect !== false && userText.trim() && admitted.every((block) => block.type === 'text')) {
          st.retry = { chat, text: userText.slice(-1800), persona: (ownerPrivateChat(sessionId) ? mind.mind.personaCard() : mind.mind.publicPersona().card).slice(0, 4500),
            model: sessionTarget.get(key), sources, assertAuthorized: opts.assertAuthorized, mustReply: opts.mustReply }
        }
      } catch (error) { log.debug('准备回复兜底失败：', error.name) }
      try {
        const followup = withPromptCapture(sources, () => agent.followup(message))
        if (receipt) await Promise.race([receipt, followup])
        else await followup
      }
      catch (error) {
        if (turnEpochs.get(chat.chatId)?.token !== token) return
        if (error?.code !== 'TOOL_ACTIVATION_FAILED' && !isSessionBackoff(error) && recoverReply(chat.chatId, key, st, token)) return
        release(chat.chatId, token)
        throw Object.assign(new Error(error?.message || String(error), { cause: error }), { code: error?.code, aurabotTurnReleased: true })
      }
    }
    try {
      if (dsh.sessions && typeof dsh.sessions.flush === 'function') await dsh.sessions.flush(agent.session)
    } catch (error) {}
    if (receipt) return receipt
  }

  /** 已验证管理员身份的外部入口；复用已有聊天、心智核心、转写和投递路径。调用方负责鉴权（移植自原项目 5cdbcd4）。 */
  async function receiveOwnerMessage(chatId, { text = '', image, wav, via = 'external', originId, assertAuthorized = () => {} } = {}) {
    const owner = String(getConfig().ownerQQ || '')
    const validate = () => {
      assertActive(); assertAuthorized()
      const cfg = getConfig()
      if (!cfg.enabled || !owner || String(cfg.ownerQQ || '') !== owner) throw Object.assign(new Error('请先启用 Aurabot 并配置管理员身份'), { status: 503, code: 'not_ready' })
      const match = /^(private|group):(\d+)$/.exec(String(chatId))
      if (!map().chats[chatId]?.sessionId || !match) throw Object.assign(new Error('会话不存在'), { status: 404, code: 'chat_not_found' })
      const chat = { chatId, kind: match[1], userId: match[1] === 'private' ? match[2] : owner, groupId: match[1] === 'group' ? match[2] : '', nickname: ownerLabel() }
      if (!checkAllowed(cfg, chat).allowed || isMuted?.(chatId)) throw Object.assign(new Error('这个聊天未开放或已暂停'), { status: 403, code: 'chat_disabled' })
      return chat
    }
    let chat = validate()
    const source = String(via || 'external').replace(/[\r\n【】]/g, '').slice(0, 40)
    if (wav) text = await transcribe({ records: [{ data: {} }], messageId: '' }, wav)
    const content = [{ type: 'text', text: `【${chat.kind === 'group' ? '群聊' : '私聊'} · ${source}】${chat.nickname}(${owner})：${text || '[图片]'}` }]
    if (image) {
      const bytes = await fitForModel(image)
      content.push({ type: 'image', data: bytes.toString('base64'), mediaType: mimeOf(bytes), name: 'external-image' })
    }
    chat = validate()
    // 心智核心：模块转进来的管理员消息和 QQ 里收到的一样记进她的感知（语音记转出来的字）
    try { mind?.perceive?.({ ...chat, text: text || '', images: image ? [{}] : [], messageId: originId ? `${source}:${originId}` : '' }) } catch (error) { log.debug('心智感知失败：', error.message) }
    logChat(chatId, chat.nickname, text || '[图片]', owner, { via: source, originId })
    lastChatAt = Date.now()
    if (chatId === `private:${owner}`) { lastOwnerChatAt = lastChatAt; lastOwnerChatId = chatId; lastPrivateAt.set(owner, lastChatAt) }
    onActivity?.({ kind: 'in', chatId, userId: owner, nickname: chat.nickname, text, direct: true, owner: true })
    await pushToSession(chat, content, owner, { queryText: text || '[图片]', steer: running.has(chatId) && !turnEpochs.get(chatId)?.st?.rewriting, assertAuthorized: validate })
    return { ok: true }
  }

  function systemFailed(chatId) {
    const count = (systemFailures.get(chatId)?.count || 0) + 1
    const delay = SYSTEM_BACKOFF[Math.min(count - 1, SYSTEM_BACKOFF.length - 1)]
    systemFailures.set(chatId, { count, until: Date.now() + delay })
    log.warn(`${chatId}：后台轮次失败，${delay / 60_000} 分钟后再试`)
  }

  /** 超时的轮次确实停稳并归档后，才能撤销挂载、换新会话。 */
  async function recoverSystemTurn(chatId, current) {
    const { agent, sessionId, key } = current
    current.needsRecovery = true
    if (typeof agent.cancel !== 'function' || typeof agent.whenIdle !== 'function') throw new Error('宿主没有取消或等待会话停止的能力')
    let timer
    try {
      await Promise.race([
        Promise.resolve().then(async () => { await agent.cancel({ kind: 'user' }); await agent.whenIdle() }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('等待旧后台轮次停止超时')), 15_000) }),
      ])
    } finally { clearTimeout(timer) }
    assertActive()
    const reg = dsh.workspaceRegistry || dsh.get('workspaceRegistry')
    if (typeof reg?.archiveSession !== 'function') throw new Error('宿主没有归档会话的能力')
    if (!current.archived && !(reg.archivedSessionIds || []).includes(sessionId)) {
      await archiveOwnedSession(sessionId)
      current.archived = true
    }
    assertActive()
    const rec = mounted.get(key)
    if (rec) { unmount(rec); mounted.delete(key) }
    sessionToChat.delete(key)
    turnState.delete(key)
    clearSlowNotices(key)
    slowNoticeSent.delete(key)
    const m = map()
    if (m.chats[chatId]?.sessionId === sessionId) {
      delete m.chats[chatId]
      saveMap(m)
    }
    systemTurns.delete(chatId)
    log.warn(`${chatId}：卡住的后台轮次已取消并归档，换新会话`)
  }

  /** 后台任务（写日记、主动搭话的草稿）：在专用会话里跑一轮，拿到正文但不自动转发。
   *  key：同一个模块有**多种**后台用途时用来分会话（如外部模块的不同后台用途）——
   *  不带 key 走 `<name>` 那条（向后兼容，老会话继续复用），带 key 走 `<name>:<key>`，
   *  于是工作区里各自一条会话、进度互不阻塞，也不会把两种提示词混进同一段上下文。 */
  function ownerPrivateChat(sessionId) {
    try {
      const id = chatOfSession(sessionId)
      const target = parseChat(id)
      return target?.kind === 'private' && isOwner(getConfig(), target.id, id)
    } catch (error) { return false }
  }

  function turnHasOwner(sessionId) {
    const st = turnState.get(sessionKey(sessionId))
    if (st && st.directOwner) return true // 管理员在 DSH 面板里直接打字
    const chatId = chatOfSession(sessionId)
    if (st && [...st.senders].some((u) => isOwner(getConfig(), u, chatId))) return true
    return ownerPrivateChat(sessionId)
  }

  /** 这一轮说话的人（QQ 号）。 */
  function turnSenders(sessionId) {
    return [...(turnState.get(sessionKey(sessionId))?.senders || [])]
  }

  function turnSendersAllOwner(sessionId) {
    const st = turnState.get(sessionKey(sessionId))
    if (st && st.directOwner && ownerPrivateChat(sessionId)) return true
    if (!st || !st.senders.size) return ownerPrivateChat(sessionId)
    const chatId = chatOfSession(sessionId)
    return [...st.senders].every((u) => isOwner(getConfig(), u, chatId))
  }

  function chatOfSession(sessionId) {
    const key = sessionKey(sessionId)
    const live = sessionToChat.get(key)
    if (live) return live
    // 重启后会话还没被第一条消息唤醒时，内存映射是空的：退回持久化的 聊天→会话 映射（#90 兜底要用）
    try {
      for (const [chatId, entry] of Object.entries(map().chats || {})) {
        if (!entry) continue
        if (entry.sessionId && sessionKey(entry.sessionId) === key) return chatId
      }
    } catch (error) {}
    return ''
  }

  /**
   * 这个 DSH 会话是不是 aurabot 自己开出来的（由 QQ 聊天映射过来）。
   * 管理员自己在 DSH 面板 / CLI 里开的会话不算——危险命令守卫是进程级钩子，
   * 会收到同一个 DSH 进程里所有会话的工具调用，得能把它们区分开。
   */
  function isOwnedSession(sessionId) {
    if (chatOfSession(sessionId)) return true
    // 刚挂上还没落盘时 chatOfSession 查不到，再看一眼 mounted
    return mounted.has(sessionKey(sessionId))
  }

  /**
   * 面板里的调试对话（来自原项目 f476866，改成走正常的管理员私聊链路）：
   * 交给她的内容和真的 QQ 私聊一样（带上此刻、记忆、心情、眼前的人），所以能试出她真实的样子；
   * 调试模式下不发 QQ、不写进心智，回复只交回面板和日志。
   */
  const debugWaiters = new Map() // chatId → resolve
  async function debugSay(text, { timeoutMs = 180000 } = {}) {
    const cfg = getConfig()
    if (!cfg.debug) return { ok: false, message: '没开调试模式' }
    if (!cfg.ownerQQ) return { ok: false, message: '还没填管理员 QQ' }
    const say = String(text || '').trim().slice(0, 2000)
    if (!say) return { ok: false, message: '说点什么吧' }
    const owner = String(cfg.ownerQQ)
    const chat = { kind: 'private', chatId: `private:${owner}`, userId: owner, groupId: '', nickname: ownerLabel() }
    if (isBusy(chat.chatId)) return { ok: false, message: '她还在回上一句，等一下' }
    log.info(`[调试] 面板 → ${chat.chatId}：${say.slice(0, 300)}`)
    let timer
    const reply = new Promise((resolve, reject) => {
      debugWaiters.set(chat.chatId, resolve)
      timer = setTimeout(() => { debugWaiters.delete(chat.chatId); reject(new Error(`等太久了（超过 ${Math.round(timeoutMs / 1000)} 秒）`)) }, timeoutMs)
    }).finally(() => clearTimeout(timer))
    try {
      busy.set(chat.chatId, Date.now())
      await pushToSession(chat, [{ type: 'text', text: `【私聊】${chat.nickname}(${owner})：${say}` }], owner, { queryText: say })
      const out = await reply
      log.info(`[调试] bot → 面板：${String(out || '（她没说话）').slice(0, 300)}`)
      return { ok: true, text: out }
    } catch (error) {
      debugWaiters.delete(chat.chatId)
      release(chat.chatId)
      return { ok: false, message: error.message }
    }
  }

  /** 一个聊天记着的所有会话（正式 + 调试，去重）。 */
  const sessionsOf = (e) => [...new Set([e.sessionId, ...Object.values(e.sessions || {})].filter(Boolean))]

  async function archiveOwnedSession(sessionId) {
    const reg = optionalService('workspaceRegistry')
    if (typeof reg?.archiveSession !== 'function') throw new Error('宿主没有归档会话的能力')
    if ((reg.archivedSessionIds || []).includes(sessionId)) return 'archived'
    const query = optionalService('sessionQuery')
    // DSH 的归档可以触发工作树清理。读取公开的会话快照，保留有自行创建工作树记录的会话。
    if (typeof query?.observeSession === 'function') {
      let observation
      try {
        observation = await query.observeSession(sessionId, { projectionMode: 'none', signal: AbortSignal.timeout(3000) })
        const inherited = Number(observation.inheritedEventCount) || 0
        if (observation.events.some((event) => event.seq >= inherited && event.type === 'plugin:worktree/created' && event.ignorable === true)) return 'retained'
      } catch (error) {
        log.debug(`无法核对会话 ${String(sessionId).slice(-8)} 的工作树，保留该会话：`, error.message)
        return 'retained'
      } finally { observation?.[Symbol.dispose]?.() }
    } else if (optionalService('worktrees')) {
      return 'retained'
    }
    const result = await reg.archiveSession(sessionId)
    if (result === false || result?.ok === false) throw new Error(result?.message || '归档会话失败')
    return 'archived'
  }

  function archiveQuietly(sessionId) {
    archiveOwnedSession(sessionId).then((state) => {
      if (state === 'retained') log.info(`保留会话 ${String(sessionId).slice(-8)}，避免归档时清理工作树`)
    }).catch((error) => log.debug('归档会话失败：', error.message))
  }

  /** 只让一个聊天重新开始，下一条消息开新会话。 */
  function resetChat(chatId) {
    const m = map()
    const e = m.chats[chatId]
    if (!e) return false
    encodeForHandoff(chatId)
    // 正式和调试两条都归档
    for (const sid of sessionsOf(e)) {
      archiveQuietly(sid)
      sessionToChat.delete(sessionKey(sid))
      turnState.delete(sessionKey(sid))
      stopTyping(sessionKey(sid))
      clearSlowNotices(sessionKey(sid))
    }
    outputSources.delete(chatId)
    delete m.chats[chatId]
    saveMap(m)
    release(chatId)
    log.info(`${chatId} 重新开始`)
    return true
  }

  /** 只断开 AuraBot 自己映射的聊天会话。共享工作区的其它 DSH 会话由用户管理。 */
  async function resetSessions() {
    const m = map()
    const chats = Object.entries(m.chats)
    const ids = new Set()
    for (const [chatId, entry] of chats) {
      encodeForHandoff(chatId)
      for (const sid of sessionsOf(entry)) {
        ids.add(sid)
        sessionToChat.delete(sessionKey(sid))
        turnState.delete(sessionKey(sid))
        stopTyping(sessionKey(sid))
        clearSlowNotices(sessionKey(sid))
      }
      outputSources.delete(chatId)
      delete m.chats[chatId]
    }
    saveMap(m)
    for (const [chatId] of chats) release(chatId)
    const result = { archived: 0, retained: 0, failed: 0 }
    for (const id of ids) {
      try { result[await archiveOwnedSession(id)]++ }
      catch (error) { result.failed++; log.debug('归档会话失败：', error.message) }
    }
    return result
  }

  /** 模拟测试：fn 里发出去的消息都记下来不真发，返回 { result, sent }。 */
  async function capture(fn) {
    const sent = []
    const result = await captureStore.run(sent, fn)
    return { result, sent }
  }
  /** 模拟测试：假装这个会话这一轮是谁在说话（工具里的「管理员才能用」靠它判断）。 */
  function simulateTurn(sessionId, senders) {
    turnState.set(sessionKey(sessionId), { lastTurn: -1, text: '', senders: new Set(senders.map(String)) })
  }

  // ---------- 子智能体委派（DSH subagent 服务，spawn 后端 + delivery:'caller'）----------
  const subagentParentChat = { chatId: 'system:ext-subagent-parent', kind: 'system', title: '子智能体调度' }
  let subagentParentAgent = null // 常驻父级 agent：spawn 子级必须有活的 parent 句柄，这里挂一次反复用
  const subagentRuns = new Set()

  function optionalService(name) {
    try { return dsh.get?.(name) ?? dsh[name] } catch { return null }
  }

  function disposeActivation(activation) {
    if (typeof activation?.dispose === 'function') {
      Promise.resolve().then(() => activation.dispose()).catch((error) => log.debug('释放子智能体失败：', error.message))
    }
  }
  async function subagentParent() {
    if (subagentParentAgent) {
      const live = dsh.agents?.get?.(subagentParentAgent.id) || dsh.agents?.get?.('session-' + subagentParentAgent.id)
      if (live === subagentParentAgent) return subagentParentAgent // 还活着就直接复用
      subagentParentAgent = null
    }
    // 父级不能 noTools：spawn 子级继承父级的工具配置，父级没工具子级就拿不到 shell，跑不了 adb。
    // 父级本身从不发起回合（只当 spawn 挂钩），带工具没有副作用。
    const { agent } = await agentFor(subagentParentChat)
    subagentParentAgent = agent
    return agent
  }

  /** 现在这次调用算不算「管理员开口」：最近 5 分钟有管理员私聊消息算 owner，否则后台（一审 #177 复审：source 由宿主判断）。 */
  const OWNER_ACTIVE_MS = 5 * 60_000
  function ownerSourceNow() {
    if (lastOwnerChatAt && lastOwnerChatId && Date.now() - lastOwnerChatAt <= OWNER_ACTIVE_MS) return { kind: 'owner', chatId: lastOwnerChatId }
    return { kind: 'system', reason: 'background' }
  }

  /**
   * 宿主给模块的委派入口（模块 API 层唯一暴露的形态）：moduleId 由宿主注入、source 由宿主判断，
   * 调用方传的 moduleId / source 一律不认——模块写 `moduleId: 'phone'` 也变不成别人（一审 #177 复审第 1 条）。
   */
  function subagentFor(moduleId) {
    return (name, title, prompt, opts = {}) => runSubagentTurn(name, title, prompt, { ...opts, moduleId, source: ownerSourceNow() })
  }

  /**
   * 子智能体委派：spawn 一个全新子 agent（空对话、继承工作目录与模型）跑一轮自足任务，
   * 结果经 Promise 直接返回给调用方——不占用工作区会话窗的常规聊天流（子级按 subagent 族归档展示）。
   * 调用方（模块）自己把关：任务提示词必须自足（子级看不到任何对话历史）。
   * @returns {Promise<string>} 子智能体的最终输出文本
   */
  function dispose() {
    if (disposed) return
    disposed = true
    fileRelay.close()
    // 三审 #177：常驻的子智能体父级 agent 一并置空——插件重装/重启后下次 spawn 重新建，
    // 别攥着旧句柄不放（旧的父会话交给 DSH 自己的会话回收去清）。
    subagentParentAgent = null
    for (const run of subagentRuns) run.abort(disposedError())
    subagentRuns.clear()
    for (const p of pending.values()) clearTimeout(p.timer)
    pending.clear()
    for (const key of [...typing.keys()]) stopTyping(key)
    for (const done of [...pauses]) done()
    for (const wait of [...replyWaits]) {
      clearTimeout(wait.timer)
      try { wait.reject(disposedError()) } catch (error) {}
    }
    replyWaits.clear()
    clearSlowNotices()
    slowNoticeSent.clear()
    for (const rec of [...mounts]) unmount(rec)
    toolScope.closeAll()
    mounted.clear()
    toolDisposers.clear()
    sessionToChat.clear()
    for (const st of turnState.values()) st.deliveryReceipt?.(false)
    turnState.clear()
    outputSources.clear()
    systemTurns.clear()
    systemStarting.clear()
    systemFailures.clear()
    privateSources.clear()
    quoteCache.clear()
    busy.clear()
    for (const timer of runningTimers.values()) clearTimeout(timer)
    runningTimers.clear()
    for (const timer of attentionRetryTimers.values()) clearTimeout(timer)
    attentionRetryTimers.clear()
    for (const map of [groupBuf, recentFiles, sendChain, turnSendLocks, reactStamps, noticesFor, saidElsewhere, groupSaid, groupInterjects, groupMusts, groupRefs, groupEngaged, groupEngagedRun, groupNames, lastPoker, lastSpeaker, pokeAt, lastPrivateAt, attentionQueue, debugWaiters, handoffEncodings, historySeeded, historyReads, historyRetry, sessionFailures, sessionCreating, stickerStash]) { try { map?.clear?.() } catch {} }
    turnEpochs.clear()
    secretaryLogs.clear()
    running.clear()
    recentMedia.dispose()
  }

  const onSessionEvent = createSessionEventHandler({
    sessionKey, sessionToChat, chatOfSession, turnState, running, turnCurrent, markRunning,
    sessionTarget, moduleOfTool, recordUsage, moduleLabel, reasoningOf, assistantReplyText,
    cleaningFor, blockSessionPrivacy, log, getConfig, getMind: () => mind, noteUsage, takeInterim, extractReply,
    guardReply, chainSend, deliver: (...a) => deliver(...a), map, audienceRevision, release, rememberFinished,
    slowNoticeSent, clearSlowNotices, clearRunning, stopTyping, rescueFromThinking, isSilence,
    requestReplyRewrite, completedTurn, redact, recoverReply, debugWaiters, turnSessionCurrent,
    outputSources, turnEpochs, sendChain,
  })

  const onMessage = createOnMessageHandler({
    LEGACY_PLATFORM, addGroupImages: (...a) => addGroupImages(...a), animatedNote, bump, canSeeFor, channelOf, checkAllowed,
    decideGroupReply, dislikes, enqueue, forwardBody, getConfig, groupBuf, groupEngaged,
    groupEngagedRun, groupInterjects, groupKey, groupMusts, groupSaid, hooks, imagesOf,
    indentBody, inlineLabel, isMuted, isOwner, log, logChat, maybeReact, memoryScore, mood,
    normChat, onActivity, onCommand, ownerAuthorizationRevision, parseChat, pending, policyFor,
    privateSources, quoteImages, quoteInline, quotedInfo, random, recentFiles, recentMedia,
    repliedToBot, sendSegments, senderLabel, sleep, stickerStash, stickers, titleFilter, lastPoker, lastPrivateAt, lastSpeaker, pokeAt,
    topicRelevance, transcribe, wantsVoice,
    getMind: () => mind, getSelfId: () => selfId, setSelfId: (value) => { selfId = value },
    setLastChat: (value) => { lastChatAt = value },
    setLastOwner: (at, chatId) => { lastOwnerChatAt = at; lastOwnerChatId = chatId },
    isDisposed: () => disposed,
  })

  const { onNotice, onPoke } = createNotifyEvents({
    getConfig, channels, logChat, noticesFor, sentIds, isDisposed: () => disposed,
    hooks, titleFilter, channelOf, lastPoker, pokeAt, log, onMessage: (...args) => onMessage(...args),
  })

  const deliverTurn = createDeliverTurn({
    audienceRevision, blockSessionPrivacy, bubbleDelay, capOutboundText, chatInfo, cleanOutboundSegments,
    cleanOutboundText, cleaningFor, dataDir, failStore, getConfig, groupKey, groupRefs, guardReply, hooks,
    isDisposed: () => disposed, localImageBlocked, log, mood, outputScope, parseReply, pause, polishChatProse,
    sendImage: (...a) => sendImage(...a), sendSticker: (...a) => sendSticker(...a),
    sendText: (...a) => sendText(...a), sendVoice: (...a) => sendVoice(...a),
    silenceTurn: (...a) => silenceTurn(...a), stickers, turnSendLocks, workspaceDirOf, getMind: () => mind,
    recordReply: (...a) => recordReply(...a), pokeBack: (...a) => pokeBack(...a),
  })

  const runSubagentTurn = createRunSubagentTurn({
    assertActive, capabilitiesOf, disposeActivation, getConfig, getMind: () => mind, optionalService,
    resolveTarget, subagentParent, subagentParentChat, subagentRuns,
  })

  const runSystemTurn = createRunSystemTurn({
    SOURCE_KIND, SYSTEM_STUCK_GRACE_MS, agentFor, assertActive, chatOfSession, cleanText, getConfig,
    getMind: () => mind, isDisposed: () => disposed, isOwner, parseChat, randomUUID, recoverSystemTurn,
    replyWaits, sessionKey, sourcesFor, systemFailed, systemFailures, systemStarting, systemTurns,
    turnState, withPromptCapture,
  })

  const { pokeBack, silenceTurn, deliver, whenTurnIdle, sendBackground } = createTurnHelpers({
    getConfig, channelOf, chatInfo, lastPoker, lastSpeaker, captureStore, log, groupEngaged,
    groupEngagedRun, groupKey, currentPromptSources, outputSources, outputScope, deliverTurn,
    turnSendLocks, sendSegments,
  })

  const { addGroupImages, groupPrompt } = createGroupContext({
    IMAGE_SOURCE_PREFIX, MAX_MESSAGE_IMAGES, animatedNote, canSeeFor, engagedHint, groupBuf,
    groupEngagedRun, groupKey, groupName, groupRefs, imagesOf, indentBody, inlineLabel, log,
    pickAutoReply, quoteImages, quoteInline, quoteWho, quotedInfo, sameNameNote, senderLabel
  })

  return {
    debugSay,
    systemSessionCooldown,
    // 哪些聊天的新会话挂不上工作区、正在冷却（面板概览排错用）
    sessionHealth: () => [...sessionFailures.keys()].map((chatId) => ({ chatId, ...sessionFailure(chatId) })).filter((row) => row.message),
    dispose,
    // 给模块用的出站清洗（和 QQ 投递同一套：工具标记 + 提示词复读 + 格式变体）。
    cleanOutbound: (chatId, text) => cleanOutboundText(String(text ?? ''), cleaningFor(chatId)),
    containsProtectedText: (chatId, text) => Boolean(cleaningFor(chatId).protectedText?.(String(text ?? ''))),
    checkOutgoingPrivacy: (chatId, text) => mind?.checkOutgoingPrivacy?.(chatId, text),
    canReplayDelivery: (item) => {
      const revision = audienceRevision(item.chatId)
      if (!revision) return true
      if (item.privacyRevision !== revision) return false
      const message = item.params.message || []
      return message.length > 0 && cleanOutboundSegments(message, cleaningFor(item.chatId)) === message
    },
    // 仅关闭本中枢持有的短期媒体缓存，迟到的事件不能重新写入。
    disposeRecentMedia: () => recentMedia.dispose(),
    modelFor: targetModel,
    /** 这个聊天最近发来的图片 / 表情（新的在后面），可选只要某人发的 */
    recentMedia: (chatId, userId) => recentMedia.get(chatId, userId),
    referenceImage,
    recentFiles: (chatId) => recentFiles.get(chatId) || [],
    stickerOf: stickerStash.get,
    capture,
    simulateTurn,
    onMessage,
    onPoke,
    onSessionEvent,
    /** 主动贴表情（内部实现，导出给回归测试用：#216 review 要求 dry-run 有测试兜底） */
    maybeReact,
    deliver,
    sendText,
    sendBackground,
    whenTurnIdle,
    secretaryLog: (chatId) => [...(secretaryLogs.get(String(chatId)) || [])],
    secretaryStats: (chatId) => chatId ? (secretaryStats[String(chatId)] || { allowed: 0, blocked: 0, lastAt: 0 }) : { ...secretaryStats },
    sendVoice,
    sendVoiceFile,
    sendFile,
    sendSticker,
    sendImage,
    checkSendableFile: (cfg, file) => checkSendableFile(cfg, file, workspaceDirOf),
    sendSegments,
    pushToSession,
    receiveOwnerMessage,
    /** 这个聊天这一轮还在跑（她在想 / 在等工具、等授权）。 */
    turnRunning: (chatId) => running.has(String(chatId)),
    foregroundBusy: () => [...busy.keys(), ...running.keys()].some((chatId) => !chatId.startsWith('system:') && (isBusy(chatId) || running.has(chatId))),
    titleFilter,
    runSystemTurn,
    runSubagentTurn,
    subagentFor,
    turnSendersAllOwner,
    onNotice,
    onDelivered,
    turnHasOwner,
    turnSenders,
    resetChat,
    joinTopic: (gid) => groupEngaged.set(topicKey(gid), Date.now() + ENGAGE_MS),
    leaveTopic: (gid) => groupEngaged.delete(topicKey(gid)),
    chatOfSession,
    isOwnedSession,
    canSeeImages: canSeeFor,
    resetSessions,
    ensureDebugSession,
    lastTextOf: (sessionId) => turnState.get(sessionKey(sessionId))?.lastText || '',
    quoteIdOf: (sessionId) => turnState.get(sessionKey(sessionId))?.quoteId || '',
    prevTextOf: (sessionId) => turnState.get(sessionKey(sessionId))?.prevText || '',
    speakersOf: (sessionId) => turnState.get(sessionKey(sessionId))?.speakers || [],
    logChat,
    localTranscribe,
    ensureWorkspace,
    chatLogOf,
    canReadChatLog,
    // 测试用：让下一次写流水时重新整理一遍
    _resetPruneForTest: () => { resetPruneForTest() },
    noteSaid,
    chatLogDays,
    sessions: () => map().chats,
    groupName,
    stats: () => ({ ...stats }),
    get lastChatAt() { return lastChatAt },
    get lastOwnerChatAt() { return lastOwnerChatAt },
    lastPrivateAt: (qq) => lastPrivateAt.get(String(qq)) || 0,
    get lastBotToOwner() { return lastBotToOwner },
    get selfId() { return selfId },
    channels,
    groupNames,
  }
}
