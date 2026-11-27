/**
 * 该把哪条预设记成「这个会话的当前预设」。
 *
 * 踩过的坑（1.6.61 在 mini 上抓到）：重挂到**已有**会话时（workspace attach 失败后的
 * recoverSessionAttach），我们仍把「这次请求的预设」记成当前预设，而那个会话的真实 header
 * 是它当初创建时的预设 —— 于是「登记的预设」和「实际跑的预设」不一致，
 * 后续按预设注入人格/规则就会用错那一套。
 *
 * 规则：宿主报了就用宿主的（最权威）；新建且宿主没报才用请求值；重挂且宿主没报就不猜 ——
 * 留给 presetOfAgent 回落到 agent.preset / session.header（那才是事实）。
 */
export function presetToNote({ reported = '', requested = '', recovered = false } = {}) {
  const fromHost = String(reported || '')
  if (fromHost) return fromHost
  if (recovered) return ''
  return String(requested || '')
}

export function createSessionCreate({
  notePreset = () => {}, SESSION_BACKOFF_MS, assertActive, audienceRevision, backoffError, cleanOrphan, controller, ensureWorkspace, getConfig, isDisposed, log, map, parseChat, presetFor, recoverSessionAttach, recoveredAttachStillCurrent, saveMap, sessionCreating, sessionFailure, sessionFailures, titleFor, workspaceDirOf }) {
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
    // 记下「这个会话跑的是哪个预设」：宿主 header 只是创建事实，中途换预设时它会过期。
    // 但只记**可信**的值：宿主回报的优先；重挂到已有会话且宿主没回报时宁可不记。
    const toNote = presetToNote({
      reported: r?.agent?.preset || r?.preset || r?.agentPreset || '',
      requested: preset,
      recovered: Boolean(recoveredFrom),
    })
    if (toNote) { try { notePreset(r.sessionId, toNote, { source: 'create' }) } catch {} }
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
