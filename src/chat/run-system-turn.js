export function createRunSystemTurn({ SOURCE_KIND, SYSTEM_STUCK_GRACE_MS, agentFor, assertActive, cleanText, getMind, isDisposed, randomUUID, recoverSystemTurn, replyWaits, sessionKey, sourcesFor, systemFailed, systemFailures, systemStarting, systemTurns, turnState, withPromptCapture }) {
  return async function runSystemTurn(name, title, prompt, { timeoutMs = 180000, noTools = false, publicOnly = false, key: scope = '' } = {}) {
    const mind = getMind()
    const suffix = String(scope || '').trim().replace(/[^\w:-]/g, '').slice(0, 32)
    const chat = { chatId: suffix ? `system:${name}:${suffix}` : `system:${name}`, kind: 'system', title, noTools: !!noTools }
    assertActive()
    if (systemStarting.has(chat.chatId)) throw new Error('这个后台会话的上一轮还没结束')
    systemStarting.add(chat.chatId)
    let result
    try {
      const current = systemTurns.get(chat.chatId)
      if (current?.st.system && current.st.system.timedOutAt == null) throw new Error('这个后台会话的上一轮还没结束')
      const failure = systemFailures.get(chat.chatId)
      if (failure && Date.now() < failure.until) throw new Error(`后台会话冷却中，${Math.ceil((failure.until - Date.now()) / 60_000)} 分钟后再试`)
      if (current?.st.system && Date.now() - current.st.system.timedOutAt < SYSTEM_STUCK_GRACE_MS) throw new Error('这个后台会话的上一轮还没结束')
      if (current?.needsRecovery || current?.st.system) {
        try { await recoverSystemTurn(chat.chatId, current) } catch (error) {
          if (!isDisposed()) systemFailed(chat.chatId)
          throw error
        }
      } else if (current) systemTurns.delete(chat.chatId)
      const { agent, sessionId } = await agentFor(chat)
      assertActive()
      const key = sessionKey(sessionId)
      const st = turnState.get(key) || { lastTurn: -1, text: '', senders: new Set() }
      if (st.system) throw new Error('这个后台会话的上一轮还没结束')
      turnState.set(key, st)
      const budget = await mind?.reserveActionModel?.(prompt)
      let timer
      let rejectWait
      const base = new Promise((resolve, reject) => {
        rejectWait = reject
        st.system = { resolve, reject }
        timer = setTimeout(() => {
          if (st.system === system) {
            system.timedOutAt = Date.now()
            systemFailed(chat.chatId)
          }
          reject(new Error('等太久了'))
        }, timeoutMs)
      })
      const system = st.system
      systemTurns.set(chat.chatId, { agent, sessionId, key, st })
      // 卸载时立即结束等待，不用等模型或超时。
      const wait = { timer, reject: rejectWait, result: null }
      wait.result = base.then((text) => { systemFailures.delete(chat.chatId); return text }, (error) => {
        if (system.timedOutAt == null && !isDisposed()) systemFailed(chat.chatId)
        throw error
      }).finally(() => { clearTimeout(timer); replyWaits.delete(wait); budget?.(system.started, system.tokens) })
      replyWaits.add(wait)
      wait.result.catch(() => {})
      result = wait.result
      // followup 可能等整轮结束才返回；超时后保留标记，直到收到 turn/end 或取消并归档。
      Promise.resolve().then(() => {
        assertActive()
        const previous = sourcesFor(chat.chatId)
        const sources = { ...previous, system: new Map(previous.system), publicOnly }
        system.started = true
        return withPromptCapture(sources, () => agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: cleanText(prompt) }], source: { kind: SOURCE_KIND, speaker: { role: 'none' } } }))
      }).catch((error) => {
        if (st.system === system && system.timedOutAt == null) { st.system = null; system.reject(error) }
      })
    } finally {
      systemStarting.delete(chat.chatId)
    }
    return result
  }

  /** 这一轮里说话的人是不是全是管理员（群管等敏感工具用）。 */
  /** 这一轮里管理员说过话（群里常有别人插话，不要求每条都是管理员）。 */
  // 管理员私聊里只可能是管理员说话：就算这一轮的记录丢了（工具是旧闭包、排队轮次被上一轮 turn/end 清掉等，见 #90），
  // 「仅管理员」也应当放行；群聊 / 别人私聊不放宽。

}
