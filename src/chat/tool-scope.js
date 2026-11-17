// 会话级的工具闸：群聊里「主人开口才给本机工具」，以及给非完整权限会话
// 收走全局工具。纯宿主 API，不依赖聊天业务。
//
// 设计约束：
// - 用 allow 白名单而不是 deny 名单。deny 只认固定名字，新装的 MCP / 团队工具
//   随时会漏，而那些工具同样能读写本机。
// - 问不出宿主有哪些工具时，allow 用空集：一个都不给。
// - 闸是可开合的：群聊「主人本机工具」档需要按每一轮说话的人切换。

import { knownGlobalToolNames } from '../integration/host-tools.js'

/** 非主人那一轮仍可用的全局工具：只留会话内的交互工具。 */
export const GUEST_SAFE_TOOLS = [/^ask_user_question$/, /^todo_write$/]

export function isGuestSafeTool(name) {
  return GUEST_SAFE_TOOLS.some((re) => re.test(String(name || '')))
}

/**
 * 创建一组按会话键管理的工具闸。
 * @param {{ log?: { debug?: Function, warn?: Function, info?: Function } }} [options]
 */
export function createToolScope({ log } = {}) {
  const gates = new Map() // key → { agent, off }

  /** 收走这个 agent 的全部全局工具，只留 GUEST_SAFE_TOOLS。 */
  function restrictGuest(agent) {
    const known = knownGlobalToolNames(agent)
    // 问不出宿主有哪些工具时，宁可一个都不给，也不能漏。
    const allow = known ? known.filter(isGuestSafeTool) : []
    return agent.ctx.tools.restrict({ allow })
  }

  /** 登记一个可开合的闸（群聊 group-full 用）。 */
  function openGate(key, agent) {
    gates.set(key, { agent, off: null })
  }

  /** 切换某个闸：allow 为真表示这一轮说话的人全是主人。 */
  function applyGate(key, allow) {
    const gate = gates.get(key)
    if (!gate) return
    try {
      if (allow) {
        if (gate.off) {
          gate.off()
          gate.off = null
          log?.info?.(`${String(key).slice(-8)}：本机工具放开（这一轮是主人）`)
        }
      } else if (!gate.off) {
        gate.off = restrictGuest(gate.agent)
        log?.info?.(`${String(key).slice(-8)}：本机工具收起（这一轮不是主人）`)
      }
    } catch (error) {
      log?.warn?.('群聊工具闸切换失败：', error.message)
    }
  }

  /** 撤掉某个 agent 名下的所有闸（卸载会话时用）。 */
  function releaseAgent(agent) {
    for (const [key, gate] of gates) {
      if (gate.agent !== agent) continue
      try { if (typeof gate.off === 'function') gate.off() } catch (error) { /* ignore */ }
      gates.delete(key)
    }
  }

  /** 撤掉全部闸（插件卸载时用）。 */
  function closeAll() {
    for (const [key, gate] of gates) {
      try { if (typeof gate.off === 'function') gate.off() } catch (error) { /* ignore */ }
      gates.delete(key)
    }
  }

  return { restrictGuest, openGate, applyGate, releaseAgent, closeAll, gates }
}
