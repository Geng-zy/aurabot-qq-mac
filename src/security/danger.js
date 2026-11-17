// 危险终端命令确认（可选保护，默认关）。
// 规则与 shell 解析在 danger-rules.js；这里只做 QQ 确认、超时、回复消费和会话归属判断。
import { isOwner } from '../chat/access.js'
import { isDangerousCommand } from './danger-rules.js'

export { isDangerousCommand } from './danger-rules.js'

const CONFIRM_RE = /^(确认|确认执行|同意|同意执行|允许|允许执行|可以|执行吧|放行|yes|y|ok)$/i
const CANCEL_RE = /^(取消|取消执行|拒绝|不要|不|不行|别|停|停手|拦下|no|n)$/i

/**
 * 包一层「这个会话是不是 aurabot 自己开的」判断（工具 pre-execute 是进程级钩子）：
 * 判断不出来（isOwnedSession 缺失 / 抛错）时按 owned=true 处理，保留原有 fail-closed 路径；
 * 只有明确返回 false（宿主自己的 GUI/CLI 会话）才交给 DSH 自己的权限系统。
 * @param {null|((sessionId:string)=>boolean)} probe
 * @returns {(sessionId:string)=>boolean}
 */
export function safeOwnedSession (probe) {
  return (sessionId) => {
    if (typeof probe !== 'function') return true
    try { return probe(sessionId) !== false } catch (error) { return true }
  }
}

const clip = (text, n = 300) => (text.length > n ? text.slice(0, n) + '…' : text)

/**
 * 危险命令确认器。host 负责把 DSH 的 tools/pre-execute 和 QQ 私聊回复接进来。
 * @param {object} o
 * @param {() => object} o.getConfig 读最新配置（每次工具调用都重新判断开关）
 * @param {(chatId:string, text:string) => Promise<any>} o.deliver 发 QQ 消息（管理员私聊）
 * @param {(sessionId:string) => string} o.chatOfSession DSH session → QQ chatId
 * @param {(sessionId:string) => boolean} [o.isOwnedSession] 这个会话是不是 aurabot 自己开的（QQ 聊天映射来的）
 * @param {() => string} o.ownerQQ 管理员 QQ 号
 * @param {number} [o.timeoutMs] 等确认的超时（默认 60 秒）
 * @param {object} [o.log]
 */
export function createDangerGuard ({ getConfig, deliver, chatOfSession, isOwnedSession, ownerQQ, timeoutMs = 60_000, log } = {}) {
  const pending = new Map() // chatId → { resolve, timer }
  let disposed = false

  function cleanup (chatId, value) {
    const p = pending.get(chatId)
    if (!p) return false
    pending.delete(chatId)
    clearTimeout(p.timer)
    p.resolve(value)
    return true
  }

  /**
   * 工具执行前：命中危险规则就发 QQ 问管理员，等回复；确认才放行。
   * next() 返回 allow；返回 deny 时 DSH 会把 reason 给模型。
   */
  async function preExecute (exec, next) {
    if (disposed) return { kind: 'deny', reason: '插件已卸载，取消旧工具调用。' }
    // DSH 的智能体团队是全局工具，打开后群聊会话也拿得到；成员有电脑权限，只有管理员私聊能用
    if (String(exec?.name || '') === 'spawn_teammate') {
      const chatId = chatOfSession ? String(chatOfSession(exec.agent?.session?.id) || '') : ''
      if (chatId && chatId !== `private:${ownerQQ ? ownerQQ() : ''}`) {
        log?.warn?.(`已拦下 spawn_teammate（${chatId}）`)
        return { kind: 'deny', reason: '只有管理员私聊才能创建成员。' }
      }
    }
    const cfg = getConfig() || {}
    const tool = String(exec && exec.name || '')
    if (tool !== 'bash' && tool !== 'pwsh') return next()
    const command = String(exec.arguments && exec.arguments.command || '')
    const danger = isDangerousCommand(command)
    if (!danger) return next()
    const sessionId = exec.agent && exec.agent.session && exec.agent.session.id
    // 只管 aurabot 自己开的会话。tools/pre-execute 是进程级的，同一个 DSH 进程里管理员自己开的
    // Web GUI / CLI 会话也会走到这里；那些命令不归这个守卫管，不该被 QQ 的安全策略拦下
    // （何况拦下时拿不到 chatId，连确认消息都发不出去，管理员没有任何办法放行）。
    // 没传 isOwnedSession 的调用方（老用法 / 单测）保持原行为，照旧往下判断。
    if (typeof isOwnedSession === 'function') {
      let owned = null
      // 判断不出来（抛错）就按老逻辑走，仍然 fail-closed
      try { owned = !!isOwnedSession(sessionId) } catch (error) { owned = null }
      if (owned === false) return next()
    }
    const chatId = chatOfSession ? String(chatOfSession(sessionId) || '') : ''
    const owner = String(ownerQQ ? ownerQQ() : '')
    const ownerChat = owner ? `private:${owner}` : ''
    // 是我的会话但认不出聊天（比如 QQ 会话刚建立、映射还没落盘）：不敢放也不敢问，仍然拦下
    if (!chatId || chatId !== ownerChat) {
      log?.warn?.(`危险命令已拦下（非管理员私聊 ${chatId || '未知'}）：${clip(command, 120)}`)
      return { kind: 'deny', reason: `这条命令被安全策略拦下了（${danger.label}）：只有管理员私聊里、并且经过管理员确认才能执行。` }
    }
    if (cfg.security?.dangerConfirm !== true) return next()
    // 同一个人已经在等确认：别再发第二条，直接拦
    if (pending.has(chatId)) {
      return { kind: 'deny', reason: `上一条危险命令还在等管理员确认（${danger.label}），这条先不执行。` }
    }
    const seconds = Math.max(1, Math.round(timeoutMs / 1000))
    const question = [
      `⚠️ 危险命令确认（${danger.label}）`,
      clip(command, 260),
      `回复「确认」执行，回复「取消」拦下；${seconds} 秒内没回也会拦下。`,
    ].join('\n')
    let ok = false
    try {
      const asked = new Promise((resolve) => {
        // 注意别 unref：系统就在等这个确认（工具调用被挂住），计时器必须撑着
        const timer = setTimeout(() => { cleanup(chatId, false); log?.warn?.(`危险命令确认超时，已拦下：${clip(command, 120)}`) }, timeoutMs)
        pending.set(chatId, { resolve, timer })
      })
      ;(async () => { try { await deliver(ownerChat, question) } catch (error) { log?.warn?.('危险命令确认消息没发出去：', error.message); cleanup(chatId, false) } })()
      ok = await asked
    } catch (error) {
      log?.warn?.('危险命令确认出错：', error.message)
      ok = false
    }
    if (ok && !disposed) {
      // 等待期间可能已经关闭确认开关或换了管理员：旧确认不能继续放行
      const nowCfg = getConfig() || {}
      const ownerNow = String(ownerQQ ? ownerQQ() : '')
      if (nowCfg.security?.dangerConfirm !== true || ownerNow !== owner) {
        log?.warn?.(`危险命令确认已失效（开关或管理员已变），拦下：${clip(command, 120)}`)
        return { kind: 'deny', reason: `危险命令确认已失效（${danger.label}）：确认开关或管理员身份在执行前发生了变化，请重新发起。` }
      }
      log?.info?.(`管理员确认执行危险命令（${danger.label}）：${clip(command, 120)}`)
      return next()
    }
    log?.info?.(`管理员没确认危险命令（${danger.label}），已拦下：${clip(command, 120)}`)
    return { kind: 'deny', reason: `危险命令被管理员拦下了（${danger.label}）：管理员没有回复「确认」。要执行的话，请管理员在私聊里回复「确认」后再试；也可以换个安全的做法。` }
  }

  /**
   * 处理管理员 QQ 私聊回复。命中的确认/取消返回 true（这条消息被消费，不再交给她）；
   * 其它消息返回 false，照常走原来的聊天流程。
   */
  function handleReply (chatId, userId, text) {
    if (!pending.has(String(chatId || ''))) return false
    // 等待期间关闭确认开关：取消旧 pending，不再接受旧确认
    const cfg = getConfig() || {}
    if (!cfg.security || cfg.security.dangerConfirm !== true) {
      cleanup(String(chatId), false)
      return false
    }
    const owner = String(ownerQQ ? ownerQQ() : '')
    if (!isOwner({ ownerQQ: owner }, userId)) return false
    const t = String(text || '').trim()
    if (CONFIRM_RE.test(t)) return cleanup(String(chatId), true)
    if (CANCEL_RE.test(t)) return cleanup(String(chatId), false)
    return false
  }

  return {
    preExecute,
    handleReply,
    dispose() {
      disposed = true
      for (const chatId of pending.keys()) cleanup(chatId, false)
    },
    /** 等确认中的数量（测试/排查用） */
    get pendingCount () { return pending.size },
  }
}
