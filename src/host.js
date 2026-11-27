// Aurabot · 宿主半边（DSH 插件入口）
//
// 让 DSH 里的 AI 以独立 QQ 号「大肥鱼」住在 QQ 里：
//   SnowLuma（OneBot v11）⇄ 本插件 ⇄ DSH 会话（Aurabot 自带的 preset + 人格）
// 面板在侧栏「自动化任务」下面（网页半边见 client/client.js），这里提供它要的 /aurabot/api/* 接口。
//
// 这个文件只管「核心」：配置、QQ 网关、聊天中枢、人格、面板接口、模块内核和联动。
// 表情、语音、记忆、空间、翻唱、生图……都是模块（src/modules/），能单独关掉，也能用自己写的替换。
//
// ⚠ 安全默认：总开关关、试运行开。不手动打开，一句都不会真的发到 QQ。

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { loadConfig, saveConfig, publicConfig, mergeFromPanel, ownerAuthorizationRevision } from './core/config.js'
import { createLogger } from './core/logger.js'
import { registerSecret } from './core/redact.js'
import { LEGACY_PLATFORM, parseChat, parsePerson, sameChat, shortRef } from './channels/index.js'
import { createChannelManager } from './channels/manager.js'
import { createPlatformChannels } from './channels/registry.js'
import { QQ_FEATURES } from './channels/qq/features/index.js'
import { createHub, workspaceDirOf } from './chat/hub.js'
import { moveWorkspace, realWorkspace } from './core/workspace-move.js'
import { createLocal, localAudioFile, localImageBuffer } from './local/local.js'
import { createGroupRoles } from './chat/group-roles.js'
import { defaultModel, askModel, modelReasoning, modelVision, clearReasoningCache, clearVisionCache } from './core/llm.js'
import { mimeOf } from './core/image-info.js'
import { createMediaAccess } from './core/media.js'
import { listModels as listProviderModels } from './core/models-list.js'
import { dataDir, ensureDir } from './core/store.js'
import { createTasks } from './core/tasks.js'
import { initUsage, usageReport } from './core/usage.js'
import { changelogSection } from './core/changelog.js'
import { isPeak, nextChange } from './core/offpeak.js'
import { parseCommand, runCommand, createMutes, commandList } from './chat/commands.js'
import { listPersonas, readPersona, savePersona, deletePersona, currentPersonaText, seedPersonas } from './persona/personas.js'
import { createModules, API_VERSION } from './core/modules.js'
import { createCommunity } from './core/community.js'
import { createApprovalRelay } from './security/approval.js'
import { createNoticeRelay, normalizeWorkspace } from './features/notice.js'
import { createHerVoice } from './features/her-voice.js'
import { applyPendingRestore, cancelPendingSessions, cancelRestore, createBackup, inspectBackup, listBackups, pendingModules, pendingRestore, pendingSessions, retryPendingSessions, setPendingModules, stageReceivedBackup, stageRestore, pruneLocalBackups, prunePreRestore } from './core/backup.js'
import { pushBackup, listWebdavBackups, downloadWebdavBackup } from './core/backup-push.js'
import { createBridge } from './core/bridge.js'
import { createDangerGuard, safeOwnedSession } from './security/danger.js'
import { setSsrpMode } from './core/net.js'
import { BUILTINS } from './modules/index.js'
import { createKnowledge } from './features/knowledge.js'
import { createMind } from './host/mind.js'
import { createPurgeScope } from './integration/purge-scope.js'
import { installPromptVariables } from './host/prompt-vars.js'
import { applyPanelSave } from './host/panel-save.js'
import { createOverview } from './host/overview.js'
import { createHttpKit } from './host/http.js'
import { registerAllRoutes } from './host/routes.js'
import { createAvatarStore } from './host/avatar.js'
import { POST_ONLY } from './host/post-only.js'
import { createBackupScheduler } from './host/backup-schedule.js'
import { installPersonaHoist } from './integration/persona-hoist.js'

export const name = 'aurabot'
// tools：B17 起面板要能只读探测「根作用域里有哪些可限制的全局工具」。cordis 的 ctx 对未声明的
// 服务属性会直接抛 cannot get property … without inject（rc.3 实测），所以必须显式声明。
export const inject = ['agents', 'sessions', 'webServer', 'timer', 'workspaceRegistry', 'attachments', 'systemPrompt', 'llm', 'tools']

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) } catch (error) { return { version: '?' } }
})()
const VERSION = PKG.version
const PREFIX = '/aurabot/api'

export function apply(ctx) {
  const logger = createLogger({ dsh: ctx })
  const log = logger.child('core')
  // 恢复备份必须在读配置之前：读完配置后内存里的旧状态会写回去
  try {
    const restored = applyPendingRestore()
    try { pruneLocalBackups(); prunePreRestore() } catch (error) { log.warn('备份保留清理失败：', error.message) }
    if (restored) log.info(`已恢复备份：${restored} 个文件，原来的文件在 backups/ 里留了底`)
  } catch (error) { log.error('恢复备份失败：', error.message) }
  let cfg = loadConfig()
  if (cfg.ownerQQ && !ownerAuthorizationRevision(cfg)) {
    try { cfg = saveConfig(cfg, cfg) }
    catch { log.warn('初始化管理员授权记录失败，本次启动使用会话授权') }
  }
  let mods = null
  let bridge = null
  // 备份与云备份推送的任务状态声明在顶部：setConfig 里改云备份设置时要提前排定时器
  let backupJob = null // { running, done, total, error, result }
  const getConfig = () => cfg
  setSsrpMode(() => (getConfig().security && getConfig().security.ssrfMode === 'loose' ? 'loose' : 'strict'))
  const secrets = () => { for (const k of ['httpToken', 'wsToken']) registerSecret(cfg.snowluma[k]); registerSecret(cfg.platforms?.qq?.httpToken); registerSecret(cfg.platforms?.qq?.wsToken); registerSecret(cfg.platforms?.telegram?.token); registerSecret(cfg.imageGen.apiKey); for (const item of cfg.imageGen.fallbacks || []) registerSecret(item.apiKey); registerSecret(cfg.bridge.token); registerSecret(cfg.mind?.embedKey); registerSecret(cfg.backup?.remote?.token); registerSecret(cfg.backup?.remote?.webdav?.password); registerSecret(cfg.voice?.asrApi?.apiKey); registerSecret(cfg.voice?.breeze?.key); registerSecret(cfg.voice?.breeze?.password) } // 云备份令牌 / WebDAV 密码、语音的 Key 也按密钥脱敏
  const setConfig = (next) => {
    const before = cfg
    cfg = saveConfig(next, before)
    secrets()
    if (before.enabled !== cfg.enabled || before.dryRun !== cfg.dryRun || before.debug !== cfg.debug
      || before.botQQ !== cfg.botQQ || ownerAuthorizationRevision(before) !== ownerAuthorizationRevision(cfg)) qq.resetInbox()
    // 改机器人号后旧连接的核对结果立刻失效，必须重新核对才能处理消息或完成向导。
    const beforeQq = before.platforms?.qq || {}
    const afterQq = cfg.platforms?.qq || {}
    const turnedOff = before.enabled && !cfg.enabled
    const turnedOn = !before.enabled && cfg.enabled
    // 每个平台只执行一个动作：stop / restart / start，避免一次保存既 start 又 restart。
    if (turnedOff) qq.stop()
    else if (before.botQQ !== cfg.botQQ) {
      qq.resetAccount()
      if (qq.state() === 'connected') qq.restart()
    } else if (['enabled', 'wsUrl', 'httpUrl', 'wsToken', 'httpToken'].some((k) => beforeQq[k] !== afterQq[k])) {
      if (afterQq.enabled === false) qq.stop()
      else if (qq.state() !== 'stopped') qq.restart()
    } else if (turnedOn) qq.start()
    const beforeTg = before.platforms?.telegram || {}
    const afterTg = cfg.platforms?.telegram || {}
    const tgChanged = ['enabled', 'token', 'apiBase'].some((k) => beforeTg[k] !== afterTg[k])
    const tg = channels.get('telegram')
    if (turnedOff) tg?.stop()
    else if (tgChanged) {
      if (!afterTg.enabled || !afterTg.token) tg?.stop()
      else tg?.restart().catch((error) => log.warn('Telegram 重启失败：', error.message))
    } else if (turnedOn && afterTg.enabled && afterTg.token) {
      tg?.start().catch((error) => log.warn('Telegram 启动失败：', error.message))
    }
    if (bridge && before.bridge.dshTools !== cfg.bridge.dshTools) bridge.refresh()
    // 管理员在面板里改了「ta怎么称呼你」：以管理员改的为准（她自己改过的叫法被盖掉，记一个版本）
    if (mind && String(before.ownerName || '') !== String(cfg.ownerName || '') && String(cfg.ownerName || '').trim()) {
      try { mind.mind.self.change({ what: 'ownerCall', content: String(cfg.ownerName).trim(), why: '管理员在面板里改了称呼' }, { by: 'owner' }) } catch (error) { log.debug('称呼没跟着改：', error.message) }
    }
    if (mods && (JSON.stringify(before.modules) !== JSON.stringify(cfg.modules) || before.safeMode !== cfg.safeMode)) mods.sync().catch(() => {})
    mods?.emit('config', cfg, before)
    if (JSON.stringify(before.backup?.remote) !== JSON.stringify(cfg.backup?.remote)) backupScheduler.schedule()
    return cfg
  }
  secrets()
  seedPersonas()
  // token 用量与花费（面板「概览」）：价格表可以在 config.usage.pricing 里覆盖
  initUsage(cfg.usage?.pricing, cfg.cost?.offPeakHolidays)

  // 心智核心的对接层（下面创建）；放在这里声明，规则变量里要用
  let mind = null

  // ---------- 人格与规则：通过提示词变量注入到 Aurabot 的 preset ----------
  const { ownerCall } = installPromptVariables(ctx, {
    getConfig,
    getMind: () => mind,
    getMods: () => mods,
  })

  // ---------- 聊天平台的连接 ----------
  // QQ 是第一个：macOS 上 QQ 网关是你自己跑的 OneBot v11（比如 OrbStack / Docker 里的 SnowLuma），插件只按面板填的地址去连
  let hub = null
  const tasks = createTasks({ log: logger.child('后台任务') })
  const mutes = createMutes()
  function taskRequesters({ chat, sessionId }) {
    const senders = hub?.turnSenders(sessionId) || []
    return senders.length ? senders : chat?.kind === 'private' && chat.userId ? [String(chat.userId)] : []
  }
  let dangerGuard = null // 危险命令确认（security.dangerConfirm 开着才生效）
  let approvalRelay = null // DSH 要授权时在 QQ 私聊问管理员（approvalViaQQ 开着才生效）
  const channels = createChannelManager({ log: logger.child('platforms') })
  for (const channel of createPlatformChannels({
    getConfig,
    log: logger,
    canReplayDelivery: (item) => hub?.canReplayDelivery(item) === true,
  })) channels.add(channel)
  const qq = channels.get('qq')
  const backgroundText = (chatId, text, note = '通知', opts = {}) => hub?.sendBackground
    ? hub.sendBackground(chatId, [{ type: 'text', data: { text } }], note, opts)
    : hub?.sendText(chatId, text, undefined, undefined, undefined, opts)
  const inboundChains = new Map() // chatId → 入站串行链：先到的图片/语音处理完，后到的文字再入队
  // 兼容：模块和几处老代码还在用 onebot.call / onebot.state
  const onebot = { call: (a, p, o) => qq.call(a, p, o), get state() { return qq.state() }, start: () => qq.start(), stop: () => qq.stop(), restart: () => qq.restart() }
  // 连接核对通过后的事件都在这里处理（核对期间攒下的也会补到这里）
  channels.on((e) => {
    // 通用平台事件；QQ 的旧 onebot 事件继续发，已有模块不用改。
    if (e.type === 'state') {
      mods?.emit('platform/state', { platform: e.platform, state: e.state })
      if (e.platform === 'qq') mods?.emit('onebot/state', e.state)
      return
    }
    if (e.type === 'raw') {
      mods?.emit('platform/raw', { platform: e.platform, event: e.event })
      if (e.platform === 'qq') mods?.emit('onebot', e.event)
      return
    }
    if (!hub) return
    if (e.type === 'message') {
      const msg = e.msg
      // 危险命令确认：管理员的「确认 / 取消」回复先在这里截住，不交给聊天中枢
      if (dangerGuard && msg.kind === 'private' && !msg.recovered) {
        const raw = msg.raw
        const text = Array.isArray(raw?.message)
          ? raw.message.filter((seg) => seg && seg.type === 'text').map((seg) => String(seg.data?.text || '')).join('')
          : ''
        if (dangerGuard.handleReply(msg.chatId, msg.userId, text)) return
        if (approvalRelay?.handleReply(msg.chatId, msg.userId, text)) return
      }
      const key = msg.chatId
      const previous = inboundChains.get(key) || Promise.resolve()
      // 消息处理出错时把位置也记下来：只打 message 时查不到是哪一行（2026-11-26 踩过一次）
      const run = previous.then(() => hub.onMessage(msg)).catch((error) => log.error(
        `处理消息出错（${msg?.chatId || '?'}）：`, error.message,
        String(error.stack || '').split('\n').slice(1, 4).map((l) => l.trim()).join(' | '),
      ))
      const tail = run.finally(() => { if (inboundChains.get(key) === tail) inboundChains.delete(key) })
      tail.catch(() => {})
      inboundChains.set(key, tail)
    } else if (e.type === 'poke') {
      hub.onPoke(e.poke).catch((error) => log.error('处理戳一戳出错：', error.message))
    } else if (e.type === 'notice') {
      hub.onNotice(e.notice).catch((error) => log.debug('处理通知出错：', error.message))
    } else if (e.type === 'delivered') {
      hub.onDelivered(e)
    }
  })
  const outbox = qq.outbox
  const groupRoles = createGroupRoles({ onebot, getConfig, log: logger.child('chat') })
  const local = createLocal({ getConfig, log: logger })

  /**
   * DSH 里能用的所有模型：[{provider, model, name, reasoning}]。
   * reasoning 是 {efforts:[...], default} 或 null（null = 这个模型不支持思考强度，
   * 面板据此把「思考强度」置灰，免得选了之后整轮报错）。
   */
  async function listModels() {
    const llm = ctx.llm || ctx.get('llm')
    const out = []
    for (const p of llm.listProviders() || []) {
      const provider = typeof p === 'string' ? p : p.provider || p.id || p.name
      try {
        for (const m of (await llm.listModels(provider)) || []) {
          const model = m.id || m.model
          out.push({ provider, model, name: m.name || model, reasoning: await modelReasoning(ctx, provider, model), vision: await modelVision(ctx, provider, model) })
        }
      } catch {}
    }
    if (out.length) modelCache = out
    return out
  }
  // 最近一次查到的模型列表：按聊天选的模型已经不在 DSH 里了，就退回下一级（同步取，hub 每条消息都要用）
  let modelCache = null
  setTimeout(() => { listModels().catch(() => {}) }, 3000).unref?.()

  // 聊天中枢找表情库、语音时，找的是当时在跑的那个模块；模块关着就当没有
  const use = (id) => mods?.use(id) || null
  const stickers = {
    match: (q) => use('stickers')?.match?.(q) ?? null,
    segmentFor: (it) => use('stickers')?.segmentFor?.(it) ?? null,
    markUsed: (md5) => use('stickers')?.markUsed?.(md5),
    pickForReply: (t) => use('stickers')?.pickForReply?.(t) ?? null,
    collect: async (s, chatId) => (use('stickers')?.collect ? use('stickers').collect(s, chatId) : { ok: false, reason: '表情包模块关着' }),
    library: () => use('stickers')?.library?.() ?? { items: [] },
  }
  const tts = {
    speak: async (text) => {
      const v = use('voice')
      if (!v?.speak) throw new Error('语音模块关着')
      return v.speak(text)
    },
  }

  // 心智核心：起不来（比如这个 Node 没有 node:sqlite）也不影响聊天，只是她不记事
  // 要扔掉的东西都进废纸篓（可找回），不直接删。测试时可以用 AURABOT_TRASH_DIR 指到临时目录。
  const trashDir = process.env.AURABOT_TRASH_DIR || join(homedir(), '.Trash')
  mind = createMind({
    dataDir, getConfig, log: logger.child('mind'), trashDir, askModel, ctx,
    getHub: () => hub, ownerCall, backgroundText, readPersona, savePersona,
    legacyPlatform: LEGACY_PLATFORM, use,
  })

  const purge = createPurgeScope({ log: logger.child('purge') })
  hub = createHub({
    mind,
    purge,
    trashDir,
    localApi: local,
    dsh: ctx,
    getConfig,
    log: logger.child('chat'),
    channels,
    onebot,
    stickers,
    tts,
    buildTools: (where) => [
      ...mods.buildTools(where), ...tasks.tools(where, () => taskRequesters(where)),
      ...(mind ? mind.tools({ ...where, ownerTurn: () => Boolean(hub?.turnSendersAllOwner?.(where.sessionId)) }) : []),
    ],
    // 模块声明的能力（module.json capabilities）：子智能体委派这类要本机权限的能力靠它把关（一审 #177）
    capabilitiesOf: (id) => (typeof mods.capabilitiesOf === 'function' ? mods.capabilitiesOf(id) : []),
    contextProviders: [(args) => mind?.contextFor(args) || '', ({ chat, sessionId, publicOnly }) => publicOnly ? '' : mods.contextFor({ chat, sessionId, publicOnly })],
    onActivity: (a) => mods.emit('activity', a),
    // 群聊话题和她的记忆有多相关（插话判断用）
    memoryScore: (text) => mind?.mind.memory.topicScore(text) ?? 0,
    // QQ 里的管理员命令（模块加的命令优先）
    onCommand: async (msg, markSensitive) => {
      const cmd = parseCommand(msg.text, mods.commands())
      if (!cmd) return null
      if (cmd.ext) {
        if (cmd.ext.sensitive === true && !markSensitive(cmd.name)) return ''
        return String((await cmd.ext.run(cmd.arg, msg)) ?? '')
      }
      return runCommand(cmd, msg, { getConfig, setConfig, mutes, hub, mind, qzone: use('diary'), song: use('song'), listModels, defaultModel: () => defaultModel(ctx, { model: {} }), extraCommands: mods.commands() })
    },
    isMuted: (chatId) => mutes.muted(chatId),
    // 心情、精力、困对说话方式的影响（表情包、语音、回复快慢、插话）
    moodEffects: () => mind?.effects() ?? null,
    availableModels: () => modelCache,
    // 模块（重）启动代际：模块热重载后工具名没变、但实例换了，hub 要据此重挂工具（issue #73）
    toolsGeneration: () => (mods ? mods.generation?.() || 0 : 0),
    hooks: {
      message: (msg) => mods.claim('message', msg),
      reply: (text, info) => mods.filter('reply', text, info),
      // 人格和规则的最终渲染值由 variable 在当前回合记录，发送时不重新生成。
      secrets: () => [],
      deniedTools: () => bridge?.deniedTools() || [],
      groupDecide: (decision, info) => mods.filter('group/decide', decision, info),
      prompt: (content, info) => mods.filter('prompt', content, info),
      items: (items, info) => mods.filter('reply/items', items, info),
      send: (message, info) => mods.filter('send', message, info),
      model: (sel, chat) => mods.filterSync('model', sel, chat),
      poke: (ev) => mods.claim('poke', ev),
      journal: (row) => mods?.emit('chat/log', row),
    },
  })

  // 宿主维护插件（dsh-purge 等）会往所有会话里追加提示词。QQ 会话用完整的大肥鱼人设：
  // 身份锁定在 persona 变量里（人格卡尾部），这里只补执行约束；做事方式照维护段的约束，
  // 身份/称呼/语气仍以人设为唯一来源。
  ctx.effect(() => {
    const off = purge.installPromptGuard(ctx, {
      enabled: () => getConfig().purge?.identityLock !== false,
      isAurabotAgent: (agent) => {
        try { return Boolean(hub?.chatOfSession?.(agent?.session?.id)) } catch { return false }
      },
    })
    return () => { try { if (typeof off === 'function') off() } catch { /* ignore */ } }
  }, 'aurabot: 宿主维护插件提示词边界')

  // 宿主维护插件会把注入排到最前面；在模型请求出口把人设块搬回最前。
  ctx.effect(() => {
    const off = installPersonaHoist(ctx, {
      llm: ctx.llm,
      log,
      isAurabotRequest: (options) => {
        try { return Boolean(options?.sessionId && hub?.chatOfSession?.(options.sessionId)) } catch { return false }
      },
    })
    return () => { try { if (typeof off === 'function') off() } catch { /* ignore */ } }
  }, 'aurabot: 人设前置')

  // ---------- 面板接口的小工具 ----------
  const { send, readBody, readRaw, query, answer, panelBlocked, adminHostBlocked, csrfBlocked } = createHttpKit({
    getConfig,
    log,
    prefix: PREFIX,
  })

  const knowledge = createKnowledge()
  // 写操作统一拒绝 GET：具体 handler 仍可做更严格的方法校验。
  const writeLike = /(?:^|\/)(?:save|delete|reset|restore|remove|create|reload|install|upload|push|config|revoke|share|change|feed|wake|sleepnow|sleep|close|drop|edit|use|pin|infer|confirm|act|test-send|move|trust|setup|sync|reconnect|tidy|organize|forget|boost|private|scope|note)(?:\/|$)/
  const route = (path, handler, opts = {}) => ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PREFIX + path,
    handler: (req, res) => answer(res, () => {
      if (panelBlocked(req, res)) return undefined
      if (!opts.skipHostCheck && adminHostBlocked(req, res)) return undefined // DNS rebinding 防护（含 GET）
      if (csrfBlocked(req, res)) return undefined
      // 写操作/需要包体的接口只能 POST：路径词根兜底 + 显式登记（见 host/post-only.js）
      if ((writeLike.test(path) || POST_ONLY.has(path)) && !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        try { res.setHeader('Allow', 'POST') } catch {}
        send(res, 405, { ok: false, message: '这个接口只能用 POST' })
        return undefined
      }
      return handler(req, res)
    }),
  }), `aurabot: 路由 ${path}`)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX, // DSH 按「路径 = 前缀 或 以 前缀/ 开头」匹配，前缀本身不带结尾的 /
    handler: (req, res) => answer(res, () => {
      let path = ''
      try { path = new URL(req.url, 'http://x').pathname } catch {}
      // 【复审 2·P1-2】模块 prefix 路由也过 CSRF：实测本机 socket + 恶意 Origin 能跨站打
      // POST /aurabot/api/<模块>/run、/ext/<模块>/run 等无 token 的模块路由。
      // 模块路由有自己的 Host 闸与鉴权，但同样缺跨站防护；外部模块客户端不带 Origin，
      // 不受影响；桌面面板的 fetch 是同源，也不受影响。
      if (csrfBlocked(req, res)) return undefined
      // 模块路由默认全部属于管理面：先过 Host/回环闸。外部客户端以后要访问，
      // 必须显式增加带独立 token 的 client 路由，不能靠 access:null 裸跑。
      if (adminHostBlocked(req, res)) return undefined
      if (panelBlocked(req, res, true)) return undefined
      return mods.handle(path, req, res)
    }),
  }), 'aurabot: 模块接口')

  // ---------- 模块 ----------
  const core = {
    hub, onebot, channels, platforms: channels, local, groupRoles, mutes, logger, bridge: null, tasks, taskRequesters,
    root: ROOT,
    ask: (opts) => askModel(ctx, { cfg: getConfig(), ...opts }),
    listModels,
    defaultModel: () => defaultModel(ctx, { model: {} }),
    http: { body: readBody, raw: readRaw, query, send },
    media: createMediaAccess({ root: ROOT, use, config: getConfig }),
    // 要告诉人一件事（点的歌没唱成之类）：由她用自己的话说，见 features/her-voice.js
    herVoice: { tell: (o) => herVoice.tell(o) },
    personas: { list: listPersonas, read: readPersona, current: () => currentPersonaText(cfg.persona.current) },
    getConfig, setConfig,
    // 给模块的心智接口（按模块身份）；心智核心没起来时是 null
    mindFor: (moduleId, source) => (mind ? mind.moduleApi(moduleId, source) : null),
  }
  mods = createModules({ ctx, core, getConfig, setConfig, logger, version: VERSION, builtins: [...BUILTINS, ...QQ_FEATURES] })
  try { qq?.setOutboxBarrier?.((chatId) => hub?.whenTurnIdle?.(chatId)) } catch (error) { log.debug('注入补发闸失败：', error.message) }
  bridge = createBridge({ ctx, getConfig, setConfig, hub, mods, log: logger.child('bridge'), version: VERSION, apiVersion: API_VERSION, overview: () => overview() })
  core.bridge = bridge
  core.modules = mods
  // 危险命令确认（可选保护）：DSH 在真正执行终端工具前会走 tools/pre-execute；
  // 这里只拦 bash / pwsh 的危险命令，其它工具和普通命令原样放行。
  dangerGuard = createDangerGuard({
    getConfig,
    log: logger.child('危险命令'),
    deliver: (chatId, text) => backgroundText(chatId, text, '通知'),
    chatOfSession: (sessionId) => { try { return hub.chatOfSession?.(sessionId) || '' } catch { return '' } },
    // tools/pre-execute 是进程级的，同一个 DSH 里管理员自己开的会话也会走到这里；那些会话不归这个守卫管
    // 判断不出来（hub.isOwnedSession 缺失 / 抛错）时 safeOwnedSession 返回 true，走原 deny 逻辑；
    // 只有明确 false（宿主自己的 GUI/CLI 会话）才放行给 DSH 自己的权限系统，别在异常时 fail-open。
    isOwnedSession: safeOwnedSession(typeof hub?.isOwnedSession === 'function' ? (sessionId) => hub.isOwnedSession(sessionId) : null),
    ownerQQ: () => cfg.ownerQQ,
  })
  core.dangerGuard = dangerGuard
  // 要告诉管理员的事（授权、提问、QQ 里批没批）由她用自己的话说，不发固定模板（见 features/her-voice.js）
  const ownerChatId = () => mind?.ownerChat() || (getConfig().ownerQQ ? `private:${getConfig().ownerQQ}` : '')
  /** 从渠道会话 ID 得到聊天中枢的会话对象。 */
  const chatOfId = (chatId) => {
    const target = parseChat(chatId)
    if (!target) return null
    const { platform, kind, id } = target
    if (kind === 'group') return { chatId, platform, kind, groupId: id, userId: '', nickname: '' }
    return { chatId, platform, kind, userId: id, nickname: chatId === ownerChatId() ? ownerCall() : '' }
  }
  const herVoice = createHerVoice({
    ownerChatId,
    busy: (chatId) => Boolean(hub?.turnRunning?.(chatId)),
    pushNote: (note, chatId) => hub.pushToSession(chatOfId(chatId), [{ type: 'text', text: note }], '', { internal: true }),
    ask: ({ system, text }) => askModel(ctx, { system, text, maxTokens: 400, reasoningEffort: 'low', temperature: 0.8, cfg: getConfig(), module: 'notice' }),
    persona: (chatId) => {
      const owner = sameChat(chatId, ownerChatId())
      return mind?.selfPrompt({ publicOnly: !owner }) || (owner ? currentPersonaText(getConfig().persona.current) : '你是大肥鱼。')
    },
    context: (chatId) => { try { return mind?.contextFor?.({ chat: chatOfId(chatId) }) || '' } catch { return '' } },
    send: (chatId, text) => backgroundText(chatId, text, '后台消息'),
    log,
  })
  approvalRelay = createApprovalRelay({ getConfig, deliver: (chatId, text) => backgroundText(chatId, text, '审批通知'), speak: (o) => herVoice.tell({ ...o, via: 'direct' }), chatOfSession: (id) => hub.chatOfSession(id), log })
  ctx.effect(() => {
    let off = null
    try { off = ctx.on('approval/request', (request, next) => approvalRelay.onRequest(request, next)) } catch (error) { log.debug('挂审批应答失败：', error.message) }
    return () => { try { if (typeof off === 'function') off() } catch {} }
  }, 'aurabot: QQ 审批')
  ctx.effect(() => {
    let off = null
    try { off = ctx.on('tools/pre-execute', (exec, next) => dangerGuard.preExecute(exec, next)) } catch (error) { log.debug('挂危险命令确认失败：', error.message) }
    return () => { try { if (typeof off === 'function') off() } catch {} }
  }, 'aurabot: 危险命令确认')

  let unloaded = false
  const community = createCommunity({ mods, getConfig, setConfig, log, version: VERSION, alive: () => !unloaded })
  const booted = mods.boot()
  booted.then(() => (unloaded ? [] : community.migrate())).catch((error) => log.warn('搬到社区库的模块处理失败：', error.message))
    .then(async () => {
      // 恢复备份后把模块库里的模块装回来；没装上的留着，下次启动再试
      const left = []
      for (const id of pendingModules()) {
        if (unloaded) return
        const r = await community.install(id)
        if (!r.ok && !/自己的文件夹/.test(r.message)) { left.push(id); log.warn(`恢复模块「${id}」没装上，下次启动再试：`, r.message) }
      }
      if (!unloaded) setPendingModules(left)
    }).catch((error) => log.warn('恢复模块失败：', error.message))
  booted.then(() => {
    if (unloaded) return
    bridge.refresh()
    // 启动时就开着调试的，顺手把调试会话建出来（没建过才会建）
    if (getConfig().debug) hub.ensureDebugSession().catch((error) => log.warn('建调试会话失败：', error.message))
  })

  // ---------- 审批 / 提问：DSH 要人处理时，她在 QQ 里跟你说一声（移植自原项目 354160e）----------
  // 只上报，不代答：DSH 界面照常弹，谁在电脑前谁点。按工作区分别开关（config.notice）。
  function workspaceList() {
    try {
      const reg = ctx.workspaceRegistry || ctx.get?.('workspaceRegistry')
      return reg?.list?.() || []
    } catch { return [] }
  }
  function workspaceOfSession(sessionId) {
    const sid = String(sessionId || '')
    if (!sid) return ''
    const hit = workspaceList().find((w) => (w?.sessionIds || []).some((x) => String(x) === sid))
    return hit ? String(hit.path || '') : ''
  }
  const clock = (t) => {
    const d = new Date(Number(t) || Date.now())
    const p = (n) => String(n).padStart(2, '0')
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }
  // 上一次说这类事的时间：10 秒内不再说，连着进来几批时不刷屏（没说出去的留在队列里重试）
  let lastNoticeAt = 0
  /** 把攒下来的几件事交给她，用她自己的话说（facts 只给她看，不原样发出去）。 */
  async function noticeCompose(items) {
    const list = Array.isArray(items) ? items : []
    if (!list.length || !hub) return false
    if (Date.now() - lastNoticeAt < 10000) return false
    const lines = list.map((it, i) => {
      const title = String(it.title || '未命名').slice(0, 40)
      const ws = workspaceOfSession(it.sessionId)
      const where = `会话「${title}」` + (ws ? `，在 ${ws.split('/').filter(Boolean).pop()} 这个项目里` : '')
      if (it.kind === 'approval') return `${i + 1}. [${clock(it.at)}] ${where}卡在「${it.tool || '某个工具'}」上，等他在 DSH 里点批准` + (it.reason ? `（原因：${String(it.reason).slice(0, 120)}）` : '')
      const q = (it.questions || []).map((x) => x?.question).filter(Boolean)[0] || '有个问题'
      return `${i + 1}. [${clock(it.at)}] ${where}在等他选：${String(q).slice(0, 80)}`
    })
    const facts = `他电脑上的 DSH 里有活卡住了，要他去 DSH 界面处理（现在 ${clock(Date.now())}；每一条是单独的一件事）：\n${lines.join('\n')}`
    const done = await herVoice.tell({ facts, fallback: `DSH 里有 ${list.length} 件事在等你处理：\n` + lines.map((l) => l.replace(/等他/g, '等你')).join('\n') })
    if (done) lastNoticeAt = Date.now()
    return Boolean(done)
  }
  const noticeRelay = createNoticeRelay({ getConfig, workspaceOf: workspaceOfSession, compose: noticeCompose, log })
  async function notifyApproval(session, event) {
    try {
      if (!cfg.enabled || cfg.dryRun) return
      const d = event.data || {}
      const id = String(d.id || '')
      if (!id) return
      // 等一下看 QQ 有没有问：问了就不用再说一遍；没问（比如审批没走到插件）照常说，你不会什么都收不到
      if (approvalRelay?.handles(session?.id)) {
        await new Promise((r) => setTimeout(r, 1500))
        if (approvalRelay.askedRecently()) return
      }
      let title = ''
      try { title = String(session?.title || '').trim() } catch {}
      if (!title) title = String(session?.id || '').slice(-8) // 会话事件里常常没带标题：用 id 后 8 位兜底
      const queued = noticeRelay.announce('approval', { id, sessionId: session?.id, title, tool: d.toolName, reason: d.reason })
      log.info(`审批上报：${d.toolName || '?'}（会话 ${String(session?.id || '').slice(-8) || '?'}）→ ${queued ? '已入队' : (noticeRelay.enabled('approval', session?.id) ? '重复/已在队列' : '被开关挡掉')}`)
    } catch (error) {
      log.debug?.('审批通知失败：', error.message)
    }
  }
  // 要人选选项：从全局的 tool/call 事件认（user-questions/request 是 agent 级的，插件根 scope 收不到）
  function noticeQuestion(session, event) {
    try {
      const d = event?.data || {}
      const sid = String(session?.id || '')
      if (!sid) return
      if (event.type === 'tool/call' && d.name === 'ask_user_question' && d.callId) {
        // 她自己在 QQ 聊天会话里问的，那边会话本身就会发出去，不用再报
        if (hub?.chatOfSession?.(sid)) return
        let qs = []
        try { qs = JSON.parse(String(d.arguments || '{}')).questions || [] } catch {}
        if (!Array.isArray(qs) || !qs.length) return
        let title = ''
        try { title = String(session?.title || '').trim() } catch {}
        if (!title) title = sid.slice(-8)
        const queued = noticeRelay.announce('question', { id: `q:${sid}:${d.callId}`, sessionId: sid, title, questions: qs })
        log.info(`提问上报：${qs.length} 个问题（${title}）→ ${queued ? '已入队' : (noticeRelay.enabled('question', sid) ? '重复/已在队列' : '被开关挡掉')}`)
      } else if (event.type === 'tool/result') {
        const callId = d.message?.toolCallId ?? d.toolCallId
        if (callId) noticeRelay.cancel(`q:${sid}:${callId}`) // 已有结果（包括错误）就撤掉待发提醒
      }
    } catch (error) {
      log.debug?.('提问上报失败：', error.message)
    }
  }

  // ---------- 盯会话：一轮结束就发回 QQ ----------
  ctx.effect(() => {
    const off = ctx.on('session/event', (session, event) => {
      try {
        hub.onSessionEvent(session, event)
      } catch (error) {
        log.warn('会话事件处理出错：', error.message)
      }
      // 审批请求顺手通知到管理员私聊（只通知，不代答）
      if (event && event.type === 'approval/asked') notifyApproval(session, event)
      // 你已经点过了：还在缓冲里的那条撤掉，别等你点完才提醒
      if (event && event.type === 'approval/decided') { try { noticeRelay.cancel(String(event.data?.id || '')) } catch {} }
      if (event && (event.type === 'tool/call' || event.type === 'tool/result')) noticeQuestion(session, event)
    })
    return () => { try { if (typeof off === 'function') off() } catch {} }
  }, 'aurabot: 盯会话')

  // ---------- 启动 / 看门狗 ----------
  async function watchdog() {
    if (unloaded) return
    for (const ch of channels.list()) {
      try {
        if (typeof ch.watch === 'function') ch.watch()
        else if (typeof ch.state !== 'function' || ch.state() === 'stopped') await Promise.resolve(ch.start())
      } catch (error) { log.warn(`平台 ${ch.platform} 看门狗失败：`, error.message) }
    }
  }
  const safe = (fn, label) => () => { Promise.resolve().then(fn).catch((error) => log.warn(`${label}出错：`, error.message)) }
  ctx.effect(() => ctx.interval(safe(watchdog, '看门狗'), 30_000), 'aurabot: 看门狗')
  const firstWatch = setTimeout(safe(watchdog, '看门狗'), 3000)
  firstWatch.unref?.()
  ctx.effect(() => () => {
    unloaded = true
    clearTimeout(firstWatch)
    backupScheduler?.dispose() // 云备份的每日定时也要收尾，别留悬空回调
    dangerGuard?.dispose()
    approvalRelay?.dispose()
    // 先停平台：关闭期间不再产生新的入站/出站；再收中枢、心智和模块。
    for (const ch of channels.list()) {
      try { if (ch.dispose) ch.dispose(); else ch.stop() } catch (error) { log.warn(`关闭平台 ${ch.platform} 失败：`, error.message) }
    }
    tasks.dispose()
    hub.dispose()
    try { Promise.resolve(mind?.close()).catch((error) => log.debug('心智关闭出错：', error.message)) } catch {}
    bridge.dispose()
    mods.dispose()
  }, 'aurabot: 收尾')

  // ---------- 面板接口 ----------
  const avatar = createAvatarStore({ dataDir })
  const overview = createOverview({
    getConfig: () => cfg, version: VERSION, apiVersion: API_VERSION, homedir, publicConfig,
    qq, channels, outbox, hub, nextChange, isPeak, getMind: () => mind, stickers, use,
    avatarInfo: avatar.info, workspaceDirOf, realWorkspace, listPersonas, mods, bridge, ctx,
  })

  // 云备份的每日定时器：拥有自己的状态，setConfig / 面板 / 卸载三处只跟它对话
  const backupScheduler = createBackupScheduler({
    getConfig, log, alive: () => !unloaded, getBackupJob: () => backupJob,
    createBackup, pushBackup, captureMind: () => (mind ? () => mind.backupFiles() : null),
    workspaceDirOf, version: VERSION,
  })

  // ---------- 面板：对外接口（路由表在 host/routes.js，这里只递依赖） ----------
  registerAllRoutes({
    route, http: { send, readBody, readRaw, query },
    getConfig, setConfig, getMind: () => mind, getBackupJob: () => backupJob, setBackupJob: (next) => { backupJob = next },
    getPushJob: backupScheduler.getPushJob, nextPushAt: backupScheduler.nextAt, doPush: backupScheduler.doPush,
    hub, ctx, onebot, qq, channels, mods, bridge, local, knowledge, log, logger,
    overview, usageReport, applyPanelSave, mergeFromPanel, clearReasoningCache, clearVisionCache,
    startWatchdog: () => setTimeout(safe(watchdog, '看门狗'), 100),
    commandList, root: ROOT, version: VERSION, changelogSection, moveWorkspace, workspaceDirOf,
    backgroundText, listProviderModels, listModels, askModel, shortRef, parsePerson, legacyPlatform: LEGACY_PLATFORM,
    readPersona, savePersona, listPersonas, deletePersona, dataDir, trashDir, mimeOf, ensureDir, send,
    avatarFile: avatar.file, avatarInfo: avatar.info,
    workspaceList, normalizeWorkspace, community, parseCommand, apiVersion: API_VERSION,
    localAudioFile, localImageBuffer,
    listBackups, pendingRestore, pendingSessions, pendingModules, inspectBackup, createBackup,
    stageReceivedBackup, stageRestore, cancelRestore, retryPendingSessions, cancelPendingSessions,
    listWebdavBackups, downloadWebdavBackup,
  })

  backupScheduler.schedule() // 云备份：到点自动打包推送（配置里关着就是空操作）
  log.info(`Aurabot v${VERSION} 已加载｜总开关 ${cfg.enabled ? '开' : '关'}｜试运行 ${cfg.dryRun ? '开' : '关'}｜工作区 ${workspaceDirOf(cfg)}`)

  return {
    hub, onebot, getConfig, setConfig, logger, modules: mods, bridge, ready: booted,
    get stickers() { return use('stickers') },
    get qzone() { return use('diary') },
    get mind() { return mind },
  }
}
