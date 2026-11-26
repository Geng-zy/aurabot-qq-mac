export function createSessionCreate({ SESSION_BACKOFF_MS, assertActive, audienceRevision, backoffError, cleanOrphan, controller, ensureWorkspace, getConfig, isDisposed, log, map, parseChat, presetFor, recoverSessionAttach, recoveredAttachStillCurrent, saveMap, sessionCreating, sessionFailure, sessionFailures, titleFor, workspaceDirOf }) {
  async function createSession(chat, level, assertCurrent) {
    const failure = sessionFailure(chat.chatId)
    if (failure && Date.now() < failure.until) throw backoffError(chat.chatId, failure)
    // 正式和调试是两条会话：按模式分开去重，切模式时不会被在途的旧创建挡住
    const creatingKey = chat.chatId + ':' + (getConfig().debug ? 'debug' : 'live')
    if (sessionCreating.has(creatingKey)) return sessionCreating.get(creatingKey)
    const task = Promise.resolve().then(() => createSessionNow(chat, level, assertCurrent))
    sessionCreating.set(creatingKey, task)
    try { return await task } finally { if (sessionCreating.get(creatingKey) === task) sessionCreating.delete(creatingKey) }
  }

  async function recordAttachFailure(chat, workspacePath, ws, c, error) {
    const previous = sessionFailure(chat.chatId)
    const count = (previous?.count || 0) + 1
    const tier = Math.min(count - 1, chat.kind === 'system' ? SESSION_BACKOFF_MS.length - 1 : 1)
    const delay = SESSION_BACKOFF_MS[tier]
    const message = `DSH 无法把新会话挂到工作区 ${workspacePath}，可在 DSH 里检查该工作区或删掉重建`
    const failure = { count, tier, until: Date.now() + delay, workspacePath, message, error: String(error?.message || error) }
    sessionFailures.set(chat.chatId, failure)
    if (!previous || tier > previous.tier) log.warn(`${chat.chatId}：${message}；${delay / 60_000} 分钟后再试${chat.kind === 'system' ? '' : '；QQ 消息已保留，下次消息到来时重试'}`)
    try { await cleanOrphan(error, ws, c) } catch (cleanupError) { log.debug?.(`检查孤儿会话失败，未清理：${cleanupError.message}`) }
    assertActive()
    throw backoffError(chat.chatId, failure, error)
  }

  async function createSessionNow(chat, level, assertCurrent) {
    const platform = parseChat(chat.chatId)?.platform || 'qq'
    const workspacePath = workspaceDirOf(getConfig(), platform)
    const ws = await ensureWorkspace(platform)
    assertActive()
    const preset = presetFor(level, getConfig())
    const c = controller()
    let r, recoveredFrom
    try {
      r = await c.create({ workspaceId: ws.id, agentPreset: preset })
    } catch (error) {
      if (isDisposed() || !(error?.code === 'session/workspace-attach-failed' || /could not attach to workspace/i.test(String(error?.message || '')))) throw error
      const recovered = await recoverSessionAttach(error, ws, workspacePath, assertCurrent)
      assertActive()
      if (recovered) {
        r = { sessionId: recovered }
        recoveredFrom = error
      } else {
        await recordAttachFailure(chat, workspacePath, ws, c, error)
      }
    }
    assertActive()
    // 调试会话和正式会话分开，标题也标出来，免得在侧栏里点错
    const debug = getConfig().debug
    const title = titleFor(chat) + (debug ? '（调试）' : '')
    const sid = String(r.sessionId)
    try {
      await controller().rename({ sessionId: sid, title })
    } catch (error) {
      log.debug('改会话标题失败：', error.message)
    }
    // 旧实例在创建或改名期间卸载时，不能覆盖新实例的会话映射。
    assertActive()
    assertCurrent?.()
    if (recoveredFrom) {
      if (!recoveredAttachStillCurrent(ws, sid, workspacePath)) await recordAttachFailure(chat, workspacePath, ws, c, recoveredFrom)
      log.info(`${chat.chatId}：已将原会话重新挂到工作区`)
    }
    sessionFailures.delete(chat.chatId)
    const m = map()
    const prev = m.chats[chat.chatId] || {}
    const mode = debug ? 'debug' : 'live'
    // 每种模式各记一条：切回调试 / 正式时能接上原来那条；档位（preset / level）变了就都作废（来自原项目 2a89b90）
    const sessions = prev.preset === preset && prev.level === level ? { ...(prev.sessions || {}) } : {}
    const privacyRevision = { ...prev.privacyRevision, [mode]: audienceRevision(chat.chatId) }
    if (prev.sessionId && prev.preset === preset && prev.level === level && !sessions[prev.mode || 'live']) sessions[prev.mode || 'live'] = prev.sessionId
    sessions[mode] = sid
    m.chats[chat.chatId] = { ...prev, sessionId: sid, mode, sessions, privacyRevision, preset, level, createdAt: Date.now(), lastInput: 0, lastAt: 0, title }
    saveMap(m)
    log.info(`为 ${chat.chatId} 新建了 DSH 会话 ${sid.slice(-8)}（${preset}${debug ? '，调试' : ''}）`)
    return sid
  }

  return { createSession, createSessionNow, recordAttachFailure }
}
