// 心智概览和记忆列表/删除/加强/私密/分享路由。

import { LEGACY_PLATFORM, normChat, parseChat } from '../channels/index.js'
import { MIND_OFF } from '../panel/route-kit.js'

export function registerMindMemoryRoutes({ route, readBody, query, getMind }) {

  route('/mind/state', async () => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    const m = mind.mind
    return {
      ok: true,
      status: m.status(),
      usage: m.budget.spent(),
      sleep: m._store.get('sleep.lastReport', null),
      dreams: m._store.get('dreams.log', []).slice(0, 10),
      pending: m.memory.pendingWindows().length,
      deferredThoughts: m.inner.deferredCount(),
    }
  })

  route('/mind/vectors', async () => {
    const mind = getMind()
    return mind ? { ok: true, ...mind.mind.memory.vectorProgress(), ...mind.embeddingStatus() } : MIND_OFF
  })

  route('/mind/memories', async (req) => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    const qs = query(req)
    const status = ['live', 'archived'].includes(qs.status) ? qs.status : 'live'
    const limit = Math.max(1, Math.min(200, Math.trunc(Number(qs.limit)) || 200))
    const offset = Math.max(0, Math.min(1_000_000, Math.trunc(Number(qs.offset)) || 0))
    const memory = mind.mind.memory
    const items = memory.list({ status, kind: qs.kind || '', q: String(qs.q || '').slice(0, 100), limit: limit + 1, offset })
    return {
      ok: true,
      items: items.slice(0, limit),
      next: items.length > limit ? offset + limit : null,
      counts: memory.counts(),
      ...(offset ? {} : { sources: memory.sourceCounts(status) }),
    }
  })

  route('/mind/memory/related', async (req) => {
    const mind = getMind()
    return mind ? { ok: true, items: mind.mind.memory.related(String(query(req).id || '').slice(0, 200)) } : MIND_OFF
  })

  route('/mind/memory/delete', async (req) => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    const b = await readBody(req)
    const deleted = mind.mind.memory.deleteEpisode(String(b.id || ''))
    if (deleted) mind.invalidateMemory()
    return deleted ? { ok: true, message: '已删除。有关的记忆、人格证据和故事会随之删除或重算。' } : { ok: false, message: '没有这条' }
  })

  route('/mind/memory/boost', async (req) => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    const b = await readBody(req)
    return mind.mind.memory.boost(String(b.id || '')) ? { ok: true, message: '加强了，她会记得更牢' } : { ok: false, message: '没有这条' }
  })

  route('/mind/memory/private', async (req) => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    const b = await readBody(req)
    const ok = mind.mind.memory.setPrivateOnly(String(b.id || ''), b.enabled === true)
    if (ok) mind.invalidateMemory()
    return { ok, message: ok ? (b.enabled ? '仅在与你的私聊中使用' : '已取消手动限制') : '没有这条记忆' }
  })

  route('/mind/memory/share', async (req) => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    if (req.method !== 'POST') return { ok: false, message: '请在记忆面板操作' }
    const b = await readBody(req)
    const target = parseChat(b.audience)
    if (!target || (target.platform === LEGACY_PLATFORM && !/^\d+$/.test(target.id))) return { ok: false, message: '群号或账号格式不正确' }
    const id = mind.mind.memory.shareEpisode(String(b.id || ''), { text: b.text, audience: normChat(b.audience) })
    mind.invalidateMemory()
    return { ok: true, id, message: '已保存。这段内容可以在指定会话里提起。' }
  })

  route('/mind/memory/share/revoke', async (req) => {
    const mind = getMind()
    if (!mind) return MIND_OFF
    if (req.method !== 'POST') return { ok: false, message: '请在记忆面板操作' }
    const b = await readBody(req)
    const ok = mind.mind.memory.revokeShare(String(b.id || ''))
    if (ok) mind.invalidateMemory()
    return { ok, message: ok ? '已撤回分享' : '没有这个分享' }
  })
}
