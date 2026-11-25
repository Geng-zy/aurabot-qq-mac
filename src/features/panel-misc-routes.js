// 面板杂项路由：日志、命令清单、更新说明、群/好友名称和工作区搬家。
// 这些只读或单一副作用入口从 host.js 拆出，避免宿主继续堆路由。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function registerPanelMiscRoutes({
  route, readBody, query, logger, mods, commandList, root, version, changelogSection,
  getConfig, qq, onebot, moveWorkspace, workspaceDirOf, log,
}) {
  route('/logs', async (req) => {
    const q = query(req)
    return { ok: true, entries: logger.recent(Number(q.limit) || 300, { level: q.level || '', area: q.area || '' }) }
  })

  route('/commands', async () => ({ ok: true, list: commandList(mods.commands()) }))

  route('/access/chat-names', async () => {
    const cfg = getConfig()
    const namesOf = async (action, idKey, nameKey, kind) => {
      if (!cfg.allow[kind].length || !qq.ready()) return {}
      const bot = cfg.botQQ
      try {
        const rows = await onebot.call(action, {}, { wsOnly: true, timeoutMs: 2500 })
        if (getConfig().botQQ !== bot || !qq.ready()) return {}
        const allowed = new Set(cfg.allow[kind])
        return Object.fromEntries((Array.isArray(rows) ? rows : []).flatMap((row) => {
          const id = String(row?.[idKey] ?? '')
          const name = String(row?.[nameKey] ?? '').trim().slice(0, 100)
          return name && allowed.has(id) ? [[id, name]] : []
        }))
      } catch { return {} }
    }
    const [privates, groups] = await Promise.all([
      namesOf('get_friend_list', 'user_id', 'nickname', 'private'),
      namesOf('get_group_list', 'group_id', 'group_name', 'groups'),
    ])
    return { ok: true, private: privates, groups }
  })

  // 版本更新交给 DSH 插件管理器；这里只保留只读的更新说明。
  route('/changelog', async () => {
    let text = ''
    try { text = readFileSync(join(root, 'CHANGELOG.md'), 'utf8') } catch {}
    return { ok: true, version, notes: changelogSection(text, version) }
  })

  route('/workspace/move', async (req) => {
    const r = moveWorkspace(workspaceDirOf(getConfig()), (await readBody(req)).to)
    if (r.ok) log.info(r.message)
    return r
  })
}
