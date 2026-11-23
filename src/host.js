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

import { readFileSync, existsSync, writeFileSync, unlinkSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { loadConfig, saveConfig, publicConfig, mergeFromPanel, ownerAuthorizationRevision } from './core/config.js'
import { createLogger } from './core/logger.js'
import { registerSecret } from './core/redact.js'
import { LEGACY_PLATFORM, normChat, parseChat, parsePerson, sameChat, shortRef } from './channels/index.js'
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
import { applyPendingRestore, cancelRestore, createBackup, inspectBackup, listBackups, pendingModules, pendingRestore, setPendingModules, stageReceivedBackup, stageRestore, pruneLocalBackups, prunePreRestore } from './core/backup.js'
import { pushBackup, listWebdavBackups, downloadWebdavBackup } from './core/backup-push.js'
import { createBridge } from './core/bridge.js'
import { createDangerGuard, safeOwnedSession } from './security/danger.js'
import { setSsrpMode } from './core/net.js'
import { BUILTINS } from './modules/index.js'
import { createKnowledge } from './features/knowledge.js'
import { createMindAdapter } from './mind-adapter/index.js'
import { createPurgeScope } from './integration/purge-scope.js'
import { installPromptVariables } from './host/prompt-vars.js'
import { createHttpKit } from './host/http.js'
import { installPersonaHoist } from './integration/persona-hoist.js'
import { createLocalInstaller } from './mind-adapter/install.js'

export const name = 'aurabot'
export const inject = ['agents', 'sessions', 'webServer', 'timer', 'workspaceRegistry', 'attachments', 'systemPrompt', 'llm']

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
  let pushJob = null // { running, ok, error, result, at }
  let pushTimer = null // 云备份每日定时
  let pushDueAt = null
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
    if (before.botQQ !== cfg.botQQ) {
      qq.resetAccount()
      if (qq.state() === 'connected') qq.restart()
    } else if (['enabled', 'wsUrl', 'httpUrl', 'wsToken', 'httpToken'].some((k) => beforeQq[k] !== afterQq[k])) {
      // 改地址、令牌或启停也要换连接；只改白名单/权限时不动现有连接。
      if (afterQq.enabled === false) qq.stop()
      else if (qq.state() !== 'stopped') qq.restart()
    }
    if (before.enabled !== cfg.enabled && cfg.enabled) qq.start()
    const beforeTg = before.platforms?.telegram || {}
    const afterTg = cfg.platforms?.telegram || {}
    const tgChanged = ['enabled', 'token', 'apiBase'].some((k) => beforeTg[k] !== afterTg[k])
    const tg = channels.get('telegram')
    if (before.enabled && !cfg.enabled) tg?.stop()
    else if (!before.enabled && cfg.enabled && afterTg.enabled && afterTg.token) tg?.start().catch((error) => log.warn('Telegram 启动失败：', error.message))
    if (tgChanged) {
      if (!afterTg.enabled || !afterTg.token) tg?.stop()
      else tg?.restart().catch((error) => log.warn('Telegram 重启失败：', error.message))
    }
    if (bridge && before.bridge.dshTools !== cfg.bridge.dshTools) bridge.refresh()
    // 管理员在面板里改了「ta怎么称呼你」：以管理员改的为准（她自己改过的叫法被盖掉，记一个版本）
    if (mind && String(before.ownerName || '') !== String(cfg.ownerName || '') && String(cfg.ownerName || '').trim()) {
      try { mind.mind.self.change({ what: 'ownerCall', content: String(cfg.ownerName).trim(), why: '管理员在面板里改了称呼' }, { by: 'owner' }) } catch (error) { log.debug('称呼没跟着改：', error.message) }
    }
    if (mods && (JSON.stringify(before.modules) !== JSON.stringify(cfg.modules) || before.safeMode !== cfg.safeMode)) mods.sync().catch(() => {})
    mods?.emit('config', cfg, before)
    if (JSON.stringify(before.backup?.remote) !== JSON.stringify(cfg.backup?.remote)) scheduleRemoteBackup()
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
      const run = previous.then(() => hub.onMessage(msg)).catch((error) => log.error('处理消息出错：', error.message))
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
      } catch (error) {}
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
  try {
    mind = createMindAdapter({
      dir: dataDir('mind'),
      getConfig,
      log: logger.child('mind'),
      persona: () => readPersona(getConfig().persona.current),
      legacyDir: dataDir(),
      trashDir,
      // 心智核心的后台用途（记经历、睡觉整理、做梦）都用 DeepSeek，思考深度按用途定
      // 带回真实用量（输入 + 输出 token），每天的后台预算按它记，拿不到时心智核心按字数估
      ask: async ({ scene, system, text, maxTokens, reasoningEffort }) => {
        let tokens = 0
        const out = await askModel(ctx, { system, text, maxTokens, reasoningEffort, temperature: 0.4, cfg: getConfig(), module: 'mind:' + (scene || 'think'), onUsage: (u) => { tokens += (Number(u?.inputTokens) || 0) + (Number(u?.outputTokens) || 0) } })
        return tokens ? { text: out, tokens } : out
      },
      embedKey: () => getConfig().mind?.embedKey || '',
      // 她想主动找人：把心里的由头交给那个私聊，话由她自己说
      reachOut: async ({ chatId, userId, note }) => {
        if (!hub) return false
        return hub.pushToSession({ chatId, kind: 'private', userId: String(userId), nickname: ownerCall() }, [{ type: 'text', text: note }], '', { internal: true, confirmDelivery: true })
      },
      deliverReminder: async ({ chatId, text, isCurrent }) => {
        const result = await backgroundText(chatId, text, '提醒', { isCurrent, allowQueue: false, throwOnError: true })
        return Boolean(result && !result.queued)
      },
      // 她改了自己之后通知你（系统通知，不是她说的话）
      notifyOwner: async (text) => {
        const chatId = mind?.ownerChat()
        if (!hub || !chatId) return
        await backgroundText(chatId, text, '心智通知', { force: true, quiet: true, system: true }).catch(() => {})
      },
      // 她改了人格卡、名字：面板里正在用的那份人格卡文件跟着改，两边一致
      onSelfChange: ({ what, after }) => {
        const id = getConfig().persona.current
        const cur = readPersona(id)
        if (!cur) return
        if (what === 'persona') savePersona(id, { name: cur.name, tags: cur.tags, body: after, nickname: cur.nickname })
        if (what === 'name') savePersona(id, { name: after, tags: cur.tags, body: cur.body, nickname: cur.nickname })
        if (what === 'nickname') savePersona(id, { name: cur.name, tags: cur.tags, body: cur.body, nickname: after })
      },
      // 群名（聊天中枢查到过的；没查到就显示群号）
      groupName: (gid, platform) => platform === LEGACY_PLATFORM ? hub?.groupNames?.get?.(String(gid)) || '' : '',
      // 正在翻唱（很吃内存）：本地小模型先让路
      heavyBusy: () => { try { return Boolean(use('song')?.status?.()?.current) } catch (error) { return false } },
      foregroundBusy: () => hub?.foregroundBusy(),
      // 醒来后把睡着时找她的消息重新交给聊天中枢（一条一条来，管理员的先）
      onWakeReplay: async (list) => {
        for (const item of list) {
          if (!hub) return
          try { await hub.onMessage(item.event) } catch (error) { log.debug('补回消息失败：', error.message) }
          await new Promise((r) => setTimeout(r, 1500))
        }
      },
    })
    mind.start().catch((error) => log.warn('心智核心启动步骤出错：', error.message))
  } catch (error) {
    log.warn('心智核心没起来（聊天照常）：', error.message)
    mind = null
  }

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
        try { return Boolean(hub?.chatOfSession?.(agent?.session?.id)) } catch (error) { return false }
      },
    })
    return () => { try { if (typeof off === 'function') off() } catch (error) { /* ignore */ } }
  }, 'aurabot: 宿主维护插件提示词边界')

  // 宿主维护插件会把注入排到最前面；在模型请求出口把人设块搬回最前。
  ctx.effect(() => {
    const off = installPersonaHoist(ctx, {
      llm: ctx.llm,
      log,
      isAurabotRequest: (options) => {
        try { return Boolean(options?.sessionId && hub?.chatOfSession?.(options.sessionId)) } catch (error) { return false }
      },
    })
    return () => { try { if (typeof off === 'function') off() } catch (error) { /* ignore */ } }
  }, 'aurabot: 人设前置')

  // ---------- 面板接口的小工具 ----------
  const { send, readBody, readRaw, query, answer, isLoopbackAddr, panelBlocked, adminHostBlocked, csrfBlocked } = createHttpKit({
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
      if (writeLike.test(path) && !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        try { res.setHeader('Allow', 'POST') } catch {}
        send(res, 405, { ok: false, message: '写操作只能用 POST' })
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
      try { path = new URL(req.url, 'http://x').pathname } catch (error) {}
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
    chatOfSession: (sessionId) => { try { return hub.chatOfSession?.(sessionId) || '' } catch (error) { return '' } },
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
    context: (chatId) => { try { return mind?.contextFor?.({ chat: chatOfId(chatId) }) || '' } catch (error) { return '' } },
    send: (chatId, text) => backgroundText(chatId, text, '后台消息'),
    log,
  })
  approvalRelay = createApprovalRelay({ getConfig, deliver: (chatId, text) => backgroundText(chatId, text, '审批通知'), speak: (o) => herVoice.tell({ ...o, via: 'direct' }), chatOfSession: (id) => hub.chatOfSession(id), log })
  ctx.effect(() => {
    let off = null
    try { off = ctx.on('approval/request', (request, next) => approvalRelay.onRequest(request, next)) } catch (error) { log.debug('挂审批应答失败：', error.message) }
    return () => { try { if (typeof off === 'function') off() } catch (error) {} }
  }, 'aurabot: QQ 审批')
  ctx.effect(() => {
    let off = null
    try { off = ctx.on('tools/pre-execute', (exec, next) => dangerGuard.preExecute(exec, next)) } catch (error) { log.debug('挂危险命令确认失败：', error.message) }
    return () => { try { if (typeof off === 'function') off() } catch (error) {} }
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
    } catch (error) { return [] }
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
      try { title = String(session?.title || '').trim() } catch (error) {}
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
        try { qs = JSON.parse(String(d.arguments || '{}')).questions || [] } catch (error) {}
        if (!Array.isArray(qs) || !qs.length) return
        let title = ''
        try { title = String(session?.title || '').trim() } catch (error) {}
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
      if (event && event.type === 'approval/decided') { try { noticeRelay.cancel(String(event.data?.id || '')) } catch (error) {} }
      if (event && (event.type === 'tool/call' || event.type === 'tool/result')) noticeQuestion(session, event)
    })
    return () => { try { if (typeof off === 'function') off() } catch (error) {} }
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
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null } // 云备份的每日定时也要收尾，别留悬空回调
    dangerGuard?.dispose()
    approvalRelay?.dispose()
    // 先停平台：关闭期间不再产生新的入站/出站；再收中枢、心智和模块。
    for (const ch of channels.list()) {
      try { ch.dispose ? ch.dispose() : ch.stop() } catch (error) { log.warn(`关闭平台 ${ch.platform} 失败：`, error.message) }
    }
    tasks.dispose()
    hub.dispose()
    try { Promise.resolve(mind?.close()).catch((error) => log.debug('心智关闭出错：', error.message)) } catch (error) {}
    bridge.dispose()
    mods.dispose()
  }, 'aurabot: 收尾')

  // ---------- 面板接口 ----------
  async function overview() {
    const diary = use('diary')
    return {
      ok: true,
      version: VERSION,
      apiVersion: API_VERSION,
      home: homedir(),
      config: publicConfig(cfg),
      onebot: await qq.status(),
      channels: channels.status(),
      outbox: outbox.status(),
      stats: hub.stats(),
      offpeak: (() => { const now = new Date(); const holidays = cfg.cost?.offPeakHolidays || []; const next = nextChange(now, { holidays }); return { peak: isPeak(now, { holidays }), next: next?.at || 0 } })(),
      // 模块关着时给个空壳，面板照常显示
      // 概览上的心情（心智核心）：value 把 -1～1 的愉快度换成 0～100 显示
      mood: (() => { try { const f = mind.mind.feeling(); return { value: Math.round((f.mood.v + 1) * 50), label: f.body.asleep ? '睡着了' : f.mood.label, reason: f.emotions[0] ? f.emotions[0].name : '', history: [] } } catch (error) { return { value: 0, label: '心智核心没起来', reason: '', history: [] } } })(),
      stickers: { count: stickers.library().items.length },
      diary: { next: '', last: diary?.history()[0] || null },
      qzoneSocial: use('qzone-social')?.state?.() ?? null,
      // 心智核心：上次睡觉整理的时间和结果、今天花了多少
      mind: mind ? { sleep: mind.mind._store.get('sleep.lastReport', null), usage: mind.mind.budget.spent(), counts: mind.mind.status().counts } : null,
      avatar: avatarInfo(),
      voice: { edgeInstalled: use('voice')?.edgeInstalled?.() ?? false },
      song: use('song')?.status?.() ?? null,
      sessions: hub.sessions(),
      sessionHealth: hub.sessionHealth(),
      workspaceDir: workspaceDirOf(cfg),
      workspaceReal: realWorkspace(workspaceDirOf(cfg)),
      personas: listPersonas(),
      modules: mods.status(),
      bridge: { dshTools: cfg.bridge.dshTools, http: cfg.bridge.http, hasToken: Boolean(cfg.bridge.token), tools: bridge.deniedTools(), toolsService: Boolean(ctx.get?.('tools')) },
    }
  }

  // ---------- 面板：对外接口聚合 ----------

  route('/state', async () => overview())
  // token 用量与花费：今日 / 昨日 / 近 7 天 / 近 30 天，各带模块明细
  // ?range=today|yesterday|7|30|all —— 面板点哪张指标卡就按哪个区间出明细
  route('/usage', async (req) => ({ ok: true, ...usageReport({ range: query(req).range || '7' }) }))

  route('/save', async (req) => {
    const body = await readBody(req)
    const before = cfg
    setConfig(mergeFromPanel(cfg, body))
    // 换了模型：思考强度和「能不能看图」的探测结果都得重来，不然要等 10 分钟缓存过期
    const changedModel = before.model.provider !== cfg.model.provider || before.model.model !== cfg.model.model
    if (changedModel) { clearReasoningCache(); clearVisionCache() }
    if (!before.enabled && cfg.enabled) setTimeout(safe(watchdog, '看门狗'), 100)
    if (before.enabled && !cfg.enabled) qq.stop()
    log.info(`设置已保存｜总开关 ${cfg.enabled ? '开' : '关'}｜试运行 ${cfg.dryRun && !cfg.debug ? '开' : '关'}｜调试 ${cfg.debug ? '开' : '关'}`)
    await mods.sync().catch(() => {})
    // 一开调试就把管理员私聊的调试会话建出来，省得你还得先发条 QQ 消息才有会话说
    let debugNote = ''
    if (cfg.debug) {
      try {
        const d = await hub.ensureDebugSession()
        debugNote = d.created ? '，调试会话已建好' : ''
      } catch (error) {
        log.debug('建调试会话失败：', error.message)
      }
    }
    return { ...(await overview()), message: '保存好了' + debugNote }
  })

  // 手动把调试会话建出来（默认一开调试就自动建，这个是为了重开面板后能再确认一次）
  route('/debug/session', async () => {
    try {
      return await hub.ensureDebugSession()
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })

  route('/knowledge/list', async () => ({ ok: true, list: knowledge.list() }))
  route('/knowledge/read', async (req) => {
    const r = knowledge.read(String(query(req).path || ''), { limit: 30000, admin: true })
    return r ? { ok: true, ...r } : { ok: false, message: '读不到这个知识库文件' }
  })
  route('/knowledge/search', async (req) => {
    const q = String(query(req).q || '').trim()
    const limit = Math.max(1, Math.min(50, Number(query(req).limit) || 20))
    const offset = Math.max(0, Number(query(req).offset) || 0)
    const list = q ? knowledge.search(q, { limit, offset, admin: true }) : []
    return { ok: true, list, hasMore: list.length >= limit }
  })
  route('/knowledge/rename', async (req) => {
    if (req?.method !== 'POST') return { ok: false, message: '要用 POST' }
    let b = {}
    try { b = await readBody(req) || {} } catch (error) { return { ok: false, message: error.message || '请求内容不对' } }
    return knowledge.rename(String(b.path || ''), String(b.title || ''))
  })
  route('/knowledge/delete', async (req) => {
    if (req?.method !== 'POST') return { ok: false, message: '要用 POST' }
    let b = {}
    try { b = await readBody(req) || {} } catch (error) { return { ok: false, message: error.message || '请求内容不对' } }
    return knowledge.remove(String(b.path || ''))
  })
  route('/knowledge/note', async (req) => {
    if (req?.method !== 'POST') return { ok: false, message: '要用 POST' }
    let b = {}
    try { b = await readBody(req) || {} } catch (error) { return { ok: false, message: error.message || '请求内容不对' } }
    return knowledge.createNote(String(b.title || ''), String(b.content || ''), { scope: String(b.scope || 'all'), folder: String(b.folder || '') })
  })
  route('/knowledge/scope', async (req) => {
    if (req?.method !== 'POST') return { ok: false, message: '要用 POST' }
    let b = {}
    try { b = await readBody(req) || {} } catch (error) { return { ok: false, message: error.message || '请求内容不对' } }
    return knowledge.setScope(String(b.path || ''), String(b.scope || 'all'))
  })
  route('/logs', async (req) => {
    const q = query(req)
    return { ok: true, entries: logger.recent(Number(q.limit) || 300, { level: q.level || '', area: q.area || '' }) }
  })

  route('/commands', async () => ({ ok: true, list: commandList(mods.commands()) }))
  route('/access/chat-names', async () => {
    const namesOf = async (action, idKey, nameKey, kind) => {
      if (!cfg.allow[kind].length || !qq.ready()) return {}
      const bot = cfg.botQQ
      try {
        const rows = await onebot.call(action, {}, { wsOnly: true, timeoutMs: 2500 })
        if (cfg.botQQ !== bot || !qq.ready()) return {}
        const allowed = new Set(cfg.allow[kind])
        return Object.fromEntries((Array.isArray(rows) ? rows : []).flatMap((row) => {
          const id = String(row?.[idKey] ?? '')
          const name = String(row?.[nameKey] ?? '').trim().slice(0, 100)
          return name && allowed.has(id) ? [[id, name]] : []
        }))
      } catch { return {} }
    }
    const [privates, groups] = await Promise.all([
      namesOf('get_friend_list', 'user_id', 'nickname', 'private'),
      namesOf('get_group_list', 'group_id', 'group_name', 'groups'),
    ])
    return { ok: true, private: privates, groups }
  })
  // 版本更新交给 DSH 插件管理器；这里只保留只读的更新说明。
  route('/changelog', async () => {
    let text = ''
    try { text = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8') } catch (error) {}
    return { ok: true, version: VERSION, notes: changelogSection(text, VERSION) }
  })
  route('/workspace/move', async (req) => {
    const r = moveWorkspace(workspaceDirOf(cfg), (await readBody(req)).to)
    if (r.ok) {
      log.info(r.message)
    }
    return r
  })
  route('/setup/done', async (req) => {
    const body = await readBody(req)
    if (!cfg.botQQ || !cfg.ownerQQ || cfg.botQQ === cfg.ownerQQ) return { ok: false, message: '先填好不同的机器人 QQ 和你的 QQ' }
    if (body.existingConnection && !(cfg.enabled && qq.ready())) return { ok: false, message: 'QQ 网关还没通过机器人号核对，请先连接并核对后再进入面板' }
    setConfig({ ...cfg, setupDone: true })
    log.info('首次使用向导完成')
    return { ...(await overview()), message: '设置完成，大肥鱼可以上线啦' }
  })
  // 通用平台入口；QQ 的旧 onebot 路由保留。
  route('/platforms', async () => ({ ok: true, list: channels.status() }))
  route('/platforms/qq/diagnose', async () => qq.diagnose())
  route('/platforms/qq/reconnect', async () => qq.reconnect())
  // 一键诊断：顺着 OrbStack → SnowLuma 容器 → 端口 → 连上 → 登录的号 → 在线 一项项看
  route('/onebot/diagnose', async () => qq.diagnose())
  route('/onebot/reconnect', async () => qq.reconnect())
  route('/onebot/test', async () => {
    try {
      const info = await onebot.call('get_login_info', {}, { timeoutMs: 8000 })
      const uin = String(info?.user_id ?? '')
      const botQQ = String(cfg.platforms?.qq?.botQQ || cfg.botQQ || '')
      return { ok: uin === botQQ, message: uin === botQQ ? `连上了：${info.nickname}（${uin}）` : `连上的是 ${uin}，不是机器人号 ${botQQ}！`, info }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })
  route('/test-send', async (req) => {
    if (req.method !== 'POST') return { ok: false, message: '请从面板发起发送测试' }
    if (!cfg.enabled) return { ok: false, message: '先打开总开关' }
    if (cfg.debug) return { ok: false, message: '现在是调试模式，先回到正式模式再测' }
    if (cfg.dryRun) return { ok: false, message: '现在是试运行，先关掉试运行再测' }
    const ownerQQ = String(cfg.platforms?.qq?.ownerQQ || cfg.ownerQQ || '')
    if (!ownerQQ) return { ok: false, message: '先填写管理员 QQ 号' }
    const r = await backgroundText(`qq:private:${ownerQQ}`, '【Aurabot 自测】大肥鱼到此一游～', '自测', { allowQueue: false, system: true })
    return r && !r.queued && !r.simulated ? { ok: true, message: '发给管理员了，去 QQ 看看' } : { ok: false, message: '未确认送达，请查看日志' }
  })

  route('/sessions/reset', async () => {
    const result = await hub.resetSessions()
    const { archived, retained, failed } = result
    if (!archived && !retained && !failed) return { ok: true, ...result, message: '本来就没有聊天会话' }
    const notes = [`归档了 ${archived} 个聊天会话`]
    if (retained) notes.push(`为保留工作树留下 ${retained} 个旧会话`)
    if (failed) notes.push(`${failed} 个会话归档失败，旧会话仍可查看`)
    return { ok: true, ...result, message: notes.join('，') + '。下一条消息起她会重新开始。' }
  })

  // 人格
  // ---------- 心智核心（面板「心情与记忆」「人物」「心智设置」） ----------
  const mindOff = { ok: false, message: '心智核心没起来，看日志里的原因' }
  route('/mind/state', async () => {
    if (!mind) return mindOff
    const m = mind.mind
    return { ok: true, status: m.status(), usage: m.budget.spent(), sleep: m._store.get('sleep.lastReport', null), dreams: m._store.get('dreams.log', []).slice(0, 10), pending: m.memory.pendingWindows().length, deferredThoughts: m.inner.deferredCount() }
  })
  route('/mind/vectors', async () => (mind ? { ok: true, ...mind.mind.memory.vectorProgress(), ...mind.embeddingStatus() } : mindOff))
  route('/mind/memories', async (req) => {
    if (!mind) return mindOff
    const qs = query(req)
    const status = ['live', 'archived'].includes(qs.status) ? qs.status : 'live'
    const limit = Math.max(1, Math.min(200, Math.trunc(Number(qs.limit)) || 200))
    const offset = Math.max(0, Math.min(1_000_000, Math.trunc(Number(qs.offset)) || 0))
    const memory = mind.mind.memory
    const items = memory.list({ status, kind: qs.kind || '', q: String(qs.q || '').slice(0, 100), limit: limit + 1, offset })
    return { ok: true, items: items.slice(0, limit), next: items.length > limit ? offset + limit : null, counts: memory.counts(), ...(offset ? {} : { sources: memory.sourceCounts(status) }) }
  })
  route('/mind/memory/related', async (req) => mind
    ? { ok: true, items: mind.mind.memory.related(String(query(req).id || '').slice(0, 200)) }
    : mindOff)
  route('/mind/memory/delete', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    const deleted = mind.mind.memory.deleteEpisode(String(b.id || ''))
    if (deleted) mind.invalidateMemory()
    return deleted ? { ok: true, message: '已删除。有关的记忆、人格证据和故事会随之删除或重算。' } : { ok: false, message: '没有这条' }
  })
  route('/mind/memory/boost', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    return mind.mind.memory.boost(String(b.id || '')) ? { ok: true, message: '加强了，她会记得更牢' } : { ok: false, message: '没有这条' }
  })
  route('/mind/memory/private', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    const ok = mind.mind.memory.setPrivateOnly(String(b.id || ''), b.enabled === true)
    if (ok) mind.invalidateMemory()
    return { ok, message: ok ? (b.enabled ? '仅在与你的私聊中使用' : '已取消手动限制') : '没有这条记忆' }
  })
  route('/mind/memory/share', async (req) => {
    if (!mind) return mindOff
    if (req.method !== 'POST') return { ok: false, message: '请在记忆面板操作' }
    const b = await readBody(req)
    const target = parseChat(b.audience)
    if (!target || (target.platform === LEGACY_PLATFORM && !/^\d+$/.test(target.id))) return { ok: false, message: '群号或账号格式不正确' }
    const id = mind.mind.memory.shareEpisode(String(b.id || ''), { text: b.text, audience: normChat(b.audience) })
    mind.invalidateMemory()
    return { ok: true, id, message: '已保存。这段内容可以在指定会话里提起。' }
  })
  route('/mind/memory/share/revoke', async (req) => {
    if (!mind) return mindOff
    if (req.method !== 'POST') return { ok: false, message: '请在记忆面板操作' }
    const b = await readBody(req)
    const ok = mind.mind.memory.revokeShare(String(b.id || ''))
    if (ok) mind.invalidateMemory()
    return { ok, message: ok ? '已撤回分享' : '没有这个分享' }
  })
  // 「获取可用模型」：面板填好地址和 Key 后问服务有哪些模型。Key 留空 = 用已经保存的那个（面板不回显已保存的 Key）
  const SAVED_KEYS = { imageGen: () => cfg.imageGen?.apiKey, asr: () => cfg.voice?.asrApi?.apiKey, mind: () => cfg.mind?.embedKey }
  route('/provider-models', async (req) => {
    const b = await readBody(req)
    const saved = SAVED_KEYS[String(b.keyFrom || '')]
    let baseUrl = String(b.baseUrl || '').trim()
    if (!baseUrl && b.keyFrom === 'mind' && mind) baseUrl = String(mind.mind.setting('memory.embedUrl') || '')
    try {
      return await listProviderModels({ baseUrl, apiKey: String(b.apiKey || '').trim() || (saved ? String(saved() || '') : ''), kind: String(b.kind || '') })
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })
  route('/mind/settings', async () => {
    if (!mind) return mindOff
    const { GROUPS, PARAMS } = await import('./mind/params.js')
    return { ok: true, groups: GROUPS, params: PARAMS, values: mind.mind.settings(), saved: mind.mind.savedSettings() }
  })
  route('/mind/settings/save', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    try {
      const changed = mind.mind.updateSettings(b.patch || {}, 'owner')
      return { ok: true, changed, values: mind.mind.settings(), saved: mind.mind.savedSettings() }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })
  route('/mind/settings/reset', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    mind.mind.resetSetting(String(b.key || ''))
    return { ok: true, values: mind.mind.settings(), saved: mind.mind.savedSettings() }
  })
  route('/mind/sleep', async () => {
    if (!mind) return mindOff
    const report = await mind.mind.sleep()
    return { ok: true, report, message: '整理完了' }
  })
  route('/mind/now', async () => {
    if (!mind) return mindOff
    const f = mind.mind.feeling()
    const cfgNow = mind.mind.settings()
    return { ok: true, body: f.body, mood: f.mood, emotions: f.emotions.map((e) => ({ name: e.name, intensity: e.intensity, target: e.target, targetName: e.target ? (mind.mind.isOwner(e.target) ? '管理员' : mind.mind.person(e.target)?.name || shortRef(e.target)) : '', why: e.why, source: e.source, hidden: e.hidden, at: e.at })), history: mind.mind.emotion.history(30), hunger: cfgNow['body.hunger'], feedOnlyByOwner: cfgNow['body.feedOnlyByOwner'], now: mind.mind.nowText(), ownerQQ: String(getConfig().ownerQQ || '') }
  })
  route('/mind/feed', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    if (!String(b.food || '').trim()) return { ok: false, message: '填一个吃的' }
    return mind.feed(String(b.food), String(getConfig().ownerQQ || ''), '')
  })
  route('/mind/wake', async () => {
    if (!mind) return mindOff
    const ev = mind.wakeUp(String(getConfig().ownerQQ || ''))
    return ev ? { ok: true, message: `叫醒了（睡了 ${ev.hours.toFixed(1)} 小时）` } : { ok: false, message: '她没在睡' }
  })
  route('/mind/sleepnow', async () => {
    if (!mind) return mindOff
    return mind.mind.body.sleepNow() ? { ok: true, message: '让她睡了' } : { ok: false, message: '她已经在睡了' }
  })
  route('/mind/inner', async () => {
    if (!mind) return mindOff
    const m = mind.mind
    const f = m.feeling()
    return {
      ok: true,
      diary: m.inner.diary(80),
      timezone: m.identity().timezone,
      boredom: m.inner.boredom(),
      motivation: m.motivation.state(f.body),
      motives: m.motivation.motives({ body: f.body, mood: f.mood, boredom: m.inner.boredom() }),
      actThreshold: m.setting('motivation.actThreshold'),
      outreach: m._store.get('outreach', { pending: null, log: [] }),
      grants: m._store.get('grants', { requests: [], granted: {} }),
      local: { ...mind.local.status(), install: localInstaller.status() },
      usage: m.budget.spent(),
    }
  })
  route('/mind/want/close', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    return { ok: mind.mind.motivation.closeWant(String(b.id || ''), 'dropped') }
  })
  route('/mind/permission/decide', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    const r = mind.decide(Number(b.n), Boolean(b.yes), 'panel')
    return r ? { ok: true, message: r.granted ? '批准了' : '没批准' } : { ok: false, message: '这条已经处理过了' }
  })
  route('/mind/permission/revoke', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    mind.revoke(String(b.key || ''))
    return { ok: true, message: '收回了' }
  })
  // 本地小模型一键安装：全部装在 ~/Aurabot/mind，不依赖翻唱环境
  const localInstaller = createLocalInstaller({ trashDir, log: logger.child('mind'), mirror: () => getConfig().song?.pypiMirror || 'auto' })
  route('/mind/local/install', async (req) => {
    if (req?.method !== 'POST') return { ok: false, message: '请从面板发起安装。' }
    if (!mind) return mindOff
    if (!localInstaller.supported) return { ok: false, message: '一键安装需要 Apple 芯片 Mac。' }
    if (localInstaller.status().running) return { ok: false, message: '已经在装了' }
    const { python, modelDir } = mind.local.status()
    const before = mind.mind.setting('models.localPython')
    localInstaller.install({ python, model: modelDir }).then((result) => {
      if (result.ok && result.python !== python && before === mind.mind.setting('models.localPython')) {
        mind.mind.updateSettings({ 'models.localPython': '' }, 'owner')
      }
    }).catch((error) => log.warn('本地小模型安装状态更新失败：', error.message))
    return { ok: true, message: '正在检查本地环境，只会下载安装缺少的部分。' }
  })
  route('/mind/local/install/status', async () => ({
    ...localInstaller.status(),
    ...(mind ? { local: mind.local.status() } : {}),
  }))
  route('/mind/local/test', async () => {
    if (!mind) return mindOff
    const c = mind.local.check()
    if (!c.ok) return { ok: false, message: c.reason }
    const t0 = Date.now()
    const out = await mind.local.chat([{ role: 'user', content: '用一句话说说你现在在想什么。' }], { maxTokens: 60 })
    return out ? { ok: true, message: `能用（${((Date.now() - t0) / 1000).toFixed(1)} 秒）：${out.slice(0, 60)}` } : { ok: false, message: '没跑起来：' + (mind.local.status().lastError || '原因不明') }
  })
  route('/mind/act', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    const r = await mind.runAction(String(b.id || ''))
    return { ok: Boolean(r?.ok), message: r?.summary || (r?.ok ? '做完了' : '没做成') }
  })
  // ---------- 关系：每个人、每个群 ----------
  route('/mind/people', async () => {
    if (!mind) return mindOff
    const { exclusive, sexualDesire } = mind.mind.identity()
    return { ok: true, list: mind.mind.relations.list(), groups: mind.mind.relations.groups().map((g) => ({ ...g, name: hub?.groupNames?.get?.(String(g.id)) || '' })), exclusive, passionEnabled: sexualDesire }
  })
  // 忘掉一个人：delete = 连人带关于他的记忆移进恢复区；stop = 以后不记（clear 时以前的也移走）；resume = 撤销「以后不记」
  route('/mind/people/forget', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    const person = parsePerson(b.id)
    if (!person || (person.platform === LEGACY_PLATFORM && !/^\d+$/.test(person.id))) return { ok: false, message: '要忘掉谁？' }
    if (b.confirm !== true && b.mode === 'delete') return { ok: false, message: '要再确认一次' }
    const id = `${person.platform}:${person.id}`
    const r = mind.forgetPerson(id, String(b.mode || ''), { clear: b.clear === true })
    if (r.ok) log.info(`关系：${id} → ${b.mode}${b.clear ? '（清掉以前的）' : ''}`)
    return r
  })
  // 她惦记着的别人的事（还没结果的）；管理员可以让她别问了
  route('/mind/followups', async () => (mind ? { ok: true, list: mind.mind.memory.followups() } : mindOff))
  route('/mind/followups/close', async (req) => {
    if (!mind) return mindOff
    return mind.mind.memory.closeFollowup(String((await readBody(req)).id || ''), 'owner') ? { ok: true, message: '好，不问了' } : { ok: false, message: '没有这件事' }
  })
  route('/mind/people/graph', async () => (mind ? { ok: true, ...mind.mind.peopleGraph(), self: mind.mind.identity().name || '她' } : mindOff))
  route('/mind/people/forgotten', async () => (mind ? { ok: true, list: mind.mind.forgottenList() } : mindOff))
  route('/mind/people/restore', async (req) => {
    if (!mind) return mindOff
    return mind.restorePerson((await readBody(req)).id)
  })
  route('/mind/people/edit', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    if (!b.id) return { ok: false, message: '要改谁？' }
    const g = mind.mind.relations.edit(String(b.id), b.patch || {})
    return { ok: true, person: g, message: '改好了' }
  })

  // ---------- 人格与自我 ----------
  route('/mind/self', async () => {
    if (!mind) return mindOff
    const m = mind.mind
    const ver = (kind, n) => m.listVersions(kind, n).map((v) => ({ id: v.id, at: v.at, by: v.by, reason: v.reason, pinned: v.pinned, data: kind === 'persona' ? { name: v.data.name, nickname: v.data.nickname, chars: String(v.data.card || '').length, card: v.data.card } : v.data }))
    return {
      ok: true,
      identity: m.identity(),
      card: m.personaCard(),
      profile: m.self.profile(),
      ownerCall: m.self.ownerCall(),
      ownerCallOk: m.self.canChangeOwnerCall(),
      personality: m.personality.state(),
      versions: { persona: ver('persona', 30), self: ver('self', 50), traits: ver('traits', 50), habits: ver('habits', 50) },
      prompt: m.selfPrompt(),
    }
  })
  route('/mind/self/change', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    const r = await mind.changeSelf({ what: b.what, content: b.content, why: b.why || '管理员在面板里改的', trait: b.trait, dir: b.dir }, 'owner')
    return r
  })
  route('/mind/self/goal/drop', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    return { ok: mind.mind.self.dropGoal(String(b.text || '')) }
  })
  route('/mind/self/restore', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    try {
      if (b.kind === 'persona') {
        mind.mind.restorePersona(Number(b.id))
        const id = getConfig().persona.current
        const cur = readPersona(id)
        if (cur) savePersona(id, { name: cur.name, tags: cur.tags, body: mind.mind.personaCard(), nickname: cur.nickname })
        return { ok: true, message: '人格卡退回了' }
      }
      if (b.kind === 'traits') { mind.mind.personality.restore(Number(b.id)); return { ok: true, message: '性格退回了' } }
      if (b.kind === 'habits') { mind.mind.personality.restoreHabits(Number(b.id)); return { ok: true, message: '习惯退回了' } }
      if (b.kind === 'self') return mind.mind.self.restore(Number(b.id))
      return { ok: false, message: '不认识的版本' }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })
  route('/mind/version/pin', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    mind.mind.pinVersion(Number(b.id), b.pinned !== false)
    return { ok: true }
  })
  route('/mind/version/list', async (req) => {
    if (!mind) return mindOff
    const { kind, before } = query(req)
    if (!['persona', 'self', 'traits', 'habits'].includes(kind)) return { ok: false, message: '不认识的版本类别' }
    const cursor = Number(before)
    const versions = mind.mind.listVersions(kind, 51, Number.isSafeInteger(cursor) && cursor > 0 ? cursor : undefined)
    return { ok: true, items: versions.slice(0, 50).map(({ data, ...meta }) => meta), hasMore: versions.length > 50 }
  })
  route('/mind/version/compare', async (req) => {
    if (!mind) return mindOff
    const { first, second } = query(req)
    const a = mind.mind.getVersion(first)
    const b = mind.mind.getVersion(second)
    return a && b && a.kind === b.kind ? { ok: true, versions: [a, b] } : { ok: false, message: '请选择同一类别的两个版本' }
  })
  route('/mind/version/delete', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    try {
      const n = b.id ? mind.mind.deleteVersion(b.id) : mind.mind.deleteVersions(String(b.kind), {
        from: Number(b.from), through: Number(b.through),
      })
      return { ok: true, message: `清理了 ${n} 个版本` }
    } catch (error) { return { ok: false, message: error.message } }
  })
  route('/mind/traits/confirm', async (req) => {
    if (!mind) return mindOff
    const b = await readBody(req)
    mind.mind.personality.confirm(b.base || {})
    return { ok: true, message: '确认好了：这就是她本来的样子' }
  })
  route('/mind/traits/infer', async () => {
    if (!mind) return mindOff
    try {
      const r = await mind.inferTraits({ force: true })
      return r ? { ok: true, inferred: r, message: '推好了，看看像不像她，再确认' } : { ok: false, message: '没推出来（人格卡是空的，或者模型没接上）' }
    } catch (error) {
      return { ok: false, message: '没推出来：' + error.message }
    }
  })
  route('/mind/traits/alerts/read', async () => {
    if (!mind) return mindOff
    mind.mind.personality.readAlerts()
    return { ok: true }
  })

  route('/personas', async () => ({ ok: true, list: listPersonas(), current: cfg.persona.current }))
  route('/persona/get', async (req) => {
    const p = readPersona(query(req).id)
    return p ? { ok: true, persona: p } : { ok: false, message: '没有这个人格' }
  })
  route('/persona/save', async (req) => {
    const b = await readBody(req)
    const p = savePersona(b.id, b)
    if (b.id === getConfig().persona.current) mind?.syncPersona('owner', '在面板里改了人格卡')
    return { ok: true, persona: p, message: '人格已保存，下一轮起生效' }
  })
  route('/persona/delete', async (req) => {
    const b = await readBody(req)
    if (b.id === cfg.persona.current) return { ok: false, message: '正在用的人格不能删' }
    deletePersona(b.id)
    return { ok: true, list: listPersonas() }
  })
  route('/persona/use', async (req) => {
    const b = await readBody(req)
    if (!readPersona(b.id)) return { ok: false, message: '没有这个人格' }
    setConfig({ ...cfg, persona: { current: b.id } })
    mind?.syncPersona('owner', `在面板里换成人格「${b.id}」`)
    log.info(`切换人格 → ${b.id}`)
    return { ok: true, current: b.id, message: '切换好了，下一轮回复起生效' }
  })
  // 人格页「AI 润色」：只改面板上这一节的文字，不保存；用不用由管理员在面板里选
  route('/persona/polish', async (req) => {
    const b = await readBody(req)
    const title = String(b.title || '').slice(0, 30) || '开场（她是谁）'
    const text = String(b.text || '').slice(0, 4000)
    const others = (Array.isArray(b.others) ? b.others : []).map((x) => String(x).slice(0, 30)).slice(0, 20)
    const system = '你在帮人改一个 QQ 聊天角色的人设。人设按【标题】分节，你一次只改其中一节。' +
      '只输出这一节改好后的正文：不要写标题，不要加粗、不要 Markdown 标题，不要任何解释。原来是「- 」开头的条目就继续用条目，一条一行、短句。'
    const ask = [
      `角色：${String(b.name || '她').slice(0, 30)}`,
      `要改的这一节：${title}`,
      `人设里另外几节：${others.join('、') || '无'}（只是让你知道还有哪些，别把它们的内容写进这一节）`,
      text.trim()
        ? '要求：保留原来的设定和事实，不编新的身份信息；说得更具体、更像真人；删掉重复和空话；长度别超过原来的 1.5 倍。'
        : '要求：这一节还是空的，按这个角色和这一节的标题写 4 到 8 条。',
      text.trim() ? `原文：\n${text}` : '',
    ].filter(Boolean).join('\n')
    try {
      const out = String(await askModel(ctx, { cfg: getConfig(), module: 'persona', system, text: ask, maxTokens: 1500, temperature: 0.6 }) || '')
        .replace(/^```[a-z]*\n?|\n?```$/g, '').replace(new RegExp('^【' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '】\\s*'), '').trim()
      return out ? { ok: true, text: out } : { ok: false, message: '模型没给出内容，再试一次' }
    } catch (error) {
      return { ok: false, message: '润色没成功：' + error.message }
    }
  })

  // 按群头衔不理：白名单里的群（带群名）+ 这些群里现有的头衔，面板里点一个就设成要过滤的那类
  route('/groups/titles', async () => {
    const gids = (cfg.allow.groups || []).map(String)
    const groups = await Promise.all(gids.map(async (gid) => ({ groupId: gid, name: await hub.groupName(gid) })))
    if (!gids.length) return { ok: true, groups, titles: [], failed: [] }
    const { titles, failed } = await hub.titleFilter.titlesIn(gids)
    hub.titleFilter.clear()
    return { ok: true, groups, titles, failed, message: failed.length ? `有 ${failed.length} 个群的成员没拉到（她在群里吗？）` : '' }
  })

  // 面板里的调试对话：走管理员私聊的正常链路，但不发 QQ、不写进心智（来自原项目 f476866）
  route('/debug/say', async (req) => {
    const b = await readBody(req)
    try { return await hub.debugSay(String(b.text || '')) } catch (error) { return { ok: false, message: error.message } }
  })

  // 本地接口
  const openFolder = (dir) => {
    mkdirSync(dir, { recursive: true })
    const opener = 'open'
    // 子进程起不来是以 error 事件抛的，没人听就是未捕获异常，会把 DSH 整个带走（#135）
    return new Promise((resolve) => {
      const child = spawn(opener, [dir], { detached: true, stdio: 'ignore' })
      child.once('error', (error) => resolve({ ok: false, message: `打不开文件夹：${dir}（${error.message}）` }))
      child.once('spawn', () => { child.unref(); resolve({ ok: true, message: '打开了' }) })
    })
  }
  // 备份：文件里有账号凭证，只存在本机文件夹，不提供网页下载（backupJob 声明在文件顶部，云备份的定时器要提前用到）
  // 心智核心的库：本地备份、云备份（包括「仅配置」）都要带一份完整的
  const captureMind = () => (mind ? () => mind.backupFiles() : null)
  const backupAction = (run) => async (req) => {
    if (req.method !== 'POST' || req.headers?.['x-aurabot-backup'] !== '1') return { ok: false, message: '请从面板发起操作' }
    return run(req)
  }
  route('/backup/state', async () => ({ ok: true, job: backupJob, list: listBackups(), pending: pendingRestore(), modules: pendingModules(), dir: dataDir('backups') }))
  route('/backup/verify', async (req) => {
    try { return { ok: true, ...(await inspectBackup(String(query(req).name || ''))) } }
    catch (error) { return { ok: false, message: error.message } }
  })
  route('/backup/create', backupAction(async () => {
    if (backupJob?.running) return { ok: false, message: '上一个备份还在打包' }
    backupJob = { running: true, done: 0, total: 0 }
    createBackup({ version: VERSION, workspaceDir: workspaceDirOf(getConfig()), captureMind: captureMind(), onProgress: (p) => { backupJob = { ...backupJob, ...p } } })
      .then((result) => { backupJob = { running: false, result }; log.info(`备份完成：${result.name}，${result.files} 个文件`) })
      .catch((error) => { backupJob = { running: false, error: error.message }; log.error('备份失败：', error.message) })
    return { ok: true, message: '开始打包了' }
  }))
  route('/backup/open', backupAction(async () => openFolder(dataDir('backups'))))
  route('/backup/upload', backupAction(async (req) => {
    const buf = await readRaw(req, 2 * 1024 * 1024 * 1024 - 1)
    if (!buf.length) return { ok: false, message: '文件是空的' }
    try { return await stageReceivedBackup(buf) } catch (error) { return { ok: false, message: error.message } }
  }))
  route('/backup/restore-path', backupAction(async (req) => {
    const path = String((await readBody(req)).path || '').trim().replace(/^"|"$/g, '')
    if (!path) return { ok: false, message: '填备份文件的完整路径' }
    try { return await stageRestore(path) } catch (error) { return { ok: false, message: error.message } }
  }))
  route('/backup/cancel', backupAction(async () => {
    try { cancelRestore(); return { ok: true, message: '取消了' } } catch (error) { return { ok: false, message: error.message } }
  }))
  // ---------- 云备份：每天到点自动打包，并把最新备份推到 Gitee 私有仓库（走本机 git）----------
  const alive = () => { try { return !unloaded } catch { return true } }
  const nextRemoteAt = () => pushDueAt === null ? null : new Date(pushDueAt).toISOString()
  const remoteView = (r = cfg.backup?.remote || {}) => ({
    enabled: !!r.enabled,
    provider: r.provider === 'webdav' ? 'webdav' : 'gitee',
    owner: r.owner,
    repo: r.repo,
    branch: r.branch,
    time: r.time,
    keep: r.keep,
    autoCreate: r.autoCreate !== false,
    forceOverwrite: !!r.forceOverwrite,
    hasToken: Boolean(r.token),
    webdav: { url: r.webdav?.url || '', username: r.webdav?.username || '', hasPassword: Boolean(r.webdav?.password), configOnly: r.webdav?.configOnly === true },
  })
  route('/backup/remote/state', async () => ({ ok: true, remote: remoteView(), job: pushJob, nextAt: nextRemoteAt() }))
  route('/backup/remote/config', backupAction(async (req) => {
    const patch = { ...(await readBody(req)) }
    if (!patch.token) delete patch.token // 令牌留空 = 沿用旧值，别把配好的抹掉
    if (patch.webdav && !patch.webdav.password) delete patch.webdav.password // WebDAV 密码同理
    setConfig(mergeFromPanel(cfg, { backup: { remote: patch } })) // setConfig 里会重排定时器
    const r = cfg.backup.remote
    const where = r.provider === 'webdav' ? (r.webdav?.url || 'WebDAV') : `${r.owner}/${r.repo}`
    log.info(`云备份设置已更新｜${r.enabled ? `每天 ${r.time} 推 ${where}，留 ${r.keep} 份` : '关'}`)
    return { ok: true, message: '存好了', remote: remoteView() }
  }))
  const doPush = async (pack) => {
    if (pushJob?.running) return { ok: false, message: '上一次推送还没跑完' }
    if (backupJob?.running) return { ok: false, message: '正在打包，等这轮打包完再推' }
    pushJob = { running: true, pack: !!pack, at: Date.now() }
    try {
      const remote = getConfig().backup?.remote || {}
      const configOnly = remote.provider === 'webdav' && remote.webdav?.configOnly === true
      let sourceName = ''
      if (pack || configOnly) {
        const result = await createBackup({ version: VERSION, workspaceDir: workspaceDirOf(getConfig()), captureMind: captureMind(), configOnly })
        sourceName = result.name
        log.info(`${configOnly ? '仅配置' : ''}云备份打包完成：${result.name}，${result.files} 个文件`)
      }
      const r = await pushBackup(remote, { version: VERSION, sourceName })
      pushJob = { running: false, ok: true, result: r, at: Date.now() }
      log.info(`云备份推送完成：${r.message}`)
    } catch (error) {
      pushJob = { running: false, ok: false, error: error.message, at: Date.now() }
      log.error('云备份推送失败：', error.message)
    } finally {
      scheduleRemoteBackup() // 打包+推送耗时不定，跑完重排到下一天
    }
    return pushJob.ok ? { ok: true, message: pushJob.result.message || '备份已推送' }
      : { ok: false, message: '推送失败：' + pushJob.error }
  }
  route('/backup/push', backupAction(async () => doPush(false)))
  route('/backup/remote/list', backupAction(async () => {
    const r = getConfig().backup?.remote || {}
    if (r.provider !== 'webdav') return { ok: false, message: '先把云备份方式切到 WebDAV' }
    try { return await listWebdavBackups(r) } catch (error) { return { ok: false, message: error.message } }
  }))
  route('/backup/remote/restore', backupAction(async (req) => {
    const r = getConfig().backup?.remote || {}
    if (r.provider !== 'webdav') return { ok: false, message: '先把云备份方式切到 WebDAV' }
    const name = String((await readBody(req)).name || '')
    if (!/^aurabot-(?:backup|config)-\d{8}-\d{4,6}(?:-\d{1,3})?(?:-[a-z0-9]{6,})?\.zip$/u.test(name)) return { ok: false, message: '备份文件名不对' }
    try {
      const got = await downloadWebdavBackup(r, name)
      const result = await stageReceivedBackup(got.buffer, name)
      log.info(`已从 WebDAV 拉回备份：${name}（${got.buffer.length} 字节）`)
      return result
    } catch (error) {
      return { ok: false, message: error.message }
    }
  }))
  const scheduleRemoteBackup = (retryMs = 0) => {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
    pushDueAt = null
    const r = cfg.backup?.remote
    if (!r?.enabled || !alive()) return
    const now = Date.now()
    const next = new Date(now)
    if (retryMs) next.setTime(now + retryMs)
    else {
      const [hh, mm] = String(r.time || '03:30').split(':').map(Number)
      next.setHours(hh, mm, 0, 0)
      if (next.getTime() <= now) next.setDate(next.getDate() + 1)
    }
    pushDueAt = next.getTime()
    pushTimer = setTimeout(() => {
      pushTimer = null
      pushDueAt = null
      if (!alive()) return
      if (backupJob?.running || pushJob?.running) scheduleRemoteBackup(60_000)
      else void doPush(true)
    }, pushDueAt - now)
    pushTimer.unref?.()
  }
  // 上报开关：按工作区分别控制「授权」「提问」要不要在 QQ 里说
  route('/notice/state', async () => {
    const n = getConfig().notice || {}
    const workspaces = workspaceList().map((w) => {
      const path = String(w?.path || '')
      const o = n.workspaces?.[normalizeWorkspace(path)] || {}
      return {
        path,
        name: String(w?.name || path.split(/[\\/]/).filter(Boolean).pop() || path),
        sessions: Array.isArray(w?.sessionIds) ? w.sessionIds.length : 0,
        approval: typeof o.approval === 'boolean' ? o.approval : n.approval !== false,
        question: typeof o.question === 'boolean' ? o.question : n.question !== false,
      }
    })
    return { ok: true, enabled: n.enabled !== false, approval: n.approval !== false, question: n.question !== false, workspaces }
  })
  route('/notice/toggle', async (req) => {
    const b = await readBody(req)
    const kind = b.kind === 'question' ? 'question' : 'approval'
    const value = b.value !== false
    const notice = structuredClone(getConfig().notice || {})
    notice.workspaces = notice.workspaces || {}
    const ws = String(b.workspace || '').trim()
    if (ws) {
      // 只接受绝对路径：相对路径写进配置只会变成永远对不上的键
      if (!ws.startsWith('/')) return { ok: false, message: '工作区要填完整路径' }
      const key = normalizeWorkspace(ws)
      notice.workspaces[key] = { ...(notice.workspaces[key] || {}), [kind]: value }
    } else {
      notice[kind] = value
    }
    setConfig({ ...getConfig(), notice })
    return { ok: true, notice: getConfig().notice }
  })
  route('/chat/secretary', async (req) => { const chatId = String(query(req).chatId || ''); return { ok: true, list: hub?.secretaryLog?.(chatId) || [], stats: hub?.secretaryStats?.(chatId) || {} } })
  route('/chat/secretary/export', async () => ({ ok: true, stats: hub?.secretaryStats?.() || {} }))
  route('/local/status', async () => ({ ok: true, dir: local.dir(), list: local.status() }))
  route('/local/template', async (req) => {
    const slot = String((await readBody(req)).slot || '')
    if (!local.pathOf || !['tts', 'image', 'song', 'asr', 'video'].includes(slot)) return { ok: false, message: '没有这一项' }
    return local.template(slot)
  })
  route('/local/trust', async (req) => {
    const slot = String((await readBody(req)).slot || '')
    const r = local.trust?.(slot)
    if (!r?.ok) return r || { ok: false, message: '没有这一项' }
    const cur = getConfig()
    setConfig({ ...cur, local: { ...cur.local, hashes: { ...(cur.local?.hashes || {}), [slot]: r.hash } } })
    return { ok: true, message: '脚本已确认；以后改了脚本要重新确认', hash: r.hash }
  })
  route('/local/open', async () => openFolder(local.dir()))
  route('/local/test', async (req) => {
    const slot = String((await readBody(req)).slot || '')
    try {
      if (slot === 'tts') {
        const file = await local.call('tts', { text: '你好呀，我是大肥鱼，这是本地语音测试。' }, { readResult: localAudioFile })
        return { ok: true, message: `念好了：${file}` }
      }
      if (slot === 'image') {
        const buf = await local.call('image', { prompt: '一条胖乎乎的蓝色小鱼，可爱，插画', size: cfg.imageGen.size || '1024x1024' }, { readResult: localImageBuffer })
        return { ok: true, message: `画好了（${Math.round(buf.length / 1024)} KB）`, image: buf.toString('base64') }
      }
      return { ok: false, message: '这一项没法单独试：翻唱换声去 QQ 里点首歌，语音识别发条语音条试试' }
    } catch (error) {
      return { ok: false, message: '出错了：' + error.message }
    }
  })

  // 模块（面板「扩展」页）
  route('/modules', async () => ({ ok: true, dir: mods.dir(), safeMode: cfg.safeMode, apiVersion: API_VERSION, list: mods.status(), prompt: mods.promptFor('') }))
  route('/modules/community', async (req) => {
    try { return { ok: true, ...(await community.list({ force: query(req).force === '1' })) } } catch (error) { return { ok: false, message: error.message, list: [] } }
  })
  route('/modules/tutorial', async () => {
    try { return { ok: true, text: readFileSync(join(ROOT, 'docs', 'MODULE-TUTORIAL.md'), 'utf8') } } catch (error) { return { ok: false, message: '教程文件不见了' } }
  })
  route('/modules/community/progress', async () => ({ ok: true, progress: community.progress() }))
  route('/modules/community/install', async (req) => {
    const b = await readBody(req)
    return { ...(await community.install(String(b.id || ''), {
      confirmReplace: b.confirmReplace === true, registry: String(b.registry || ''), version: String(b.version || ''),
    })), modules: mods.status() }
  })
  route('/modules/community/remove', async (req) => {
    const b = await readBody(req)
    return { ...(await community.remove(String(b.id || ''), { purge: b.purge === true })), modules: mods.status() }
  })
  route('/modules/reload', async (req) => {
    const id = String((await readBody(req)).id || '')
    if (!id) { await mods.sync(); return { ok: true, message: '检查过了', list: mods.status() } }
    const m = await mods.reload(id)
    return { ok: Boolean(m && !m.error), message: m?.error ? '加载失败：' + m.error : '重新加载好了', list: mods.status() }
  })
  route('/modules/create', async (req) => {
    const b = await readBody(req)
    const r = mods.create(String(b.id || '').trim(), String(b.name || '').trim())
    if (r.ok) await mods.sync()
    return { ...r, list: mods.status(), prompt: r.ok ? mods.promptFor(String(b.id).trim()) : '' }
  })
  route('/modules/fork', async (req) => {
    const id = String((await readBody(req)).id || '')
    const r = mods.fork(id)
    if (r.ok) await mods.sync()
    return { ...r, list: mods.status(), prompt: r.ok ? mods.promptFor(id) : '' }
  })
  route('/modules/prompt', async (req) => ({ ok: true, prompt: mods.promptFor(String(query(req).id || '')) }))
  route('/modules/open', async (req) => {
    const id = String(query(req).id || '')
    const base = mods.dir()
    if (!id) return openFolder(base)
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) return { ok: false, message: '模块 id 不合法' }
    const dir = join(base, id)
    const rel = relative(base, dir)
    if (rel.startsWith('..') || rel.includes('/')) return { ok: false, message: '模块路径不合法' }
    return openFolder(dir)
  })
  // 模拟测试：不用上 QQ 就能试模块。发出去的消息只截下来给面板看，不真发
  // （模块直接调 api.onebot(...) 的操作不在此列，是真的会执行的）
  const simChat = (b) => {
    const owner = b.as !== 'other'
    const userId = owner ? cfg.ownerQQ : '10001'
    const group = b.kind === 'group'
    const groupId = String(b.groupId || cfg.allow.groups[0] || '10002')
    return { owner, userId, chat: group ? { chatId: `group:${groupId}`, kind: 'group', groupId, userId } : { chatId: `private:${userId}`, kind: 'private', userId } }
  }
  // 没有文字的（语音条、表情、图片）显示发送备注，比如「[语音·edge] 早呀」
  const sentLines = (sent) => sent.map((s) => ({ chatId: s.chatId, note: s.note, text: s.message.some((seg) => seg.type === 'text') ? s.message.map((seg) => (seg.type === 'text' ? seg.data.text : seg.type === 'reply' ? '' : `[${seg.type}]`)).join('') : s.note }))
  route('/modules/simulate', async (req) => {
    const b = await readBody(req)
    const { owner, userId, chat } = simChat(b)
    const text = String(b.text || '')
    const steps = []
    const msg = { ...chat, nickname: owner ? cfg.ownerName || '管理员' : '路人', role: '', messageId: 'sim', text, mentioned: Boolean(b.mentioned), replyId: '', images: [], stickers: [], records: [], forwards: [], raw: { simulated: true } }
    const { sent } = await hub.capture(async () => {
      if (text) {
        const cmd = owner && /^\s*[/／]/.test(text) ? parseCommand(text, mods.commands()) : null
        if (cmd && cmd.ext) {
          const reply = String((await cmd.ext.run(cmd.arg, msg)) ?? '')
          steps.push(`命令 /${cmd.name}（模块「${cmd.ext.module}」）回：${reply || '（空）'}`)
          if (reply) await hub.sendText(chat.chatId, reply)
        } else if (cmd) {
          steps.push(`这是内置命令 /${cmd.name}，模拟里不执行（会真的改设置）`)
        } else if (await mods.claim('message', msg)) {
          steps.push('有模块接管了这条消息，她不会再回')
        } else {
          steps.push('没有模块接管，这条会交给她（模拟里不会真的让她想）')
        }
      }
      if (b.reply) {
        const items = await hub.deliver(chat.chatId, String(b.reply), { simulate: true })
        steps.push(items ? `她的回复经过模块改写后拆成 ${items.length} 条` : '她的回复被模块拦下了，不发')
      }
    })
    return { ok: true, steps, sent: sentLines(sent) }
  })
  route('/modules/tools', async (req) => {
    const q = query(req)
    const { owner, chat } = simChat(q)
    const level = owner && chat.kind === 'private' ? 'full' : 'social'
    return { ok: true, level, list: mods.buildTools({ chat, level, sessionId: 'sim' }).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }
  })
  route('/modules/tool', async (req) => {
    const b = await readBody(req)
    const { owner, userId, chat } = simChat(b)
    const level = owner && chat.kind === 'private' ? 'full' : 'social'
    const tool = mods.buildTools({ chat, level, sessionId: 'sim' }).find((t) => t.name === b.name)
    if (!tool) return { ok: false, message: `这个场合没有 ${b.name} 这个工具` }
    hub.simulateTurn('sim', [userId])
    const { result, sent } = await hub.capture(() => tool.execute(b.args && typeof b.args === 'object' ? b.args : {}, {}))
    return { ok: true, result, sent: sentLines(sent) }
  })
  route('/modules/panel', async (req, res) => {
    const src = mods.panelSource(String(query(req).id || ''))
    if (src === null) return send(res, 404, '')
    send(res, 200, src, 'text/javascript; charset=utf-8')
  })

  // 贴表情：面板要展示「当前有哪些表情可以贴」——内置常用 + 网关系统表情目录（取不到就只用内置）
  // emoji 走 Unicode 码点，QQ 老表情走它自己那套编号，两套在 set_msg_emoji_like 里都能直接用。
  const REACT_EMOJIS = [
    { char: '👍', name: '赞', id: '128077' },
    { char: '❤️', name: '爱心', id: '10084' },
    { char: '😂', name: '笑哭', id: '128514' },
    { char: '😭', name: '大哭', id: '128557' },
    { char: '🤔', name: '思考', id: '129300' },
    { char: '😅', name: '冷汗', id: '128517' },
    { char: '😳', name: '脸红', id: '128563' },
    { char: '🥺', name: '委屈', id: '129402' },
    { char: '🎉', name: '庆祝', id: '127881' },
    { char: '🌹', name: '玫瑰', id: '127801' },
    { char: '🍬', name: '糖', id: '127852' },
    { char: '✨', name: '闪', id: '10024' },
    { char: '🔥', name: '火', id: '128293' },
    { char: '🙏', name: '拜托', id: '128591' },
  ]
  route('/panel/faces', async () => {
    const qqChannel = channels.get('qq')
    const faces = qqChannel?.faceCatalog ? await qqChannel.faceCatalog() : []
    return { ok: true, faces, emojis: REACT_EMOJIS }
  })

  // 联动
  route('/bridge/token', async () => ({ ok: true, token: cfg.bridge.http ? bridge.ensureToken() : '' }))
  route('/bridge/token/reset', async (req) => req?.method === 'POST' ? { ok: true, token: bridge.resetToken(), message: '换了新密钥，旧的立刻失效' } : { ok: false, message: '换密钥要用 POST' })
  route('/bridge/examples', async (req) => ({ ok: true, ...bridge.examples(String(query(req).base || 'http://127.0.0.1:端口')) }))
  // 开放接口：都要带密钥。/open/* 给外部程序（curl/脚本）用，跨机 + 自定义 Host 是正常用法，
  // 且有自己的 Bearer 鉴权——跳过管理面的 Host 允许名单（复审 2·P1-2 的豁免原则同理）。
  const open = (path, fn) => route('/open' + path, async (req) => {
    if (!bridge.authorized(req)) return { ok: false, code: 401, message: cfg.bridge.http ? '密钥不对（请求头 Authorization: Bearer 密钥）' : '开放接口没打开（面板「扩展」→ 联动）' }
    return fn(req)
  }, { skipHostCheck: true })
  open('/info', async () => bridge.ops.info())
  open('/send', async (req) => bridge.ops.send(await readBody(req)))
  open('/think', async (req) => bridge.ops.think(await readBody(req)))
  open('/call', async (req) => bridge.ops.call(await readBody(req)))
  open('/events', async (req) => bridge.ops.events(query(req)))

  // 模型：列出 DSH 里可用的模型，测一下哪个回得快
  route('/models', async (req) => {
    try {
      if (new URL(req.url, 'http://x').searchParams.get('refresh') === '1') { clearReasoningCache(); clearVisionCache() }
      return { ok: true, list: await listModels() }
    } catch (error) {
      return { ok: false, message: error.message, list: [] }
    }
  })
  route('/model/ping', async (req) => {
    const b = await readBody(req)
    const t = Date.now()
    try {
      const text = await askModel(ctx, { cfg: { model: { provider: b.provider, model: b.model } }, module: 'model-ping', system: '只回复两个字：在呢', text: '在吗', maxTokens: 800 })
      return { ok: true, ms: Date.now() - t, text: text.slice(0, 40) }
    } catch (error) {
      return { ok: false, ms: Date.now() - t, message: error.message }
    }
  })

  // 形象图
  // 头像：自定义的放在数据目录（重装插件不丢），没有就用插件自带的大肥鱼
  const AVATAR = () => dataDir('avatar.img')
  const avatarInfo = () => {
    try { return { custom: true, at: statSync(AVATAR()).mtimeMs } } catch (error) { return { custom: false, at: 0 } }
  }
  route('/avatar', async (req, res) => {
    if (existsSync(AVATAR())) {
      const buf = readFileSync(AVATAR())
      return send(res, 200, buf, mimeOf(buf))
    }
    const p = join(ROOT, 'assets', 'dafeiyu.jpg')
    if (!existsSync(p)) return send(res, 404, '')
    send(res, 200, readFileSync(p), 'image/jpeg')
  })
  route('/panel/sea', (req, res) => {
    const file = join(ROOT, 'assets', 'panel-sea.jpg')
    if (!existsSync(file)) return send(res, 404, '')
    send(res, 200, readFileSync(file), 'image/jpeg')
  })
  route('/avatar/upload', async (req) => {
    const b = await readBody(req, 8 * 1024 * 1024)
    const buf = Buffer.from(String(b.data || '').replace(/^data:[^,]+,/, ''), 'base64')
    if (!buf.length || buf.length > 5 * 1024 * 1024) return { ok: false, message: '图片太大（最多 5MB）或是空的' }
    if (!mimeOf(buf).startsWith('image/')) return { ok: false, message: '只支持 PNG、JPG、GIF、WebP 图片' }
    ensureDir(dataDir())
    writeFileSync(AVATAR(), buf)
    log.info('换了面板头像')
    return { ok: true, message: '头像换好了', avatar: avatarInfo() }
  })
  route('/avatar/reset', async () => {
    try { unlinkSync(AVATAR()) } catch (error) {}
    return { ok: true, message: '恢复成默认头像了', avatar: avatarInfo() }
  })
  route('/avatar/sync-qq', async () => {
    const buf = existsSync(AVATAR()) ? readFileSync(AVATAR()) : readFileSync(join(ROOT, 'assets', 'dafeiyu.jpg'))
    try {
      await onebot.call('set_qq_avatar', { file: 'base64://' + buf.toString('base64') })
      return { ok: true, message: '已经设成机器人号的 QQ 头像' }
    } catch (error) {
      return { ok: false, message: 'QQ 头像没换成：' + error.message }
    }
  })

  scheduleRemoteBackup() // 云备份：到点自动打包推送（配置里关着就是空操作）
  log.info(`Aurabot v${VERSION} 已加载｜总开关 ${cfg.enabled ? '开' : '关'}｜试运行 ${cfg.dryRun ? '开' : '关'}｜工作区 ${workspaceDirOf(cfg)}`)

  return {
    hub, onebot, getConfig, setConfig, logger, modules: mods, bridge, ready: booted,
    get stickers() { return use('stickers') },
    get qzone() { return use('diary') },
    get mind() { return mind },
  }
}
