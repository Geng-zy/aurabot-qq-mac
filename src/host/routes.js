// 面板路由的唯一注册点：host.js 只把依赖递进来，不关心具体有哪些页面。
// 拆出来的目的：host.js 是组合根，路由表属于「对外接口面」，两者分开才不会越滚越大。
// 契约：所有路径都在 /aurabot/api 前缀下、返回字段不变（docs/REFACTOR-PLAN.md §1.1 第 4 条）。
// 守护：test/host-routes.test.js 用 test/fixtures/host-routes.json 锁住整张路由表。

import { mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'

import { registerPanelCoreRoutes } from '../features/panel-core-routes.js'
import { registerKnowledgeRoutes } from '../features/knowledge-routes.js'
import { registerPanelMiscRoutes } from '../features/panel-misc-routes.js'
import { registerPlatformRoutes } from '../features/platform-routes.js'
import { registerSessionRoutes } from '../features/session-routes.js'
import { registerMindMemoryRoutes } from '../features/mind-memory-routes.js'
import { registerModelRoutes } from '../features/model-routes.js'
import { registerMindSettingsRoutes } from '../features/mind-settings-routes.js'
import { registerMindLiveRoutes } from '../features/mind-live-routes.js'
import { registerMindPeopleRoutes } from '../features/mind-people-routes.js'
import { registerMindSelfRoutes } from '../features/mind-self-routes.js'
import { registerPersonaRoutes } from '../features/persona-routes.js'
import { registerDebugRoutes } from '../features/debug-routes.js'
import { registerBackupRestoreRoutes } from '../features/backup-routes.js'
import { registerBackupCloudRoutes } from '../features/backup-cloud-routes.js'
import { registerNoticeRoutes } from '../features/notice-routes.js'
import { registerHostRoutes } from '../features/host-routes.js'
import { registerLocalRoutes } from '../features/local-routes.js'
import { registerModuleRoutes } from '../features/module-routes.js'
import { registerFacesRoutes } from '../features/faces-routes.js'
import { registerBridgeRoutes } from '../features/bridge-routes.js'
import { registerAvatarRoutes } from '../features/avatar-routes.js'
import { createLocalInstaller } from '../mind-adapter/install.js'

/**
 * @param {object} d
 * @param {(path: string, handler: Function, opts?: object) => any} d.route 单条路由注册（带 effect）
 * @param {object} d.http createHttpKit 的产物：{ send, readBody, readRaw, query }
 * @param {() => object} d.getConfig
 * @param {(next: object) => object} d.setConfig
 * @param {() => object|null} d.getMind 心智核心实例（可能还没起来）
 * @param {object} d.hub 聊天中枢
 * @param {object} d.ctx DSH 上下文（模型路由要用）
 * @param {object} d.onebot QQ 网关
 * @param {object} d.qq QQ 平台对象
 * @param {object} d.channels 渠道管理器
 * @param {object} d.mods 模块内核
 * @param {object} d.bridge 宿主联动
 * @param {object} d.local 本地接口
 * @param {object} d.knowledge 知识库
 * @param {object} d.log / d.logger 日志
 */
export function registerAllRoutes(d) {
  const {
    route, http, getConfig, setConfig, getMind, hub, ctx, onebot, qq, channels, mods, bridge, local, knowledge,
    log, logger,
  } = d
  const { send, readBody, readRaw, query } = http

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

  // 备份：文件里有账号凭证，只存在本机文件夹，不提供网页下载
  // 心智核心的库：本地备份、云备份（包括「仅配置」）都要带一份完整的
  const captureMind = () => {
    const mind = getMind()
    return mind ? () => mind.backupFiles() : null
  }
  const backupAction = (run) => async (req) => {
    if (req.method !== 'POST' || req.headers?.['x-aurabot-backup'] !== '1') return { ok: false, message: '请从面板发起操作' }
    return run(req)
  }

  const localInstaller = createLocalInstaller({
    trashDir: d.trashDir,
    log: logger.child('mind'),
    mirror: () => getConfig().song?.pypiMirror || 'auto',
  })

  // ---------- 概览与设置 ----------
  registerPanelCoreRoutes({
    route, readBody, query, getConfig, setConfig, overview: d.overview, usageReport: d.usageReport,
    applyPanelSave: d.applyPanelSave, mergeFromPanel: d.mergeFromPanel,
    clearReasoningCache: d.clearReasoningCache, clearVisionCache: d.clearVisionCache,
    startWatchdog: d.startWatchdog,
    qq, log, mods, hub,
  })

  registerKnowledgeRoutes({ route, readBody, query, knowledge })
  registerPanelMiscRoutes({
    route, readBody, query, logger, mods, commandList: d.commandList, root: d.root, version: d.version,
    changelogSection: d.changelogSection, getConfig, qq, onebot, moveWorkspace: d.moveWorkspace,
    workspaceDirOf: d.workspaceDirOf, log,
  })
  registerPlatformRoutes({ route, channels, qq, onebot, getConfig })
  registerSessionRoutes({ route, getConfig, backgroundText: d.backgroundText, hub })

  // ---------- 心智核心（面板「心情与记忆」「人物」「心智设置」） ----------
  registerMindMemoryRoutes({ route, readBody, query, getMind })
  registerModelRoutes({
    route, readBody, getConfig, getMind, listProviderModels: d.listProviderModels, listModels: d.listModels,
    clearReasoningCache: d.clearReasoningCache, clearVisionCache: d.clearVisionCache, askModel: d.askModel, ctx,
  })
  registerMindSettingsRoutes({
    route, readBody, getMind, getConfig,
    clearEmbedKey: () => setConfig({ ...getConfig(), mind: { ...getConfig().mind, embedKey: '' } }),
  })
  registerMindLiveRoutes({ route, readBody, getMind, getConfig, shortRef: d.shortRef, localInstaller })
  registerMindPeopleRoutes({
    route, readBody, getMind, getConfig, parsePerson: d.parsePerson, legacyPlatform: d.legacyPlatform,
    hub, log, localInstaller,
  })

  // ---------- 人格与自我 ----------
  registerMindSelfRoutes({ route, readBody, query, getMind, getConfig, readPersona: d.readPersona, savePersona: d.savePersona })
  registerPersonaRoutes({
    route, readBody, query, getConfig, setConfig,
    listPersonas: d.listPersonas, readPersona: d.readPersona, savePersona: d.savePersona,
    deletePersona: d.deletePersona, getMind, askModel: d.askModel, ctx, log,
  })

  registerDebugRoutes({ route, readBody, getConfig, hub })

  registerBackupRestoreRoutes({
    route, backupAction, readBody, readRaw, query, dataDir: d.dataDir, openFolder, log,
    getConfig, version: d.version, workspaceDirOf: d.workspaceDirOf, captureMind,
    getJob: d.getBackupJob, setJob: d.setBackupJob,
    listBackups: d.listBackups, pendingRestore: d.pendingRestore, pendingSessions: d.pendingSessions,
    pendingModules: d.pendingModules, inspectBackup: d.inspectBackup, createBackup: d.createBackup,
    stageReceivedBackup: d.stageReceivedBackup, stageRestore: d.stageRestore,
    cancelRestore: d.cancelRestore, retryPendingSessions: d.retryPendingSessions,
    cancelPendingSessions: d.cancelPendingSessions,
  })

  // ---------- 云备份（定时器本体在 host.js，路由只读状态、触发一次） ----------
  registerBackupCloudRoutes({
    route, backupAction, readBody, getConfig, setConfig, mergeFromPanel: d.mergeFromPanel, log,
    getPushJob: d.getPushJob, nextAt: d.nextPushAt, doPush: d.doPush,
    listWebdavBackups: d.listWebdavBackups, downloadWebdavBackup: d.downloadWebdavBackup,
    stageReceivedBackup: d.stageReceivedBackup,
  })

  registerHostRoutes({ route, ctx })
  registerNoticeRoutes({
    route, readBody, query, getConfig, setConfig, workspaceList: d.workspaceList,
    normalizeWorkspace: d.normalizeWorkspace, hub,
  })

  registerLocalRoutes({
    route, readBody, getConfig, setConfig, local, openFolder,
    localAudioFile: d.localAudioFile, localImageBuffer: d.localImageBuffer,
  })

  // ---------- 模块（面板「扩展」页） ----------
  registerModuleRoutes({
    route, readBody, query, getConfig, mods, community: d.community, hub, parseCommand: d.parseCommand,
    send, openFolder, root: d.root, apiVersion: d.apiVersion,
  })

  registerFacesRoutes({ route, channels })
  registerBridgeRoutes({ route, readBody, query, getConfig, bridge })

  // ---------- 形象图 ----------
  registerAvatarRoutes({
    route, readBody, send, avatarFile: d.avatarFile, avatarInfo: d.avatarInfo, dataDir: d.dataDir, root: d.root,
    mimeOf: d.mimeOf, log, onebot, ensureDir: d.ensureDir,
  })
}
