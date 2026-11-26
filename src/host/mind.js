// 心智核心的装配：把聊天中枢、人格卡、模型调用接到 createMindAdapter 上。
// 从 host.js 拆出来的原因：这一段是「她是谁、她怎么记事、她醒来后怎么补消息」的策略，
// 和组合根的装配顺序无关；拆开后 host.js 只剩「先起谁、后起谁」。

import { createMindAdapter } from '../mind-adapter/index.js'

/**
 * @param {object} d
 * @param {(name: string) => string} d.dataDir
 * @param {() => object} d.getConfig
 * @param {object} d.log 已带 'mind' 前缀的日志
 * @param {string} d.trashDir 丢弃物的去处（测试里指向临时目录）
 * @param {(spec: object) => Promise<string>} d.askModel
 * @param {object} d.ctx DSH 上下文
 * @param {() => object|null} d.getHub 聊天中枢（可能还没起来）
 * @param {() => string} d.ownerCall 当着她面怎么称呼管理员
 * @param {Function} d.backgroundText 后台发消息
 * @param {Function} d.readPersona / d.savePersona 人格卡
 * @param {string} d.legacyPlatform 老平台名（群名只在 QQ 上有）
 * @param {(id: string) => object|null} d.use 取正在跑的模块
 * @returns {object|null} 心智核心实例；起不来就 null，聊天照常
 */
export function createMind(d) {
  let mind = null
  try {
    mind = createMindAdapter({
      dir: d.dataDir('mind'),
      getConfig: d.getConfig,
      log: d.log,
      persona: () => d.readPersona(d.getConfig().persona.current),
      legacyDir: d.dataDir(),
      trashDir: d.trashDir,
      // 心智核心的后台用途（记经历、睡觉整理、做梦）都用 DeepSeek，思考深度按用途定
      // 带回真实用量（输入 + 输出 token），每天的后台预算按它记，拿不到时心智核心按字数估
      ask: async ({ scene, system, text, maxTokens, reasoningEffort }) => {
        let tokens = 0
        const out = await d.askModel(d.ctx, { system, text, maxTokens, reasoningEffort, temperature: 0.4, cfg: d.getConfig(), module: 'mind:' + (scene || 'think'), onUsage: (u) => { tokens += (Number(u?.inputTokens) || 0) + (Number(u?.outputTokens) || 0) } })
        return tokens ? { text: out, tokens } : out
      },
      embedKey: () => d.getConfig().mind?.embedKey || '',
      // 她想主动找人：把心里的由头交给那个私聊，话由她自己说
      reachOut: async ({ chatId, userId, note }) => {
        const hub = d.getHub()
        if (!hub) return false
        return hub.pushToSession({ chatId, kind: 'private', userId: String(userId), nickname: d.ownerCall() }, [{ type: 'text', text: note }], '', { internal: true, confirmDelivery: true })
      },
      deliverReminder: async ({ chatId, text, isCurrent }) => {
        const result = await d.backgroundText(chatId, text, '提醒', { isCurrent, allowQueue: false, throwOnError: true })
        return Boolean(result && !result.queued)
      },
      // 她改了自己之后通知你（系统通知，不是她说的话）
      notifyOwner: async (text) => {
        const chatId = mind?.ownerChat()
        const hub = d.getHub()
        if (!hub || !chatId) return
        await d.backgroundText(chatId, text, '心智通知', { force: true, quiet: true, system: true }).catch(() => {})
      },
      // 她改了人格卡、名字：面板里正在用的那份人格卡文件跟着改，两边一致
      onSelfChange: ({ what, after }) => {
        const id = d.getConfig().persona.current
        const cur = d.readPersona(id)
        if (!cur) return
        if (what === 'persona') d.savePersona(id, { name: cur.name, tags: cur.tags, body: after, nickname: cur.nickname })
        if (what === 'name') d.savePersona(id, { name: after, tags: cur.tags, body: cur.body, nickname: cur.nickname })
        if (what === 'nickname') d.savePersona(id, { name: cur.name, tags: cur.tags, body: cur.body, nickname: after })
      },
      // 群名（聊天中枢查到过的；没查到就显示群号）
      groupName: (gid, platform) => platform === d.legacyPlatform ? d.getHub()?.groupNames?.get?.(String(gid)) || '' : '',
      // 正在翻唱（很吃内存）：本地小模型先让路
      heavyBusy: () => { try { return Boolean(d.use('song')?.status?.()?.current) } catch { return false } },
      foregroundBusy: () => d.getHub()?.foregroundBusy(),
      // 醒来后把睡着时找她的消息重新交给聊天中枢（一条一条来，管理员的先）
      onWakeReplay: async (list) => {
        for (const item of list) {
          const hub = d.getHub()
          if (!hub) return
          try { await hub.onMessage(item.event) } catch (error) { d.log.debug('补回消息失败：', error.message) }
          await new Promise((r) => setTimeout(r, 1500))
        }
      },
    })
    mind.start().catch((error) => d.log.warn('心智核心启动步骤出错：', error.message))
  } catch (error) {
    d.log.warn('心智核心没起来（聊天照常）：', error.message)
    mind = null
  }
  return mind

}
