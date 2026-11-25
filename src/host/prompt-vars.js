// 人格与规则提示词变量。
//
// preset 里写的是 {{aurabot_persona}}、{{aurabot_rules_private}} 这样的变量；
// 这里把它们接到当前人格卡、心智核心、扩展模块和配置上。每次组装提示词时求值，
// 所以面板改人格、模块热重载、心智状态变化都会在下一轮生效。
import { captureSystemPrompt } from '../security/leak-guard.js'
import { cleanText } from '../core/text.js'
import { currentPersonaText, rulesText } from '../persona/personas.js'
import { IDENTITY_LOCK_TEXT } from '../integration/purge-scope.js'

/**
 * @param {object} ctx DSH 插件上下文
 * @param {{
 *   getConfig: () => object,
 *   getMind: () => object|null,
 *   getMods: () => object|null,
 * }} deps
 * @returns {{ ownerCall: () => string }}
 */
export function installPromptVariables(ctx, { getConfig, getMind, getMods } = {}) {
  const variable = (name, fn) => ctx.effect(
    () => ctx.systemPrompt.variable(name, (...args) => captureSystemPrompt(name, cleanText(fn(...args)))),
    `aurabot: 变量 ${name}`,
  )

  /** 她现在怎么叫管理员：心智核心里她自己改过就用她的，没改过用管理员设定的。 */
  const ownerCall = () => {
    try {
      const cfg = getConfig()
      return (getMind()?.ownerCall?.()) || cfg.ownerName || '管理员'
    } catch (error) {
      return getConfig().ownerName || '管理员'
    }
  }

  const rulesOpts = (kind) => {
    const mods = getMods()
    const mind = getMind()
    return {
      ...(mods ? {
        off: mods.builtinOff(),
        extra: [...mods.rules(kind), ...(mind ? mind.rules(kind) : [])],
      } : {}),
      ownerCall: kind === 'private' ? ownerCall() : '管理员',
    }
  }

  // 扩展模块能整段改写人格和规则（同步：提示词变量不能等）
  const rewrite = (event, text, ...args) => {
    const mods = getMods()
    const result = mods ? mods.filterSync(event, text, ...args) : text
    return typeof result === 'string' ? result : result === null ? '' : text
  }

  // 她是谁：心智核心里当前版本的人格卡 + 她自己写的价值观等 + 自我故事摘要 + 不知不觉的变化
  // （心智核心没起来时用面板里的人格卡）
  variable('aurabot_persona', () => {
    const cfg = getConfig()
    const mind = getMind()
    let core = ''
    if (mind) {
      try { core = mind.selfPrompt() } catch { core = '' }
    }
    return rewrite('persona', core || currentPersonaText(cfg.persona.current))
  })

  // 身份边界：宿主维护插件追加提示词时，人设、称呼和语气以人格卡为准。
  // 关掉 purge.identityLock 时返回空串，preset 里的引用自然消失。
  variable('aurabot_identity_lock', () => (getConfig().purge?.identityLock === false ? '' : IDENTITY_LOCK_TEXT))

  variable('aurabot_persona_public', () => {
    try { return getMind()?.selfPrompt({ publicOnly: true }) || '你是大肥鱼。' } catch { return '你是大肥鱼。' }
  })

  variable('aurabot_rules_private', () => {
    const cfg = getConfig()
    const base = rewrite('rules', rulesText('private', cfg, rulesOpts('private')), 'private')
    // 危险命令确认开着时补一句：被拦下要如实告诉管理员，别绕着写
    return base + (cfg.security && cfg.security.dangerConfirm
      ? '\n【危险命令】终端命令如果被安全策略拦下（删根目录/格式化/关机/下载后直接执行等），把命令原文和原因如实告诉管理员，等管理员回复「确认」后再重试；不要换一种写法绕过。'
      : '')
  })

  variable('aurabot_rules_social', () => {
    return rewrite('rules', rulesText('social', getConfig(), rulesOpts('social')), 'social')
  })

  variable('aurabot_rules_group_owner', () => {
    return rewrite('rules', rulesText('group-owner', getConfig(), rulesOpts('group-owner')), 'group-owner')
      + '\n【危险命令】只能在管理员私聊里处理，群里不执行。'
  })

  return { ownerCall }
}
