// DSH 要授权时，在主人 QQ 私聊里问一句，回复「确认」就批准这一次（#162）。
// 只处理主人私聊会话发起的请求：别的会话照旧交给 DSH 界面。网页也同时能点，谁先答算谁。

const APPROVE_RE = /^(确认|批准|同意|允许)$/
const REJECT_RE = /^(取消|拒绝)$/

/**
 * @param {object} o
 * @param {() => object} o.getConfig
 * @param {(chatId:string, text:string) => Promise<any>} o.deliver 发 QQ 消息
 * @param {(o: { facts: string, must?: string[], fallback: string }) => Promise<any>} [o.speak]
 *   由她用自己的话说（见 features/her-voice.js）；不给就发 fallback 里的固定文字
 * @param {(sessionId:string) => string} o.chatOfSession DSH session → QQ chatId
 * @param {number} [o.timeoutMs] 等主人回复多久（默认 5 分钟）
 * @param {object} [o.log]
 */
export function createApprovalRelay({ getConfig, deliver, speak, chatOfSession, timeoutMs = 5 * 60_000, log } = {}) {
  const queue = [] // 排队的请求：一次只问一条，「确认」只对正在问的这条生效
  let disposed = false
  let lastAsked = 0

  const ownerChat = () => `private:${getConfig().ownerQQ}`
  const send = (text) => Promise.resolve().then(() => deliver(ownerChat(), text)).catch((error) => log?.warn?.('审批消息没发出去：', error.message))
  /** 告诉主人：有 speak 就让她自己说（facts 只给她看），没有就发固定文字。 */
  const say = (facts, fallback, must = []) => (typeof speak === 'function'
    ? Promise.resolve().then(() => speak({ facts, must, fallback })).catch((error) => { log?.warn?.('审批消息没发出去：', error.message); return send(fallback) })
    : send(fallback))

  /** 这个会话的授权请求归 QQ 问：通知那边就不用再发一条。 */
  function handles(sessionId) {
    const cfg = getConfig()
    return !disposed && cfg.enabled && !cfg.dryRun && cfg.approvalViaQQ === true && Boolean(cfg.ownerQQ) && chatOfSession(sessionId) === ownerChat()
  }

  function ask(item) {
    const left = queue.length - 1
    const lines = ['【要授权】' + (item.toolName || '未知工具')]
    if (item.reason) lines.push('原因：' + String(item.reason).slice(0, 300))
    lines.push(`回复「确认」批准这一次，回复「取消」拒绝；${Math.round(timeoutMs / 60_000)} 分钟没回就不批。` + (left ? `后面还有 ${left} 条。` : ''))
    const mins = Math.round(timeoutMs / 60_000)
    item.timer = setTimeout(() => {
      settle(item, 'unavailable')
      say(`刚才那个要他批准的「${item.toolName}」，${mins} 分钟里他没回，就没批，你那件事先搁下了。`, `「${item.toolName}」的授权超时了，没有批准。`)
    }, timeoutMs)
    say(
      `你和他私聊时正在做的事要用到「${item.toolName || '某个工具'}」，DSH 要他授权才能继续。` + (item.reason ? `DSH 给的原因：${String(item.reason).slice(0, 300)}。` : '')
        + `他回「确认」就批准这一次，回「取消」就不批；${mins} 分钟没回就算不批。` + (left ? `后面还有 ${left} 件也在等他批。` : ''),
      lines.join('\n'),
      ['确认', '取消'],
    )
  }

  function settle(item, outcome) {
    const i = queue.indexOf(item)
    if (i < 0) return false
    queue.splice(i, 1)
    clearTimeout(item.timer)
    item.signal?.removeEventListener?.('abort', item.onAbort)
    item.resolve(outcome)
    if (i === 0 && queue.length) ask(queue[0])
    return true
  }

  /** QQ 不问的会话（开关关着、群聊、别人的私聊）：网页开着没人点时 DSH 会一直等，回合结束不了，后面的消息全堵死（#162）。 */
  function withDeadline(request, next) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        log?.warn?.(`「${request.toolName}」的授权一直没人答，按没批准处理`)
        resolve('unavailable')
      }, timeoutMs)
      Promise.resolve().then(next).then(resolve, reject).finally(() => clearTimeout(timer))
    })
  }

  function onRequest(request, next) {
    const sessionId = request?.agent?.session?.id
    if (!handles(sessionId)) return !disposed && chatOfSession(sessionId) ? withDeadline(request, next) : next()
    lastAsked = Date.now()
    return new Promise((resolve) => {
      const item = { toolName: request.toolName, reason: request.reason, signal: request.signal, resolve, timer: null }
      item.onAbort = () => settle(item, 'cancelled')
      request.signal?.addEventListener?.('abort', item.onAbort, { once: true })
      queue.push(item)
      if (queue.length === 1) ask(item)
      // 网页那边也能答：有结果就收掉 QQ 这边的问题；没人答（unavailable）就继续等主人回 QQ
      Promise.resolve().then(next).then((outcome) => {
        if (outcome !== 'unavailable' && settle(item, outcome)) say(`「${item.toolName}」那件事他已经在电脑上的 DSH 里处理了，不用再在 QQ 里回了。`, `「${item.toolName}」已经在 DSH 里处理了。`)
      }, () => {})
    })
  }

  /** 主人的私聊回复。是对审批的回答就返回 true，不再交给她。 */
  function handleReply(chatId, userId, text) {
    if (!queue.length || chatId !== ownerChat() || String(userId) !== String(getConfig().ownerQQ)) return false
    const word = String(text || '').trim()
    const outcome = APPROVE_RE.test(word) ? 'allowed-once' : REJECT_RE.test(word) ? 'rejected' : ''
    if (!outcome) return false
    const item = queue[0]
    settle(item, outcome)
    say(outcome === 'allowed-once' ? `他刚在 QQ 里批准了这一次「${item.toolName}」，你接着做。` : `他刚在 QQ 里没批「${item.toolName}」，那一步你不做了。`,
      outcome === 'allowed-once' ? `批准了这一次：${item.toolName}` : `拒绝了：${item.toolName}`)
    return true
  }

  function dispose() {
    disposed = true
    for (const item of [...queue]) settle(item, 'unavailable')
  }

  return { onRequest, handleReply, handles, dispose, pending: () => queue.length, askedRecently: () => Date.now() - lastAsked < 10_000 }
}
