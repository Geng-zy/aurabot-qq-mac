// 权限申请：她想要一项还没有的权限时，通过管理员私聊申请；也负责批准/撤销。
export function createPermission({ mind, ownerOf, ownerChat, isOwnerChat, personIn, parseChat, now, reachOwner, getConfig, isClosed }) {
  function grantState() {
    return mind._store.get('grants', { next: 1, requests: [], granted: {} })
  }
  // 给她自由（默认）：她能做的都由她自己决定，不用申请，所以都算批了
  const free = () => getConfig()?.freedom !== false
  function granted(key) {
    if (free()) return Boolean(key)
    return Boolean(key && grantState().granted[key])
  }
  async function requestPermission(key, what, why) {
    if (!ownerChat() || typeof reachOwner !== 'function') return { ok: false, message: '没有可用的管理员私聊' }
    const g = grantState()
    const k = String(key || what || '').trim().slice(0, 60)
    if (!k) return { ok: false, message: '要申请什么？' }
    if (g.granted[k]) return { ok: true, message: '这项已经批过了' }
    const open = g.requests.find((r) => r.key === k && r.status === 'pending')
    if (open) return { ok: false, message: `已经问过了（#${open.n}），等管理员回` }
    const n = g.next++
    g.requests.unshift({ n, key: k, what: String(what || k).slice(0, 120), why: String(why || '').slice(0, 200), at: now(), status: 'pending' })
    g.requests = g.requests.slice(0, 100)
    mind._store.set('grants', g)
    const result = await reachOwner(`你想向管理员申请一项权限：${String(what || k).slice(0, 120)}。原因：${String(why || '').slice(0, 200)}。用你自己的话问他，说清楚要什么、为什么；最后一定要写上「同意请回：同意 #${n}，不同意请回：不同意 #${n}」。`, { kind: 'permission' })
    if (!result.ok) {
      if (!isClosed()) {
        const latest = grantState()
        latest.requests = latest.requests.filter((r) => r.n !== n || r.status !== 'pending')
        mind._store.set('grants', latest)
      }
      return { ok: false, message: result.summary }
    }
    return { ok: true, message: `问了（#${n}），等管理员在私聊里回` }
  }
  function checkApproval(msg) {
    if (!isOwnerChat(msg.chatId) || personIn(msg.chatId, msg.userId) !== ownerOf()) return null
    const t = String(msg.text || '')
    const m = t.match(/(不同意|拒绝|不行|不批)\s*#\s*(\d+)/) || t.match(/(同意|批准|准了|可以)\s*#\s*(\d+)/)
    if (!m) return null
    return decide(Number(m[2]), !/不|拒绝/.test(m[1]), parseChat(msg.chatId).platform)
  }
  function decide(n, yes, via = 'panel') {
    const g = grantState()
    const r = g.requests.find((x) => x.n === n)
    if (!r || r.status !== 'pending') return null
    r.status = yes ? 'granted' : 'denied'
    r.decidedAt = now()
    r.via = via
    if (yes) g.granted[r.key] = { at: now(), n }
    mind._store.set('grants', g)
    mind.emotion.feel([{ name: yes ? '快乐' : '失落', intensity: 0.4, target: ownerOf(), why: (yes ? '批准了' : '没批准') + r.what.slice(0, 20), importance: 0.4 }], { source: 'permission' })
    return { n, key: r.key, granted: yes }
  }
  function revoke(key) {
    const g = grantState()
    delete g.granted[key]
    for (const r of g.requests) if (r.key === key && r.status === 'granted') r.status = 'revoked'
    mind._store.set('grants', g)
  }
  return { grantState, free, granted, requestPermission, checkApproval, decide, revoke }
}
