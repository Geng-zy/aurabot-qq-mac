// 工作区级「授权/提问」上报开关和聊天秘书记录。

export function registerNoticeRoutes({ route, readBody, query, getConfig, setConfig, workspaceList, normalizeWorkspace, hub }) {
  route('/notice/state', async () => {
    const n = getConfig().notice || {}
    const workspaces = workspaceList().map((w) => {
      const path = String(w?.path || '')
      const o = n.workspaces?.[normalizeWorkspace(path)] || {}
      return {
        path,
        name: String(w?.name || path.split(/[\\/]/).filter(Boolean).pop() || path),
        sessions: Array.isArray(w?.sessionIds) ? w.sessionIds.length : 0,
        approval: typeof o.approval === 'boolean' ? o.approval : n.approval !== false,
        question: typeof o.question === 'boolean' ? o.question : n.question !== false,
      }
    })
    return { ok: true, enabled: n.enabled !== false, approval: n.approval !== false, question: n.question !== false, workspaces }
  })

  route('/notice/toggle', async (req) => {
    const b = await readBody(req)
    const kind = b.kind === 'question' ? 'question' : 'approval'
    const value = b.value !== false
    const notice = structuredClone(getConfig().notice || {})
    notice.workspaces = notice.workspaces || {}
    const ws = String(b.workspace || '').trim()
    if (ws) {
      if (!ws.startsWith('/')) return { ok: false, message: '工作区要填完整路径' }
      const key = normalizeWorkspace(ws)
      notice.workspaces[key] = { ...(notice.workspaces[key] || {}), [kind]: value }
    } else {
      notice[kind] = value
    }
    setConfig({ ...getConfig(), notice })
    return { ok: true, notice: getConfig().notice }
  })

  route('/chat/secretary', async (req) => {
    const chatId = String(query(req).chatId || '')
    return { ok: true, list: hub?.secretaryLog?.(chatId) || [], stats: hub?.secretaryStats?.(chatId) || {} }
  })
  route('/chat/secretary/export', async () => ({ ok: true, stats: hub?.secretaryStats?.() || {} }))
}
