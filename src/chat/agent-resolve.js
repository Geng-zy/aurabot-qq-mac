export function createAgentResolve({ applyModel, archiveQuietly, assertActive, audienceRevision, controller, createSession, dsh, getConfig, getMind, keyOf, levelFor, log, map, modelContextWindow, mount, optionalService, parseChat, presetFor, resolveTarget, running, saveMap, sessionKey, sessionTarget, sessionToChat, targetModel, turnState, handoffEncodings }) {
  async function resolveAgent(sid) {
    const live = dsh.agents.get(sid) || dsh.agents.get('session-' + sid)
    if (live) return live
    const r = await controller().resolveAgent(sid)
    if (r && r.agent) return r.agent
    const e = r && r.error
    throw Object.assign(new Error(e?.message || '恢复会话失败'), { code: e?.code })
  }

  function encodeForHandoff(chatId) {
    if (!getMind()?.encodeChat || parseChat(chatId)?.kind === 'system' || getConfig().debug) return
    if (handoffEncodings.has(chatId)) return
    const task = Promise.resolve().then(() => getMind().encodeChat(chatId))
      .catch((error) => log.debug('换新会话时记经历失败：', error.message))
      .finally(() => handoffEncodings.delete(chatId))
    handoffEncodings.set(chatId, { task, wait: null })
  }

  async function waitForHandoff(chatId) {
    const handoff = handoffEncodings.get(chatId)
    if (!handoff) return
    if (!handoff.wait) {
      let timer
      // 模型慢或额度不足时先用同聊天的近期原话接续，经历在后台接着记。
      handoff.wait = Promise.race([handoff.task, new Promise((resolve) => { timer = setTimeout(resolve, 1500) })])
        .finally(() => clearTimeout(timer))
    }
    await handoff.wait
  }

  /** 拿到这个 QQ 会话对应的活 agent（没有就建，权限档位变了就换新会话）。 */
  async function agentFor(chat) {
    const cfg = getConfig()
    const level = chat.kind === 'system' ? (chat.noTools ? 'chat' : 'social') : levelFor(cfg, chat)
    const preset = presetFor(level, cfg)
    const entry = map().chats[chat.chatId]
    // 调试和正式用不同的会话：不然切回正式时，调试期间那些对话还在上下文里，等于被她"记住"了
    const mode = cfg.debug ? 'debug' : 'live'
    // 每种模式各记一条（entry.sessions）；老数据没有 mode / sessions 字段的一律当正式（来自原项目 2a89b90 / 141c145）
    const sameLevel = Boolean(entry && entry.preset === preset && entry.level === level)
    let sid = sameLevel ? ((entry.sessions && entry.sessions[mode]) || ((entry.mode || 'live') === mode ? entry.sessionId : '')) : ''
    let agent = null
    const revision = audienceRevision(chat.chatId)
    if (sid && (entry.privacyBlocked?.[mode] === sid || (revision && entry.privacyRevision?.[mode] !== revision))) {
      archiveQuietly(sid)
      sessionToChat.delete(sessionKey(sid))
      turnState.delete(sessionKey(sid))
      sid = ''
    }
    const reg = optionalService('workspaceRegistry')
    if (sid && chat.kind !== 'system' && (reg?.archivedSessionIds || []).includes(sid)) {
      sessionToChat.delete(sessionKey(sid))
      turnState.delete(sessionKey(sid))
      log.info(`${chat.chatId} 的会话已归档，下一轮用新会话`)
      sid = ''
    }
    if (sid) {
      try {
        agent = await resolveAgent(sid)
      } catch (error) {
        assertActive()
        log.warn(`会话 ${sid.slice(-8)} 恢复不了（${error.message}），换一个新的`)
        sid = ''
      }
      assertActive()
      if (sid && reg && (reg.archivedSessionIds || []).includes(sid)) {
        // 后台专用会话继续复用。用户归档的真实聊天下一轮换新。
        let restored = false
        try {
          if (chat.kind === 'system' && reg.unarchiveSession) {
            await reg.unarchiveSession(sid)
            restored = true
          }
        } catch (error) {
          log.debug(`会话 ${sid.slice(-8)} 解归档失败：${error.message}`)
        }
        if (restored) {
          log.info(`会话 ${sid.slice(-8)} 被归档了，已解归档，继续用这间`)
        } else {
          log.info(`会话 ${sid.slice(-8)} 被归档了，换一个新的`)
          sid = ''
          agent = null
        }
      }
    }
    // 心智核心：上下文快到 DSH 自动压缩之前、或者停了很久，就换新会话。
    // 不靠会话历史活着：新会话里接上的话由心智的感知记录给（见 seedHistoryOnce）。
    // 这一轮还在跑时不换（新消息是排队或插话进去的）。
    if (sid && getMind()?.shouldRotate && chat.kind !== 'system' && !running.has(chat.chatId)) {
      let reason = ''
      try {
        const t = targetModel(chat)
        const contextWindow = t ? await modelContextWindow(dsh, t.provider, t.model) : 0
        assertActive()
        reason = getMind().shouldRotate({ lastInput: Number(entry.lastInput) || 0, lastAt: Number(entry.lastAt || entry.createdAt) || 0, contextWindow })
      } catch (error) {
        log.debug('换会话判断失败（不换）：', error.message)
      }
      if (reason) {
        archiveQuietly(sid)
        log.info(`${chat.chatId} 换新会话（${reason}），旧会话 ${sid.slice(-8)} 保留历史`)
        sessionToChat.delete(sessionKey(sid))
        turnState.delete(sessionKey(sid))
        sid = ''
        agent = null
      }
    }
    if (!sid) {
      if (entry && mode === 'live') encodeForHandoff(chat.chatId)
      sid = await createSession(chat, level)
      assertActive()
      agent = await resolveAgent(sid)
    }
    assertActive()
    // 模型 / 思考强度和设置不一致就切过去（面板改了模型，下一条消息起生效）
    const target = await resolveTarget(chat)
    assertActive()
    const want = keyOf(target)
    const m = map()
    const entryModel = m.chats[chat.chatId]?.model
    const currentModel = typeof agent.model?.current === 'function' ? keyOf(agent.model.current()) : entryModel
    if (want && m.chats[chat.chatId] && (currentModel !== want || entryModel !== want)) {
      if (applyModel(agent, target)) {
        m.chats[chat.chatId].model = want
        saveMap(m)
        log.info(`${chat.chatId} 的模型切到 ${want}`)
      }
    }
    // 把这一轮实际用的会话写回映射：复用旧会话时映射可能还停在另一个模式那条，投递守卫会把回复当旧会话的丢掉（来自原项目 2ccbf73）
    const sync = map()
    const curEntry = sync.chats[chat.chatId] || {}
    if (curEntry.sessionId !== sid || (curEntry.mode || 'live') !== mode) {
      sync.chats[chat.chatId] = { ...curEntry, sessionId: sid, mode, sessions: { ...(curEntry.sessions || {}), [mode]: sid } }
      saveMap(sync)
    }
    sessionToChat.set(sessionKey(sid), chat.chatId)
    if (target) sessionTarget.set(sessionKey(sid), { provider: target.provider, model: target.model })
    mount(agent, chat, level)
    return { agent, sessionId: sid, level }
  }

  /**
   * 调试模式：把管理员私聊的调试会话先建出来。
   * 否则要等你先发一条 QQ 消息，侧栏里才会有会话可点 —— 而调试本来就是为了不碰 QQ。
   */
  return { resolveAgent, encodeForHandoff, waitForHandoff, agentFor }
}
