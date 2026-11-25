export function createTurnState({ BUSY_MAX_MS, CHAT_STYLE_INSTRUCTION, MARKER_INSTRUCTION, SOURCE_KIND, archiveQuietly, askModel, audienceRevision, busy, checkAllowed, createSession, debugWaiters, deliver, dsh, encodeForHandoff, getConfig, getMind, guardReply, isMuted, isSilence, levelFor, log, map, mounted, randomUUID, release, running, runningTimers, sessionKey, sessionToChat, sourcesFor, stopTyping, turnEpochs, turnMaxMs, turnSeq, withPromptCapture, isDisposed }) {
  function turnSessionCurrent(chatId, key) {
    if (isDisposed()) return false
    if (chatId.startsWith('system:')) return true
    const entry = map().chats[chatId]
    const mode = getConfig().debug ? 'debug' : 'live'
    const revision = audienceRevision(chatId)
    return Boolean(entry && sessionKey(entry.sessionId) === key && (entry.mode || 'live') === mode && (!revision || entry.privacyRevision?.[mode] === revision))
  }
  const turnCurrent = (chatId, key, token) => turnEpochs.get(chatId)?.token === token && turnSessionCurrent(chatId, key)

  function rememberFinished(st, turn) {
    if (turn == null) return
    st.finishedTurns ??= new Set()
    st.finishedTurns.add(turn)
    if (st.finishedTurns.size > 24) st.finishedTurns.delete(st.finishedTurns.values().next().value)
  }

  /** 失败后只补写正文，旧轮次的工具和投递不会重放。 */
  function recoverReply(chatId, key, st, token, { timedOut = false } = {}) {
    const request = st.retry
    if (!request || st.recovering || !turnCurrent(chatId, key, token)) return false
    st.retry = null
    st.recovering = true
    clearRunning(chatId)
    busy.set(chatId, Date.now())
    let activeKey = key
    const active = () => {
      if (!turnCurrent(chatId, activeKey, token)) return false
      const cfg = getConfig()
      if ((!cfg.enabled && !cfg.debug) || !checkAllowed(cfg, request.chat).allowed || isMuted?.(chatId)) return false
      try { request.assertAuthorized?.(); return true } catch { return false }
    }
    const rotate = async () => {
      const old = map().chats[chatId]?.sessionId
      const fresh = await createSession(request.chat, levelFor(getConfig(), request.chat), () => {
        if (!active()) throw new Error('原会话已失效')
      })
      encodeForHandoff(chatId)
      activeKey = sessionKey(fresh)
      sessionToChat.delete(key)
      stopTyping(key)
      archiveQuietly(old)
    }
    const generate = async (context) => {
      const signal = AbortSignal.timeout(9000)
      const abort = new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      const out = await Promise.race([askModel(dsh, {
        cfg: getConfig(), model: request.model, system: request.persona + '\n' + context +
          '\n' + CHAT_STYLE_INSTRUCTION + '\n按人设回答对方刚说的话。只输出要交给对方的正文。不要声称执行了任何操作。',
        text: request.text, maxTokens: 400, reasoningEffort: 'low', module: 'chat-recovery', signal, retryEmpty: false,
      }), abort]).catch((error) => {
        log.debug('补写回复失败：', error?.code || error.name)
        return ''
      })
      const text = guardReply(out)
      return text && isSilence(text) ? null : text
    }
    void (async () => {
      if (timedOut) {
        const agent = mounted.get(key)?.agent
        if (typeof agent?.cancel !== 'function' || typeof agent?.whenIdle !== 'function') return
        const signal = AbortSignal.timeout(5000)
        await Promise.race([
          (async () => { await agent.cancel({ kind: 'user' }); await agent.whenIdle() })(),
          new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
        ])
      }
      if (!active()) return
      let text = await generate(String(getMind().contextFor?.({ chat: request.chat, userText: request.text }) || '').slice(0, 1400))
      if (text === '' && active()) {
        if (activeKey === key) await rotate()
        if (active()) text = await generate('')
      }
      if (!text || !active()) return
      const waiter = debugWaiters.get(chatId)
      if (waiter) { debugWaiters.delete(chatId); waiter(text) }
      await deliver(chatId, text, { own: true, userText: request.text, isCurrent: active, sources: request.sources })
    })().catch((error) => log.debug('恢复聊天轮次失败：', error?.code || error.name))
      .finally(() => release(chatId, token))
    return true
  }

  function requestReplyRewrite(chatId, key, st) {
    st.rewriting = true
    busy.set(chatId, Date.now())
    st.text = ''
    st.lastTurn = -1
    st.interimTurn = null
    st.interimText = ''
    const token = markRunning(chatId, st, { rewrite: true })
    const agent = mounted.get(key)?.agent
    const fail = (error) => {
      if (!turnCurrent(chatId, key, token)) return
      log.debug('重写正文未完成：', error?.message || '会话不可用')
      release(chatId, token)
    }
    if (!agent?.followup) return fail()
    const request = { id: randomUUID(), role: 'user', content: [{ type: 'text', text: '请把上一轮的最终正文重写一次。保留原意，只输出给对方看的话，不要调用工具。' + MARKER_INSTRUCTION }], source: { kind: SOURCE_KIND, speaker: { role: 'none' } } }
    Promise.resolve().then(() => {
      if (turnCurrent(chatId, key, token)) return withPromptCapture(sourcesFor(chatId), () => agent.followup(request))
    }).catch(fail)
  }

  function markRunning(chatId, st, { rewrite = false } = {}) {
    const token = ++turnSeq
    running.set(chatId, token)
    turnEpochs.set(chatId, { token, st })
    if (st) {
      st.runToken = token
      st.activeTurn = null
      st.rewriting = rewrite
    }
    const old = runningTimers.get(chatId)
    if (old) { clearTimeout(old); runningTimers.delete(chatId) }
    const max = turnMaxMs()
    const limit = rewrite ? Math.min(max || 20000, 20000) : max
    if (!limit) return token
    const timer = setTimeout(() => {
      // 只放开卡住的那一轮：已经换成新一轮就别误伤
      if (running.get(chatId) !== token) return
      if (st) rememberFinished(st, st.activeTurn)
      log.warn(`${chatId}：${rewrite ? '重写回复' : '这一轮'}超时，强制放开`)
      if (!rewrite && st && recoverReply(chatId, sessionKey(map().chats[chatId]?.sessionId), st, token, { timedOut: true })) return
      release(chatId, token)
    }, limit)
    timer.unref?.()
    runningTimers.set(chatId, timer)
    return token
  }
  function clearRunning(chatId) {
    running.delete(chatId)
    const timer = runningTimers.get(chatId)
    if (timer) { clearTimeout(timer); runningTimers.delete(chatId) }
  }
  const isBusy = (chatId) => busy.has(chatId) && Date.now() - busy.get(chatId) < BUSY_MAX_MS

  return { turnSessionCurrent, rememberFinished, recoverReply, requestReplyRewrite, markRunning, clearRunning, isBusy, turnCurrent }
}
