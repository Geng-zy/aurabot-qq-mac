export function createSessionEventHandler({
  sessionKey, sessionToChat, chatOfSession, turnState, running, turnCurrent, markRunning,
  accountUsage, sessionTarget, reasoningOf, assistantReplyText,
  cleaningFor, blockSessionPrivacy, log, getConfig, getMind, noteUsage, takeInterim, extractReply,
  guardReply, chainSend, deliver, map, audienceRevision, release, rememberFinished,
  slowNoticeSent, clearSlowNotices, clearRunning, stopTyping, rescueFromThinking, isSilence,
  requestReplyRewrite, completedTurn, redact, recoverReply, debugWaiters, turnSessionCurrent,
  outputSources, turnEpochs, sendChain, notePreset = () => {},
}) {
  return function onSessionEvent(session, event) {
    const mind = getMind()
    const key = sessionKey(session && session.id)
    // 会话中途换了预设：这是「当前预设」最权威的来源（宿主文档：重建读 agentPreset 投影，不读创建时的 header）。
    // 放在 chatId 兜底之前——换预设的事件可能早于任何聊天映射，否则会被丢掉。
    if (event?.type === 'agent-preset/selected' && event.data?.agentPreset) {
      try { notePreset(key, event.data.agentPreset) } catch (error) { log?.debug?.('记录预设变更失败：', error?.message) }
      return
    }
    // 回合结束时内存映射可能已空（刚重启），退回持久化的映射，别把这一轮丢了（#159）。
    // 中间段也一样要兜底：重启后第一段正文可能早于 turn/end 到达，拿不到 chatId 就整段丢了。
    const chatId = sessionToChat.get(key) || chatOfSession(key)
    if (!chatId || !event) return
    const st = turnState.get(key) || { lastTurn: -1, text: '', senders: new Set() }
    turnState.set(key, st)
    const dTurn = event.data?.turn
    if (dTurn != null && st.finishedTurns?.has(dTurn) && ['turn/start', 'assistant/message', 'turn/end', 'tool/call'].includes(event.type)) return
    if (event.type === 'turn/start' || event.type === 'assistant/message' || event.type === 'tool/call') {
      if (st.runToken !== undefined && st.activeTurn != null && st.finishedTurns?.has(st.activeTurn)
        && dTurn != null && dTurn !== st.activeTurn && !running.has(chatId)
        && (event.type === 'turn/start' || (typeof dTurn === 'number' && typeof st.activeTurn === 'number' && dTurn > st.activeTurn))
        && turnCurrent(chatId, key, st.runToken)) {
        // 宿主可能在上一轮还在投递时开始处理已接收的插话。
        st.retry = null
        markRunning(chatId, st)
      }
      if (dTurn != null && st.runToken !== undefined && running.get(chatId) === st.runToken) st.activeTurn ??= dTurn
      if (event.type === 'turn/start' || (st.runToken !== undefined && dTurn != null && st.activeTurn != null && dTurn !== st.activeTurn)) return
    }
    if (event.type === 'user/message') {
      // 管理员在 DSH 会话窗口里直接打字（不是从 QQ 转进来的，#58）：只有管理员能操作 DSH，
      // 这一轮按「管理员说的」算；不然重开会话后在面板里让她改资料会报没权限。
      const src = event.data && event.data.source
      if (src && src.kind === 'user') st.directOwner = true
      return
    }
    if (event.type === 'tool/call') {
      // 记下这一轮最后调的工具：紧跟其后的那次模型调用是「处理工具结果」，算到工具所属模块名下
      const d = event.data || {}
      if (d.name) st.lastTool = { name: String(d.name), turn: d.turn }
      st.retry = null
      return
    }
    if (event.type === 'assistant/message') {
      const d = event.data || {}
      if (d.message?.content?.some((block) => ['tool-call', 'tool_use'].includes(block.type))) st.retry = null
      // 用量：DSH 把每次模型调用的 token 数记在这个事件里（含重试）。
      // 平时按「聊天」记账；如果这一步是在处理某个工具的结果（比如聊天里让她生图），
      // 算到那个工具所属的模块名下，别把生图的消耗全算成聊天。
      // 系统会话（外部模块后台 / 日记 / 目的引擎那种）本来就按来源记，不受影响。
      if (d.usage) {
        // 记账规则住在 usage-accounting.js：工具调用后的那次模型调用算到工具模块名下
        accountUsage({ st, chatId, target: sessionTarget.get(key), usage: d.usage, turn: d.turn, time: event.time })
      }
      if (d.interrupted) return
      // 顺手记下思考：万一这一轮她一个字正文都没写，turn/end 时还有机会把定稿捞回来
      const th = reasoningOf(d.message)
      if (th) st.thinking = { turn: d.turn, text: th }
      let raw = assistantReplyText(d.message)
      if (!chatId.startsWith('system:') && cleaningFor(chatId).protectedText?.(raw)) {
        // DSH 已保存原始回复。下次从安全的感知记录接着聊，别把这段原文再次交给模型。
        blockSessionPrivacy(chatId, key)
        log.warn(`${chatId}：回复触及私密内容，已拦下并标记更换会话`)
        st.retry = null
        raw = '[沉默]'
      }
      // 最后一条 assistant 消息才是本轮回复；总是覆盖（空也覆盖），
      // 否则最后一条是空的（或只有工具调用）时会拿上一条过程性文字补发，把思考发出去。
      // 例外是开了 chat.everyStep：那时中间段已经陆续发过，这一步没说话就别把上一段盖掉，
      // 否则「说完一段又去调工具」的那段话会永远发不出去。
      st.lastTurn = d.turn
      st.text = getConfig().chat?.everyStep ? raw || st.text : raw
      if (mind && !chatId.startsWith('system:')) noteUsage(chatId, key, d.usage)
      // chat.everyStep：一轮里分几段说就发几条（默认关，只发最后一段）。发的是「上一段」——
      // 此刻还不知道后面有没有话，把当前段提前发掉会让最后一段变成重复。最后一段仍由 turn/end 发。
      if (raw && getConfig().chat?.everyStep) {
        let prev = takeInterim(st, { turn: d.turn, step: d.step, text: raw })
        if (prev && getConfig().chat?.replyMarker) prev = extractReply(prev, { includeFeel: true }) || ''
        if (prev && getConfig().chat?.thinkingGuard !== false) prev = guardReply(prev)
        const token = st.runToken
        // 中间段里的 <feel> 也交给心智核心（发出去时会被剥掉，这里不收就丢了）
        let feed
        if (prev && mind?.feel) { try { prev = mind.feel(chatId, prev, { senders: [...(st.senders || [])], deferFeed: (pending) => { feed ??= pending } }) } catch {} }
        if (prev) {
          st.retry = null
          // 不在这里记账：deliver 会在真发出去之后自己 logChat，一条都没发成功就不记。
          // 这里再记一次会让每个中间段在聊天流水里出现两遍，发送失败时还会把没发出去的话算成说过。
          log.debug(`${chatId}：分条发出上一段（${prev.length} 字）`)
          const receipt = st.deliveryReceipt
          const userText = st.lastText || ''
          chainSend(chatId, () => deliver(chatId, prev, { own: true, interim: true, userText, isCurrent: () => turnCurrent(chatId, key, token), confirmDelivery: Boolean(receipt), feed })
            .then((result) => { if (result?.delivered) receipt?.(true) }), '分条发送出错：')
        }
      }
      return
    }
    if (event.type === 'turn/end') {
      // 只让「这个聊天当前模式在用的那条会话」把回复发出去：切过调试 / 正式、或者点过「重新开始」以后，
      // 旧会话可能还开在侧栏里，在那儿打字，她的回复不该发到 QQ（来自原项目 cd19db4 / 6949a96）
      if (!chatId.startsWith('system:')) {
        const cur = map().chats[chatId]
        const mode = getConfig().debug ? 'debug' : 'live'
        const revision = audienceRevision(chatId)
        if (!cur || sessionKey(cur.sessionId) !== key || (cur.mode || 'live') !== mode || (revision && cur.privacyRevision?.[mode] !== revision)) {
          log.info(`${chatId} 的旧会话（${key.slice(0, 8)}…）这一轮不发：它不是当前模式在用的会话`)
          if (st.runToken !== undefined) release(chatId, st.runToken)
          return
        }
      }
      const d = event.data || {}
      const token = st.runToken
      if (token !== undefined && !turnCurrent(chatId, key, token)) return
      if (st.activeTurn != null && d.turn != null && st.activeTurn !== d.turn) return
      rememberFinished(st, d.turn)
      slowNoticeSent.delete(key)
      clearSlowNotices(key)
      clearRunning(chatId)
      stopTyping(key)
      const completed = d.reason && d.reason.kind === 'completed'
      let text = st.lastTurn === d.turn ? st.text : ''
      // 整轮一段正文都没有：她可能把话全写在思考里了（Reply: 起草 → Careful: 自检 → N lines: 定稿），
      // 正文块是空的。chat.rescueFromThinking 打开时从最后一步的思考里捞回定稿；捞不到就照旧不发。
      if (!text && completed && !getConfig().chat?.replyMarker && getConfig().chat?.rescueFromThinking && st.thinking && st.thinking.turn === d.turn) {
        const rescued = rescueFromThinking(st.thinking.text)
        if (rescued) {
          text = rescued
          log.info(`${chatId}：整轮没有正文，从思考里捞回一段（${rescued.length} 字）`)
        }
      }
      st.thinking = null
      if (!chatId.startsWith('system:')) {
        const settings = getConfig().chat
        if (completed && settings?.replyMarker && !isSilence(text)) {
          const marked = extractReply(text, { includeFeel: true })
          if (marked === null && !st.rewriting) {
            requestReplyRewrite(chatId, key, st)
            return
          }
          text = marked || ''
        }
        if (settings?.thinkingGuard !== false) text = guardReply(text)
      }
      st.rewriting = false
      // 心智核心：收走回复里的 <feel>（她的感受，别人看不到），一轮聊完花一点精力
      const turnSenders = [...(st.senders || [])]
      let feed
      if (mind?.feel && text) {
        try { text = mind.feel(chatId, text, { senders: turnSenders, deferFeed: (pending) => { feed ??= pending } }) } catch (error) { log.debug('心智记录感受失败：', error.message) }
      }
      if (mind?.noteTurn && completedTurn(d) && !chatId.startsWith('system:')) {
        try { mind.noteTurn(chatId, turnSenders) } catch {}
      }
      const sys = st.system
      const wantVoice = Boolean(st.wantVoice)
      const autoReply = st.autoReply
      st.autoReply = null
      st.text = ''
      // 上一轮还在跑时新消息已经排队给「下一轮」：这一轮 turn/end 不能把下一轮的说话人清掉（#90）
      st.senders = st.pendingSenders || new Set()
      st.pendingSenders = new Set()
      st.quoteId = st.pendingQuoteId || ''
      st.pendingQuoteId = ''
      st.directOwner = false
      st.system = null
      st.wantVoice = false
      if (sys) {
        if (completed) sys.resolve(text)
        else sys.reject(new Error('这一轮没正常结束：' + (d.reason?.kind || '?')))
        return
      }
      if (!completed) {
        const failure = d.reason?.error || d.reason?.failure
        const code = typeof failure?.code === 'string' ? failure.code.replace(/[^\w/-]/g, '').slice(0, 60) : ''
        const detail = String(failure?.message || '').replace(/\s+/g, ' ').slice(0, 180)
        log.warn(`${chatId} 这一轮没正常结束（${d.reason?.kind || '?'}${code ? ' ' + code : ''}${detail ? '：' + redact(detail) : ''}），不发`)
        if (code !== 'TOOL_ACTIVATION_FAILED' && ['error', 'failed', 'max-tokens'].includes(d.reason?.kind) && recoverReply(chatId, key, st, token)) return
        release(chatId, token)
        return
      }
      if (chatId.startsWith('system:')) return // 已超时的后台轮次不能误发到 QQ
      if ((!text || (st.retry?.mustReply && isSilence(text))) && recoverReply(chatId, key, st, token)) return
      // 面板里的调试对话在等这一轮：把她说的话交回去（调试模式下照常只进日志，不发 QQ）
      const waiter = debugWaiters.get(chatId)
      if (waiter) { debugWaiters.delete(chatId); waiter(text) }
      if (!text) return release(chatId, token)
      st.retry = null
      // 发完再放开：发送期间来的消息也攒到下一段。
      // 没有中间段在发的时候就走原来的路径（同步开始、release 跟着这一条走），时序和以前一模一样；
      // 只有前面真有中间段没发完时才排队，保证最后一段一定是最后一条（#214 review）。
      const userText = st.lastText || ''
      const isCurrent = () => turnSessionCurrent(chatId, key)
      const captured = outputSources.get(chatId)
      const sources = captured && { ...captured, system: new Map(captured.system), memory: [...captured.memory] }
      const receipt = st.deliveryReceipt
      const sendLast = () => deliver(chatId, text, { wantVoice, autoReply, userText, own: true, isCurrent, sources, confirmDelivery: Boolean(receipt), feed })
        .then((result) => receipt?.(result?.delivered === true))
        .catch((error) => log.warn('发送出错：', error.message))
        .finally(() => { if (turnEpochs.get(chatId)?.token === token) release(chatId, token) })
      const pending = sendChain.get(chatId)
      if (pending) {
        const sending = pending.then(sendLast, sendLast)
        sendChain.set(chatId, sending)
        const done = () => { if (sendChain.get(chatId) === sending) sendChain.delete(chatId) }
        sending.then(done, done)
      } else {
        sendLast()
      }
    }
  }

  // ---------- 收 QQ ----------
}
