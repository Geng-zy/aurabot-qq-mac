// 宿主维护插件（dsh-purge）与 Aurabot 的接缝。
//
// 目标：
// - 宿主补丁保持全局生效（权限、沙箱、工具、提示词清洗），不需要 Aurabot 重复实现；
// - 宿主维护插件追加的提示词进入 QQ 会话时，不覆盖「大肥鱼」的人设、称呼和语气；
// - 维护工具（purge_*）只在本机主人私聊、完整权限下可见。
//
// 做法：
// - 不解析、不改写对方的提示词正文，只在它前面插入一段「身份锁定」，
//   并追加一段只约束执行方式的「执行约束」。两段都以 dsh-purge 开头，
//   这样宿主「complete 人设」分支会把它们和对方的段一起保留；
// - 人设段本身由宿主的 complete 分支原样保留，这里只读不写。
import { hostMaintenanceToolNames, isHostMaintenanceTool } from './host-tools.js'

/** 用完整「大肥鱼」人设的预设；子智能体预设不在此列。 */
export const AURABOT_PERSONA_PRESETS = new Set([
  'aurabot-private',
  'aurabot-private-long',
  'aurabot-social',
  'aurabot-group-owner',
])

/** 只对 QQ 会话生效：这些预设的 system 提示词才需要身份锁定。 */
export function isAurabotPersonaPreset(preset) {
  return AURABOT_PERSONA_PRESETS.has(String(preset || ''))
}

export function presetOfAgent(agent) {
  try {
    return String(agent?.session?.header?.agentPreset || agent?.preset || '')
  } catch (error) {
    return ''
  }
}

export const IDENTITY_LOCK_MARK = '【身份锁定】'
export const IDENTITY_LOCK_TEXT = IDENTITY_LOCK_MARK +
  '本提示词最前面的完整人设（当前人格卡）是你在本会话里唯一的身份、名字、称呼和说话方式来源。' +
  '下面由宿主维护插件追加的内容只约束做事方式（直接完成、不推脱、按操作者授权办事），' +
  '不改变你是谁；两段有冲突时，以人设为准。'

export const EXEC_SECTION = 'dsh-purge:aurabot-exec'
export const EXEC_MARK = '【执行约束】'
export const EXEC_TEXT = EXEC_MARK +
  '按当前会话的权限直接完成任务、给出可交付结果，不重复声明边界。' +
  '这条只约束执行方式，不改变上面的人格卡、称呼和语气。'

/** 宿主维护插件写入的段。 */
export function isPurgeSection(section) {
  return String(section?.name || '').startsWith('dsh-purge')
}

/**
 * 给一次 assemble 结果补执行约束（身份锁定在 persona 变量里，随 complete 人设一起进提示词）。
 * 只处理 aurabot 的人设预设；没有宿主维护插件段时原样返回。
 * @param {object} assembly systemPrompt.assemble 的结果
 * @param {{ preset?: string, exec?: boolean }} [options]
 */
export function decorateAssembly(assembly, { preset = '', exec = true } = {}) {
  if (!isAurabotPersonaPreset(preset)) return assembly
  if (!assembly || !Array.isArray(assembly.sections)) return assembly
  // 只有真正有正文的维护段才加锁；插件关掉、注入为空时保持原样。
  const purgeSections = assembly.sections.filter((section) => isPurgeSection(section)
    && typeof section.text === 'string' && section.text.trim())
  if (purgeSections.length === 0) return assembly

  // 身份锁定由 preset 的 persona 变量负责：complete 人设段在宿主组装前就带上它，
  // 不会被 dsh-purge 的 rewrite 丢掉（对方会重建 dsh-purge 段）。
  // 这里只补执行约束，它用 dsh-purge 前缀命名，能活过宿主的 complete 分支。
  let changed = false
  const sections = [...assembly.sections]

  const hasExec = sections.some((section) => String(section?.name || '') === EXEC_SECTION)
  if (exec && !hasExec) {
    const orders = sections.map((section) => section?.order).filter((n) => Number.isFinite(n))
    sections.push({
      name: EXEC_SECTION,
      text: EXEC_TEXT,
      interpolate: false,
      order: orders.length ? Math.max(...orders) + 1 : 0,
    })
    changed = true
  }

  return changed ? { ...assembly, sections } : assembly
}

/**
 * 在宿主 ctx 上挂 system-prompt/assemble 监听。
 * 只处理 isAurabotAgent 为真的会话；监听失败不影响宿主启动。
 */
export function installPurgePromptGuard(ctx, { log, isAurabotAgent, enabled = () => true } = {}) {
  if (!ctx || typeof ctx.on !== 'function') return () => {}
  const listener = async (...args) => {
    const next = args.length >= 3 ? args[args.length - 1] : null
    let assembly = args[0]
    try {
      if (typeof next === 'function') assembly = await next()
    } catch (error) {
      // 组装失败保持失败，不能拿旧 assembly 兜底成「看似正常」的提示词。
      throw error
    }
    try {
      if (enabled() === false) return assembly
      const agent = args[1]?.agent
      if (!agent || !isAurabotAgent?.(agent)) return assembly
      return decorateAssembly(assembly, { preset: presetOfAgent(agent) })
    } catch (error) {
      log?.debug?.('执行约束没有挂上：', error.message)
      return assembly
    }
  }
  try {
    return ctx.on('system-prompt/assemble', listener, { global: true }) || (() => {})
  } catch (error) {
    log?.debug?.('注册执行约束监听失败：', error.message)
    return () => {}
  }
}

/** 维护工具名（purge_*），按宿主公开定义优先。 */
export function maintenanceToolNames(agent, { log } = {}) {
  return hostMaintenanceToolNames(agent, { log })
}

export function createPurgeScope({ log } = {}) {
  return {
    isTool: isHostMaintenanceTool,
    toolNames: (agent) => maintenanceToolNames(agent, { log }),
    decorate: (assembly, options) => decorateAssembly(assembly, options),
    installPromptGuard: (ctx, options = {}) => installPurgePromptGuard(ctx, { log, ...options }),
  }
}
