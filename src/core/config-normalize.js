// 配置归一化：把「手改过的 / 旧版本留下的 / 面板刚提交的」原始对象整理成当前形状。
//
// 这一层不读写文件（读写在 config.js）：输入 raw，输出一份补全默认值、裁掉非法值的配置。
// 搬出来的原因：它 357 行 + 60 行小工具，和读写逻辑混在一起时谁都不敢动；
// 现在它只依赖 DEFAULTS，能单独测（已有 10 多个测试文件直接引它）。

import { DEFAULTS } from './config-defaults.js'
import { DEFAULT_GROUP_POLICY } from '../chat/group-policy.js'
import { LEVELS, PROFILE_PERM_KEYS, PROFILE_PERM_LEVELS, profilePermDefault } from '../chat/access.js'
import { normalizeChatModels } from '../chat/chat-model.js'
import { DIARY_AUDIENCES } from '../channels/qq/features/diary/qzone-audience.js'

export const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)

export function deepMerge(base, over) {
  if (!isObj(over)) return structuredClone(base)
  const out = structuredClone(base)
  for (const [k, v] of Object.entries(over)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
    if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v)
    else if (v !== undefined) out[k] = v
  }
  return out
}

const BIG = 1e6 // 没有天然上限的数值：只防手滑填出离谱值，不当真限制
const num = (v, d, lo, hi) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}
const bool = (v, d) => (typeof v === 'boolean' ? v : d)
const qq = (v) => String(v ?? '').replace(/\D/g, '')
const qqList = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\s,，;；]+/)).map(qq).filter(Boolean))]
const hhmm = (v, d) => (/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : d)
// 严格校验 'YYYY-MM-DD'（面板手填/配置文件手改都可能乱），非法日期当没填。
const dateKey = (v) => {
  const s = String(v ?? '').trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? s : ''
}
// 请求头：正常是字符串（一行一个）；手写成对象 / 数组时展开成同样的多行文本，
// 免得下游按行解析时认不出来，静默把头全丢掉。
const headerLines = (v) => {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((x) => String(x ?? '')).join('\n')
  if (isObj(v)) return Object.entries(v).map(([k, x]) => `${k}: ${x ?? ''}`).join('\n')
  return v == null ? '' : String(v)
}
// 请求体：正常是字符串；手写成对象 / 数组时序列化回去（占位符 {text} / {reqid} 照样能替换）
const bodyText = (v) => {
  if (typeof v === 'string') return v
  if (isObj(v) || Array.isArray(v)) return JSON.stringify(v, null, 2)
  return v == null ? '' : String(v)
}

// 上报开关：总开关 + 按工作区的覆盖。覆盖项只认布尔值，别的一律当「没写」，跟随总开关。
function normalizeNotice(v, legacyNotify) {
  const o = isObj(v) ? v : {}
  const out = { enabled: bool(o.enabled, true), approval: typeof o.approval === 'boolean' ? o.approval : legacyNotify !== false, question: bool(o.question, true), workspaces: {} }
  for (const [key, val] of Object.entries(isObj(o.workspaces) ? o.workspaces : {})) {
    const path = String(key || '').trim()
    if (!path) continue
    const w = isObj(val) ? val : {}
    const item = {}
    if (typeof w.approval === 'boolean') item.approval = w.approval
    if (typeof w.question === 'boolean') item.question = w.question
    out.workspaces[path] = item
  }
  return out
}

export function normalize(raw) {
  const c = deepMerge(DEFAULTS, raw)
  // 手改/旧备份可能把整段写成字符串；先把对象段恢复成默认对象，否则后面一赋值就崩在启动阶段。
  for (const [k, v] of Object.entries(DEFAULTS)) if (isObj(v) && !isObj(c[k])) c[k] = structuredClone(v)
  c.enabled = bool(c.enabled, false)
  c.dryRun = bool(c.dryRun, true)
  c.debug = bool(c.debug, false)
  // 调试比试运行更严：它本身就包含「不真发」，所以内部一律当成 dryRun（下面所有 dryRun 判断都自动生效）。
  // 面板上两个开关互斥，「试运行」显示的是 dryRun && !debug。
  if (c.debug) c.dryRun = true
  c.botQQ = qq(c.botQQ)
  c.ownerQQ = qq(c.ownerQQ)
  c.approvalNotify = bool(c.approvalNotify, true)
  c.freedom = bool(c.freedom, true)
  // 老配置只有 approvalNotify：没写过 notice 时用它当审批上报的默认值
  c.notice = normalizeNotice(isObj(raw?.notice) ? raw.notice : null, raw?.approvalNotify)
  c.approvalViaQQ = bool(c.approvalViaQQ, true)
  c.qqApi.enabled = bool(c.qqApi.enabled, true)
  c.gateway = 'onebot'
  // 只认绝对路径（/ 开头），别的当没填
  c.workspaceDir = String(c.workspaceDir || '').trim()
  if (c.workspaceDir && !c.workspaceDir.startsWith('/')) c.workspaceDir = ''
  // 视觉能力：auto = 问 DSH 的模型元数据；on / off = 管理员手动声明（覆盖元数据）
  c.model.vision = c.model.vision === 'on' || c.model.vision === 'off' ? c.model.vision : 'auto'
  c.setupDone = bool(c.setupDone, false)
  c.ownerName = String(c.ownerName || '').trim() || '管理员'
  // 旧默认称呼迁移：老配置里的旧默认值统一改成“管理员”；自定义称呼保持原样。
  if (c.ownerName === '\u4e3b\u4eba') c.ownerName = '管理员'
  c.ownerLevel = LEVELS.includes(c.ownerLevel) ? c.ownerLevel : 'full'
  c.purge = { identityLock: c.purge?.identityLock !== false }
  c.longTasks = bool(c.longTasks, true)
  c.subagentBackground = bool(c.subagentBackground, false)
  c.chatModels = normalizeChatModels(c.chatModels)
  c.profilePerms = Object.fromEntries(PROFILE_PERM_KEYS.map((k) => [k, PROFILE_PERM_LEVELS.includes(c.profilePerms?.[k]) ? c.profilePerms[k] : profilePermDefault(k)]))
  c.allow = { private: qqList(c.allow.private), groups: qqList(c.allow.groups) }
  // QQ 平台自己的账号/白名单；旧顶层字段继续作为兼容来源，并在 normalize 后同步。
  const qqAccount = isObj(c.platforms?.qq) ? c.platforms.qq : {}
  // 在平台专用设置页出现之前，顶层账号/白名单是权威来源，平台字段只做镜像。
  qqAccount.botQQ = qq(c.botQQ)
  qqAccount.ownerQQ = qq(c.ownerQQ)
  qqAccount.allow = { private: qqList(c.allow.private), groups: qqList(c.allow.groups) }
  c.platforms = { ...(isObj(c.platforms) ? c.platforms : {}), qq: qqAccount }
  // 平台工作区目录只接受绝对路径；否则会被 workspaceDirOf 优先捡起来当根目录。
  for (const p of Object.values(c.platforms)) {
    if (!isObj(p)) continue
    const w = String(p.workspaceDir || '').trim()
    p.workspaceDir = w.startsWith('/') ? w : ''
  }
  c.botQQ = qqAccount.botQQ
  c.ownerQQ = qqAccount.ownerQQ
  c.allow = qqAccount.allow
  const tg = isObj(c.platforms.telegram) ? c.platforms.telegram : {}
  const tgList = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[\s,，;；]+/)).map((x) => String(x).trim()).filter(Boolean)
  c.platforms.telegram = { ...tg, label: 'Telegram', enabled: bool(tg.enabled, false), token: String(tg.token || '').trim(), apiBase: String(tg.apiBase || 'https://api.telegram.org').trim().replace(/\/+$/, ''), ownerQQ: String(tg.ownerQQ || '').trim(), allow: { private: tgList(tg.allow?.private), groups: tgList(tg.allow?.groups) } }
  const drawablePrivate = new Set(qqList(c.drawAllow?.private))
  const drawableGroups = new Set(qqList(c.drawAllow?.groups))
  c.drawAllow = {
    private: c.allow.private.filter((id) => id !== c.ownerQQ && id !== c.botQQ && drawablePrivate.has(id)),
    groups: c.allow.groups.filter((id) => drawableGroups.has(id)),
  }
  qqAccount.drawAllow = { private: [...c.drawAllow.private], groups: [...c.drawAllow.groups] }
  c.platforms.qq.drawAllow = qqAccount.drawAllow
  // 旧授权规则不自动给会话开放普通生图。
  delete c.adultChat
  // 发文件：开关、大小上限、额外允许的目录（只认绝对路径；空行忽略）
  if (!isObj(c.files)) c.files = {}
  if (!isObj(c.security)) c.security = {}
  c.security.dangerConfirm = bool(c.security.dangerConfirm, false)
  c.security.ssrfMode = c.security.ssrfMode === 'loose' ? 'loose' : 'strict'
  // 远端管理开关与可信反代：放 security 段（顶层对象，不会被下面「ext 只留对象」的规则删掉）
  c.security.panelRemoteAccess = bool(c.security.panelRemoteAccess, false)
  c.security.trustedProxy = String(c.security.trustedProxy || '').trim()
  c.security.publicHostname = String(c.security.publicHostname || '').trim().toLowerCase()
  // 浏览器后端开关（老配置没有 browser 段也要补出默认值）
  if (!isObj(c.browser)) c.browser = {}
  c.browser.useDshSidebar = bool(c.browser.useDshSidebar, false)
  // DeepSeek 峰谷省钱模式：默认关；节假日列表去重、只留合法的 'YYYY-MM-DD'（北京时间日期）
  if (!isObj(c.cost)) c.cost = {}
  c.cost.offPeak = bool(c.cost.offPeak, false)
  const rawHolidays = Array.isArray(c.cost.offPeakHolidays) ? c.cost.offPeakHolidays : String(c.cost.offPeakHolidays || '').split(/[\n,，;；\s]+/)
  c.cost.offPeakHolidays = [...new Set(rawHolidays.map(dateKey).filter(Boolean))].sort().slice(0, 60)
  c.files.enabled = bool(c.files.enabled, true)
  c.files.maxMB = num(c.files.maxMB, 50, 1, BIG)
  c.files.imageByPath = bool(c.files.imageByPath, DEFAULTS.files.imageByPath)
  c.files.relay = bool(c.files.relay, true)
  // 只收主机名 / IP，别的字符一律当没填（防止拼出奇怪的地址）
  c.files.relayHost = /^[A-Za-z0-9.-]{1,253}$/.test(String(c.files.relayHost || '').trim()) ? String(c.files.relayHost).trim() : 'host.docker.internal'
  c.files.dirs = (Array.isArray(c.files.dirs) ? c.files.dirs : String(c.files.dirs || '').split(/[\n,，;；]+/))
    .map((s) => String(s).trim()).filter((s) => s.startsWith('/')).slice(0, 20)
  const g = c.group
  g.wakeWords = (Array.isArray(g.wakeWords) ? g.wakeWords : String(g.wakeWords || '').split(/[\s,，]+/)).map((s) => String(s).trim()).filter(Boolean)
  g.interjectChance = num(g.interjectChance, 0.15, 0, 1)
  g.cooldownSec = num(g.cooldownSec, 90, 0, BIG)
  g.maxPerHour = num(g.maxPerHour, 6, 0, BIG)
  g.mustMaxPerHour = num(g.mustMaxPerHour, 100, 0, BIG)
  g.minRecentMessages = num(g.minRecentMessages, 3, 0, BIG)
  g.activeWindowSec = num(g.activeWindowSec, 300, 1, BIG)
  if (!Array.isArray(g.quietHours) || g.quietHours.length !== 2) g.quietHours = DEFAULT_GROUP_POLICY.quietHours
  g.quietHours = g.quietHours.map((h) => num(h, 0, 0, 23))
  if (!isObj(g.overrides)) g.overrides = {}
  delete g.ownerBrief // 「管理员私聊：群聊摘要」换成了心智核心的「别的聊天里刚发生了什么」
  // 群里的本机工具：默认关；只有明确写了 owner 才开（原项目删掉了「谁问都行」一档，74eece2）
  g.ownerTools = g.ownerTools === 'owner' ? 'owner' : 'off'
  g.ownerToolsGroups = qqList(g.ownerToolsGroups)
  c.voice.autoChance = num(c.voice.autoChance, 0.15, 0, 1)
  c.voice.autoMaxChars = num(c.voice.autoMaxChars, 80, 1, BIG)
  c.voice.emojiSeparate = c.voice.emojiSeparate !== false
  // 通用 HTTP 引擎（接火山 / 阿里 / 讯飞这类云 TTS）：method 只认 GET / POST，其余当 GET；
  // 地址、请求头、请求体一律转成字符串——手改 config.json 写成对象、数组或数字时，也按原意
  // 拼得出去，不会变成 "[object Object]" 或者带着填错的空格。
  if (!isObj(c.voice.http)) c.voice.http = structuredClone(DEFAULTS.voice.http)
  c.voice.http.urlTemplate = String(c.voice.http.urlTemplate ?? '').trim()
  c.voice.http.method = String(c.voice.http.method ?? '').trim().toUpperCase() === 'POST' ? 'POST' : 'GET'
  c.voice.http.headers = headerLines(c.voice.http.headers)
  c.voice.http.body = bodyText(c.voice.http.body)
  c.voice.http.sampleRate = num(c.voice.http.sampleRate, 24000, 8000, 48000)
  // Breeze 语音：地址 / 音色 id / 语气说明；Key 不回显（publicConfig 里换成 keySet）
  if (!isObj(c.voice.breeze)) c.voice.breeze = structuredClone(DEFAULTS.voice.breeze)
  const bz = c.voice.breeze
  bz.mode = ['cloud', 'local'].includes(String(bz.mode)) ? String(bz.mode) : 'cloud'
  bz.url = String(bz.url ?? '').trim().slice(0, 400) || DEFAULTS.voice.breeze.url
  bz.key = String(bz.key ?? '').trim().slice(0, 400)
  bz.voiceId = String(bz.voiceId ?? '').trim().slice(0, 200)
  bz.siteUrl = String(bz.siteUrl ?? '').trim().slice(0, 400) || DEFAULTS.voice.breeze.siteUrl
  bz.email = String(bz.email ?? '').trim().slice(0, 200)
  bz.password = String(bz.password ?? '').slice(0, 400)
  bz.autoClaim = bz.autoClaim !== false
  bz.model = String(bz.model ?? '').trim().slice(0, 100) || DEFAULTS.voice.breeze.model
  bz.languageCode = String(bz.languageCode ?? '').trim().slice(0, 20) || DEFAULTS.voice.breeze.languageCode
  bz.instructions = String(bz.instructions ?? '').trim().slice(0, 500)
  bz.outputFormat = String(bz.outputFormat ?? '').trim().slice(0, 60) || DEFAULTS.voice.breeze.outputFormat
  bz.guidanceScale = num(bz.guidanceScale, 0, 0, 20)
  bz.timeoutMs = num(bz.timeoutMs, 60000, 5000, 600000)
  // 云端语音识别：provider 只认内置两项和 custom；地址/模型留空时由 asr.js 用预置默认值
  if (!isObj(c.voice.asrApi)) c.voice.asrApi = structuredClone(DEFAULTS.voice.asrApi)
  const asrApi = c.voice.asrApi
  asrApi.provider = ['', 'siliconflow', 'openai', 'custom'].includes(asrApi.provider) ? asrApi.provider : ''
  for (const k of ['baseUrl', 'model', 'apiKey', 'language']) asrApi[k] = String(asrApi[k] ?? '').trim()
  asrApi.baseUrl = asrApi.baseUrl.replace(/\/+$/, '')
  asrApi.prefer = ['qq', 'cloud'].includes(asrApi.prefer) ? asrApi.prefer : 'qq'
  c.stickers.autoChance = num(c.stickers.autoChance, 0.35, 0, 1)
  // 主动贴表情：自己的概率（默认 0.15），不从 autoChance 取值；老配置里存成 null 的按默认算
  c.stickers.reactChance = num(c.stickers.reactChance ?? 0.15, 0.15, 0, 1)
  c.stickers.reactMaxPerHour = num(c.stickers.reactMaxPerHour, 10, 0, BIG)
  c.stickers.react = bool(c.stickers.react, false)
  c.stickers.faces = c.stickers.faces !== false
  c.stickers.collectMode = ['ask', 'auto', 'owner'].includes(c.stickers.collectMode) ? c.stickers.collectMode : 'auto'
  c.stickers.maxPerHour = num(c.stickers.maxPerHour, 20, 0, BIG)
  c.stickers.maxLibrary = num(c.stickers.maxLibrary, 300, 1, BIG)
  // 起名单独挑的模型：两半都填了才认；填一半 / 脏数据都当没填（回落到聊天模型）
  c.stickers.captionModel = (() => {
    const m = isObj(c.stickers.captionModel) ? c.stickers.captionModel : {}
    const provider = String(m.provider || '').trim()
    const model = String(m.model || '').trim()
    return provider && model ? { provider, model } : { provider: '', model: '' }
  })()
  c.diary.timesPerDay = num(c.diary.timesPerDay, 2, 0, 48)
  c.diary.windowStart = hhmm(c.diary.windowStart, '10:00')
  c.diary.windowEnd = hhmm(c.diary.windowEnd, '23:30')
  c.diary.minGapMinutes = num(c.diary.minGapMinutes, 180, 0, BIG)
  c.diary.attachImage = bool(c.diary.attachImage, true)
  if (!isObj(c.diary.rich)) c.diary.rich = { ...DEFAULTS.diary.rich }
  for (const key of ['enabled', 'stickers', 'browsing', 'local']) c.diary.rich[key] = bool(c.diary.rich[key], DEFAULTS.diary.rich[key])
  c.diary.rich.folder = typeof c.diary.rich.folder === 'string' ? c.diary.rich.folder.trim() : ''
  if (c.diary.rich.folder && !/^([a-zA-Z]:[\\/]|\/)/.test(c.diary.rich.folder)) c.diary.rich.folder = ''
  delete c.diary.rich.cards
  c.diary.rich.maxImages = Math.round(num(c.diary.rich.maxImages, 2, 1, 9))
  if (!isObj(c.diary.archive)) c.diary.archive = { ...DEFAULTS.diary.archive }
  c.diary.archive.enabled = bool(c.diary.archive.enabled, false)
  c.diary.archive.folder = typeof c.diary.archive.folder === 'string' ? c.diary.archive.folder.trim() : ''
  if (c.diary.archive.folder && !/^([a-zA-Z]:[\\/]|\/)/.test(c.diary.archive.folder)) c.diary.archive.folder = ''
  c.diary.minChars = num(c.diary.minChars, 60, 1, BIG)
  c.diary.maxChars = num(c.diary.maxChars, 140, 1, BIG)
  c.diary.visibility = DIARY_AUDIENCES.includes(c.diary.visibility) ? c.diary.visibility : 'all'
  c.diary.audienceQQs = qqList(c.diary.audienceQQs).slice(0, 200).join('\n')
  const q = c.qzoneSocial
  q.enabled = bool(q.enabled, true)
  q.replyOwn = bool(q.replyOwn, true)
  q.commentFriends = bool(q.commentFriends, true)
  q.like = bool(q.like, true)
  q.friendChance = num(q.friendChance, 0.3, 0, 1)
  q.ownerChance = num(q.ownerChance, 0.7, 0, 1)
  q.maxPerDay = num(q.maxPerDay, 8, 0, BIG)
  delete q.intervalMin // 什么时候逛空间由她自己决定（心智核心的动机）
  for (const k of ['tts', 'image', 'song', 'asr', 'video']) c.local[k] = bool(c.local[k], false)
  c.local.videoTimeoutMin = num(c.local.videoTimeoutMin, 20, 1, BIG)
  c.local.ffmpegPath = String(raw?.local?.ffmpegPath ?? '').trim()
  c.local.hashes = Object.fromEntries(Object.entries(isObj(c.local.hashes) ? c.local.hashes : {}).filter(([k, v]) => ['tts', 'image', 'song', 'asr', 'video'].includes(k) && typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)))
  // 心智核心接手以后不用的旧设置：主动搭话、心情、旧记忆模块（向量密钥先搬到 mind.embedKey）
  const oldVectorKey = String(raw?.memory?.vector?.apiKey || '').trim()
  delete c.speakUp
  delete c.mood
  delete c.purpose
  for (const id of ['speakup', 'mood', 'purpose', 'memory']) if (isObj(c.modules)) delete c.modules[id]
  // 老配置里插件自己管 SnowLuma 用的设置（只有原版的 Windows 才有），这里用不到
  for (const k of ['dir', 'autoStart', 'webuiPort', 'webuiPassword', 'passwordAuto', 'autoAttach']) delete c.snowluma[k]
  // 平台配置：新代码读 platforms.qq，旧代码仍读 snowluma；两边保持同步。
  const legacySnow = isObj(c.snowluma) ? c.snowluma : {}
  const rawQq = isObj(raw?.platforms?.qq) ? raw.platforms.qq : {}
  const qqPlatform = isObj(c.platforms?.qq) ? c.platforms.qq : {}
  const pick = (k) => String(rawQq[k] !== undefined ? rawQq[k] : (qqPlatform[k] || legacySnow[k] || '')).trim()
  c.platforms = { ...(isObj(c.platforms) ? c.platforms : {}), qq: {
    ...qqPlatform,
    label: String(qqPlatform.label || 'QQ'), enabled: bool(qqPlatform.enabled, true),
    httpUrl: pick('httpUrl'), wsUrl: pick('wsUrl'), httpToken: pick('httpToken'), wsToken: pick('wsToken'),
  } }
  c.snowluma = { ...legacySnow, httpUrl: c.platforms.qq.httpUrl, wsUrl: c.platforms.qq.wsUrl, httpToken: c.platforms.qq.httpToken, wsToken: c.platforms.qq.wsToken }
  c.chat = c.chat || {}
  c.chat.seedHistory = bool(c.chat.seedHistory, false)
  c.chat.seedHistoryCount = num(c.chat.seedHistoryCount, 20, 1, BIG)
  c.chat.everyStep = bool(c.chat.everyStep, false)
  c.chat.rescueFromThinking = bool(c.chat.rescueFromThinking, false)
  c.chat.thinkingGuard = bool(c.chat.thinkingGuard?.enabled ?? c.chat.thinkingGuard, true)
  c.chat.shareRecentWithModules = bool(c.chat.shareRecentWithModules, false)
  c.chat.replyMarker = bool(c.chat.replyMarker?.enabled ?? c.chat.replyMarker, false)
  c.chat.turnTimeoutMinutes = num(c.chat.turnTimeoutMinutes, 30, 0, 180)
  c.chat.clicheFilters = (Array.isArray(c.chat.clicheFilters) ? c.chat.clicheFilters : String(c.chat.clicheFilters || '').split(/[\n,，;；]+/))
    .map((s) => String(s).trim()).filter(Boolean).slice(0, 100)
  // 老版本的 0 是当时的默认值，不是谁选的：升级后改成留 7 天，以后面板里再选 0 才算数
  const keepUnset = raw?.memory?.keepChatlogDays === 0 && !raw.memory.keepChatlogSet
  c.memory.keepChatlogDays = keepUnset ? 7 : num(c.memory.keepChatlogDays, 7, -1, 3650)
  c.memory.keepChatlogSet = true
  c.memory = { keepChatlogDays: c.memory.keepChatlogDays, keepChatlogSet: true }
  if (!isObj(c.mind)) c.mind = { ...DEFAULTS.mind }
  c.mind.embedBackend = c.mind.embedBackend === 'local' ? 'local' : 'remote'
  c.mind.embedKey = String(c.mind.embedKey || '').trim() || oldVectorKey
  g.interests = (Array.isArray(g.interests) ? g.interests : String(g.interests || '').split(/[\s,，]+/)).map((s) => String(s).trim()).filter(Boolean)
  g.minRelevance = num(g.minRelevance, 0.25, 0, 1)
  // @ 了别人时不算叫她（只挡必回，仍然可以插话）；默认关，保持原行为
  g.ignoreAtOthers = bool(g.ignoreAtOthers, false)
  // 看白名单里别的群：off 关 / private 管理员和私聊里的群成员（默认）/ group 群里的成员也行
  g.crossRead = ['off', 'group'].includes(g.crossRead) ? g.crossRead : 'private'
  c.merge.enabled = bool(c.merge.enabled, true)
  c.merge.waitSec = num(c.merge.waitSec, 2.5, 0, BIG)
  c.merge.maxSec = Math.max(c.merge.waitSec, num(c.merge.maxSec, 8, 0, BIG))
  c.merge.groupWaitSec = num(c.merge.groupWaitSec, 5, 0, BIG)
  c.merge.groupMaxSec = Math.max(c.merge.groupWaitSec, num(c.merge.groupMaxSec, 15, 0, BIG))
  c.titleFilter.enabled = bool(c.titleFilter.enabled, true)
  c.titleFilter.groups = qqList(c.titleFilter.groups) // 和群白名单同一套规则
  c.titleFilter.title = String(c.titleFilter.title ?? '').replace(/[​-‍﻿]/g, '').trim().slice(0, 30) || '大肥鱼'
  g.burstMax = num(g.burstMax, 8, 1, BIG)
  g.engagedMax = num(g.engagedMax, 6, 0, BIG)
  g.burstWindowSec = num(g.burstWindowSec, 120, 1, BIG)
  if (c.voice.engine === 'windows') c.voice.engine = 'system' // 老配置里系统自带语音叫 windows
  if (!['auto', 'edge', 'system', 'cosyvoice', 'gptsovits', 'http', 'breeze'].includes(c.voice.engine)) c.voice.engine = 'auto'
  c.voice.songVoice = String(c.voice.songVoice || '').slice(0, 120)
  c.voice.songPitch = Math.max(-24, Math.min(24, Math.round(Number(c.voice.songPitch) || 0)))
  c.voice.cosyvoice.sampleRate = num(c.voice.cosyvoice.sampleRate, 22050, 8000, 48000)
  if (!['sft', 'instruct'].includes(c.voice.cosyvoice.mode)) c.voice.cosyvoice.mode = 'sft'
  // edge-tts 的语速 / 音调：只认 ±N% 和 ±NHz，写着玩的回落默认值，超范围的夹回来。
  // ⚠ 0 也必须带符号：面板的选项是 '+0%' / '+0Hz'，少了正号既对不上下拉框，
  //   又会让 `rate !== '+0%'` 成立、把 --rate=0% 传给 edge-tts（它会直接报错）。
  const signed = (n, unit) => (n < 0 ? '-' : '+') + Math.abs(n) + unit
  const pct = /^([+-]?\d{1,3})\s*%$/.exec(String(c.voice.rate || '').trim())
  c.voice.rate = signed(pct ? Math.max(-50, Math.min(50, Number(pct[1]))) : 0, '%')
  const hz = /^([+-]?\d{1,3})\s*Hz$/i.exec(String(c.voice.pitch || '').trim())
  c.voice.pitch = signed(hz ? Math.max(-80, Math.min(80, Number(hz[1]))) : 0, 'Hz')
  c.imageGen.fallbackEnabled = bool(c.imageGen.fallbackEnabled, false)
  const fallbackIds = new Set()
  c.imageGen.fallbacks = (Array.isArray(c.imageGen.fallbacks) ? c.imageGen.fallbacks : []).flatMap((item) => {
    const id = String(item?.id || '').slice(0, 80)
    if (!/^[a-z0-9_-]+$/i.test(id) || fallbackIds.has(id)) return []
    fallbackIds.add(id)
    return [{
      id, provider: ['openai','seedream','xai','gemini','sensenova','comfyui','custom','codex','local'].includes(item.provider) ? item.provider : 'openai',
      baseUrl: String(item.baseUrl || '').trim().replace(/\/+$/, '').slice(0, 500),
      apiKey: String(item.apiKey || '').trim(), model: String(item.model || '').trim().slice(0, 200),
    }]
  }).slice(0, 5)
  c.imageGen.enabled = bool(c.imageGen.enabled, false)
  delete c.imageGen.ownerOnly
  delete c.imageGen.localDraw
  c.imageGen.seeOwn = bool(c.imageGen.seeOwn, true)
  c.imageGen.img2img = bool(c.imageGen.img2img, true)
  if (!/^\d{3,4}x\d{3,4}$/.test(String(c.imageGen.size))) c.imageGen.size = '1024x1024'
  c.imageGen.galleryShown = Math.min(50, Math.max(1, Math.round(Number(c.imageGen.galleryShown) || 20)))
  c.imageGen.shape = ['her', 'square', 'portrait', 'landscape', 'wide'].includes(c.imageGen.shape) ? c.imageGen.shape : 'her'

  c.imageGen.provider = ['openai','seedream','xai','gemini','sensenova','comfyui','custom','codex','local'].includes(c.imageGen.provider) ? c.imageGen.provider : 'openai'
  c.imageGen.localSteps = Math.max(4, Math.min(50, Math.round(Number(c.imageGen.localSteps) || 20)))
  if (!isObj(c.imageGen.codex)) c.imageGen.codex = { ...DEFAULTS.imageGen.codex }
  const igx = c.imageGen.codex
  const codexImageModels = [
    DEFAULTS.imageGen.codex.model,
    'gpt-image-2.5-flare',
    'gpt-image-2.5-sunburst',
    'gpt-image-2.6-flare',
    'gpt-image-2.6-sunburst',
  ]
  if (!codexImageModels.includes(igx.model)) igx.model = DEFAULTS.imageGen.codex.model
  igx.quality = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(igx.quality) ? igx.quality : 'auto'
  igx.background = ['auto', 'transparent', 'opaque'].includes(igx.background) ? igx.background : 'auto'
  if (!c.imageGen.custom || typeof c.imageGen.custom !== 'object') c.imageGen.custom = { ...DEFAULTS.imageGen.custom }
  const igc = c.imageGen.custom
  igc.method = String(igc.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET'
  igc.bodyType = igc.bodyType === 'form' ? 'form' : 'json'
  igc.url = String(igc.url || '').trim().slice(0, 2000)
  igc.responsePath = String(igc.responsePath || '').trim().slice(0, 200)
  igc.params = (Array.isArray(igc.params) ? igc.params : [])
    .map((p) => ({ key: String((p && p.key) || '').trim().slice(0, 60), value: String(p && p.value != null ? p.value : '').slice(0, 500) }))
    .filter((p) => p.key)
    .slice(0, 30)

  c.song.enabled = bool(c.song.enabled, false)
  c.song.ownerOnly = bool(c.song.ownerOnly, true)
  c.song.pitch = num(c.song.pitch, 0, -24, 24)
  c.song.maxVoiceSec = num(c.song.maxVoiceSec, 120, 1, BIG)
  c.song.vocalVolume = num(c.song.vocalVolume, 1, 0, 10)
  c.song.instVolume = num(c.song.instVolume, 0.8, 0, 10)
  if (!['auto', 'head'].includes(c.song.clipStart)) c.song.clipStart = 'auto'
  // 老配置：'' 是以前的默认（没开），改成自动；tuna 是以前的「用镜像」
  c.song.pypiMirror = { '': 'auto', tuna: 'cn' }[c.song.pypiMirror] ?? c.song.pypiMirror
  if (!['auto', 'cn', 'off'].includes(c.song.pypiMirror)) c.song.pypiMirror = 'auto'
  c.song.root = String(c.song.root || '').trim()
  c.song.localMusic = bool(c.song.localMusic, true)
  c.song.localMusicDir = String(c.song.localMusicDir || '').trim()
  c.song.indexRate = num(c.song.indexRate, 0.3, 0, 1)
  c.song.volumeEnvelope = num(c.song.volumeEnvelope, 0.5, 0, 1)
  c.song.protect = num(c.song.protect, 0.33, 0, 0.5)
  if (!isObj(c.song.enhance)) c.song.enhance = {}
  for (const k of ['enabled', 'dereverb', 'splitBacking', 'duetSplit', 'autoKey', 'toneMatch']) c.song.enhance[k] = bool(c.song.enhance[k], true)
  c.song.enhance.backEnvelope = num(c.song.enhance.backEnvelope, 0, 0, 1)
  // 云备份：owner/repo 去空格，令牌按密钥处理（SECRETS 里有登记）。
  // owner/repo 只留 URL 白名单字符（@ : / ? # 空格等能改语义的直接去掉，push 时还有白名单硬校验兜底）；
  // branch 拒 .. 与 - 开头，防 refspec/选项注入。
  c.backup = c.backup || {}
  if (!isObj(c.backup.remote)) c.backup.remote = { ...DEFAULTS.backup.remote }
  const br = c.backup.remote
  br.enabled = bool(br.enabled, false)
  br.owner = String(br.owner || '').trim().replace(/^https?:\/\//i, '').replace(/^gitee\.com\//i, '').split(/[/?]/)[0].replace(/\.git$/, '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 100)
  br.repo = String(br.repo || '').trim().replace(/\.git$/, '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 100)
  br.token = String(br.token || '').trim()
  br.branch = String(br.branch || '').trim().replace(/^refs\/heads\//, '').replace(/[^A-Za-z0-9._/-]/g, '').replace(/^[.\-]+/, '').replace(/\.\.+/g, '.').slice(0, 100) || 'master'
  br.time = hhmm(br.time, '03:30')
  br.keep = Math.round(num(br.keep, 7, 1, 365))
  br.autoCreate = bool(br.autoCreate, true)
  br.forceOverwrite = bool(br.forceOverwrite, false)
  if (!isObj(c.modules)) c.modules = {}
  for (const [id, m] of Object.entries(c.modules)) {
    if (!isObj(m)) { delete c.modules[id]; continue }
    m.enabled = bool(m.enabled, true)
    m.useBuiltin = bool(m.useBuiltin, false)
  }
  if (!isObj(c.ext)) c.ext = {}
  for (const k of Object.keys(c.ext)) if (!isObj(c.ext[k])) delete c.ext[k] // 传 null = 删掉这个模块的设置
  c.safeMode = bool(c.safeMode, false)
  // 花费估算的价格表：手动填了就用手填的（手填的部分覆盖内置价），没填就用内置 DeepSeek 价
  if (!isObj(c.usage)) c.usage = { pricing: {} }
  if (!isObj(c.usage.pricing)) c.usage.pricing = {}
  c.bridge.dshTools = bool(c.bridge.dshTools, false)
  c.bridge.http = bool(c.bridge.http, false)
  c.bridge.token = String(c.bridge.token || '')
  if (!['whitelist', 'owner'].includes(c.bridge.allowTargets)) c.bridge.allowTargets = 'whitelist'
  return c
}

// 面板里不回传原文的字段：路径（几层都行）
