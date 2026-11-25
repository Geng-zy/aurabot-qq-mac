export function createSessionRecovery({ SESSION_BACKOFF, assertActive, dsh, isCurrentWorkspacePath, log, map, sessionFailures, sessionKey, sessionToChat, systemFailures, workspacePathOf, recordAttachFailure }) {
  function sessionFailure(chatId) {
    const failure = sessionFailures.get(chatId)
    // 管理员换了工作区后立即允许尝试，不把旧工作区的故障带过去。
    if (failure && failure.workspacePath !== workspacePathOf(chatId)) {
      sessionFailures.delete(chatId)
      return null
    }
    return failure
  }
  function backoffError(chatId, failure, cause) {
    return Object.assign(new Error(`${chatId}：会话冷却中，${Math.ceil(Math.max(0, failure.until - Date.now()) / 60_000)} 分钟后再试${failure.message ? `；${failure.message}` : ''}`, cause ? { cause } : undefined), {
      code: SESSION_BACKOFF, chatId, retryAt: failure.until,
    })
  }
  const systemChatId = (name, scope = '') => {
    const suffix = String(scope || '').trim().replace(/[^\w:-]/g, '').slice(0, 32)
    return suffix ? `system:${name}:${suffix}` : `system:${name}`
  }
  /** 某个后台用途的会话在冷却中吗。 */
  function systemSessionCooldown(name, { key = '' } = {}) {
    const chatId = systemChatId(name, key)
    const failure = [sessionFailure(chatId), systemFailures.get(chatId)].find((item) => item && Date.now() < item.until)
    return failure ? { ...failure, chatId, retryAt: failure.until } : null
  }
  function freshSessionId(error, ws) {
    const details = error?.details ?? error?.data
    const structured = error?.code === 'session/workspace-attach-failed'
    const match = structured ? null : String(error?.message || '').match(/session ["']([^"']+)["'] was created but could not attach to workspace ["']([^"']+)["']/i)
    const sid = structured ? details?.sessionId : match?.[1]
    if (typeof sid !== 'string' || !sid || (structured ? details?.workspaceId : match?.[2]) !== ws.id) return ''
    if (sessionToChat.has(sessionKey(sid)) || Object.values(map().chats).some((entry) =>
      [entry.sessionId, ...Object.values(entry.sessions || {})].some((id) => sessionKey(id) === sessionKey(sid)))) return ''
    return sid
  }

  function workspaceHasSession(workspace, sid) {
    return (workspace.sessionIds || []).some((id) => sessionKey(id) === sessionKey(sid))
  }

  function recoveryWorkspace(ws, sid) {
    const reg = dsh.workspaceRegistry || dsh.get('workspaceRegistry')
    const workspaces = reg?.list?.() || []
    const current = workspaces.find((entry) => entry.id === ws.id && entry.path === ws.path)
    if (!current ||
        workspaces.some((entry) => entry.id !== ws.id && workspaceHasSession(entry, sid)) ||
        (reg.archivedSessionIds || []).some((id) => sessionKey(id) === sessionKey(sid))) return null
    return current
  }

  function recoveredAttachStillCurrent(ws, sid, workspacePath) {
    if (!isCurrentWorkspacePath(workspacePath)) return false
    const current = recoveryWorkspace(ws, sid)
    return Boolean(current && workspaceHasSession(current, sid))
  }

  async function recoverSessionAttach(error, ws, workspacePath, assertCurrent) {
    if (error?.code !== 'session/workspace-attach-failed' || !isCurrentWorkspacePath(workspacePath)) return ''
    const sid = freshSessionId(error, ws)
    if (!sid) return ''
    const current = recoveryWorkspace(ws, sid)
    if (!current) return ''
    assertActive()
    assertCurrent?.()
    if (!workspaceHasSession(current, sid) && typeof current.attachSession === 'function') {
      try { await current.attachSession(sid) }
      catch (cause) { log.debug?.('重试挂载新会话失败：', cause.message) }
    }
    assertActive()
    assertCurrent?.()
    return recoveredAttachStillCurrent(ws, sid, workspacePath) ? sid : ''
  }

  /** 只处理 create 确认的新会话，已有归属或已归档的会话交给宿主管理。 */
  async function cleanOrphan(error, ws, c) {
    const sid = freshSessionId(error, ws)
    const reg = dsh.workspaceRegistry || dsh.get('workspaceRegistry')
    if (!sid || (reg?.list?.() || []).some((workspace) => workspaceHasSession(workspace, sid)) ||
        (reg?.archivedSessionIds || []).some((id) => sessionKey(id) === sessionKey(sid))) {
      log.debug?.('新会话挂载失败：无法确认孤儿会话身份，未清理')
      return
    }
    const cleanup = typeof c.delete === 'function' ? c.delete : typeof c.close === 'function' ? c.close : null
    const archive = !cleanup && error?.code === 'session/workspace-attach-failed' && typeof reg?.archiveSession === 'function'
    if (!cleanup && !archive) { log.debug?.(`孤儿会话 ${sid} 无法清理：宿主 sessionController 没有删除或关闭接口`); return }
    try {
      const result = cleanup ? await cleanup.call(c, { sessionId: sid }) : await reg.archiveSession(sid)
      if (result === false || result?.ok === false) throw new Error(result?.message || '宿主拒绝清理')
      log.debug?.(`已${archive ? '归档' : '清理'}未挂上工作区的孤儿会话 ${sid}`)
    } catch (cleanupError) {
      log.debug?.(`孤儿会话 ${sid} 清理失败：${cleanupError.message}`)
    }
  }

  return { sessionFailure, backoffError, systemSessionCooldown, freshSessionId, workspaceHasSession, recoveryWorkspace, recoveredAttachStillCurrent, recoverSessionAttach, cleanOrphan, recordAttachFailure }
}
