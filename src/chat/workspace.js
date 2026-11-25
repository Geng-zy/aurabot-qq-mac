export function createWorkspaceHelpers({ channels, chatInfo, dsh, getConfig, groupKey, groupNames, log, mkdirSync, ownerLabel, parseChat, workspaceDirOf, workspaceTitleOf }) {
  async function ensureWorkspace(platform = 'qq') {
    const reg = dsh.workspaceRegistry || dsh.get('workspaceRegistry')
    if (!reg) throw new Error('宿主没有 workspaceRegistry')
    const dir = workspaceDirOf(getConfig(), platform)
    mkdirSync(dir, { recursive: true })
    const norm = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase()
    let ws = reg.list().find((w) => norm(w.path) === norm(dir))
    if (!ws) {
      const title = workspaceTitleOf(platform)
      ws = await reg.create(dir, title)
      log.info('建好了工作区「' + title + '」：' + dir)
    }
    return ws
  }

  function controller() {
    const c = dsh.get('sessionController')
    if (!c) throw new Error('宿主没有 sessionController（需要 DSH 桌面版 / Web 组合）')
    return c
  }

  function platformLabel(chatId) {
    const platform = parseChat(chatId)?.platform || channels.platforms?.()[0]
    return channels.get(platform)?.label || (platform === 'qq' ? 'QQ' : platform || '平台')
  }
  function titleFor(chat) {
    const owner = ownerLabel()
    const label = platformLabel(chat.chatId)
    if (chat.kind === 'system') {
      // 扩展模块传进来的 title 可能自带「QQ · 」前缀，别再拼一次
      const t = String(chat.title || '后台')
      return t.startsWith(`${label} · `) ? t : `${label} · ${t}`
    }
    if (chat.kind === 'group') return `${label} 群 · ${groupNames.get(groupKey(chat.chatId)) || chat.groupId}`
    const info = chatInfo(chat.chatId)
    const ownerId = String(getConfig().platforms?.[info.platform]?.ownerQQ || getConfig().ownerQQ || '')
    return info.id === ownerId ? `${label} · ${owner}私聊` : `${label} 私聊 · ${chat.nickname || chat.userId}`
  }

  // ---------- 新会话挂不上工作区：按 1、5、15、30、60 分钟退避（来自原项目 4d65ee7） ----------
  const workspacePlatform = (chatId) => parseChat(chatId)?.platform || 'qq'
  const workspacePathOf = (chatId) => workspaceDirOf(getConfig(), workspacePlatform(chatId))
  const isCurrentWorkspacePath = (path) => channels.platforms().some((p) => workspaceDirOf(getConfig(), p) === path)
  return { ensureWorkspace, controller, platformLabel, titleFor, workspacePathOf, isCurrentWorkspacePath }
}
