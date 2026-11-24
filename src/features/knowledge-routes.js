// 知识库面板路由：列表、读取、搜索和写操作。读写规则仍由 features/knowledge.js 决定。

export function registerKnowledgeRoutes({ route, readBody, query, knowledge }) {
  route('/knowledge/list', async () => ({ ok: true, list: knowledge.list() }))
  route('/knowledge/read', async (req) => {
    const r = knowledge.read(String(query(req).path || ''), { limit: 30000, admin: true })
    return r ? { ok: true, ...r } : { ok: false, message: '读不到这个知识库文件' }
  })
  route('/knowledge/search', async (req) => {
    const q = String(query(req).q || '').trim()
    const limit = Math.max(1, Math.min(50, Number(query(req).limit) || 20))
    const offset = Math.max(0, Number(query(req).offset) || 0)
    const list = q ? knowledge.search(q, { limit, offset, admin: true }) : []
    return { ok: true, list, hasMore: list.length >= limit }
  })
  route('/knowledge/rename', async (req) => {
    if (req?.method !== 'POST') return { ok: false, message: '要用 POST' }
    let b = {}
    try { b = await readBody(req) || {} } catch (error) { return { ok: false, message: error.message || '请求内容不对' } }
    return knowledge.rename(String(b.path || ''), String(b.title || ''))
  })
  route('/knowledge/delete', async (req) => {
    if (req?.method !== 'POST') return { ok: false, message: '要用 POST' }
    let b = {}
    try { b = await readBody(req) || {} } catch (error) { return { ok: false, message: error.message || '请求内容不对' } }
    return knowledge.remove(String(b.path || ''))
  })
  route('/knowledge/note', async (req) => {
    if (req?.method !== 'POST') return { ok: false, message: '要用 POST' }
    let b = {}
    try { b = await readBody(req) || {} } catch (error) { return { ok: false, message: error.message || '请求内容不对' } }
    return knowledge.createNote(String(b.title || ''), String(b.content || ''), { scope: b.scope == null ? undefined : String(b.scope), folder: String(b.folder || '') })
  })
  route('/knowledge/scope', async (req) => {
    if (req?.method !== 'POST') return { ok: false, message: '要用 POST' }
    let b = {}
    try { b = await readBody(req) || {} } catch (error) { return { ok: false, message: error.message || '请求内容不对' } }
    if (b.scope == null) return { ok: false, message: '改范围必须明确指定 scope（公开请写 all）' }
    return knowledge.setScope(String(b.path || ''), String(b.scope))
  })
}
