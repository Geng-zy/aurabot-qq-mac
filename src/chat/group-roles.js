// 她在每个群里的身份（群主 / 群管理员 / 普通成员）：决定能不能做群管。查一次缓存 10 分钟。

const TTL = 10 * 60_000
export const ROLE_LABEL = { owner: '群主', admin: '群管理员', member: '普通成员' }

export function createGroupRoles({ onebot, getConfig, log }) {
  const cache = new Map() // groupId → { role, at }
  const inflight = new Map()
  let botQQ = ''
  function currentAccount() {
    const account = String(getConfig().botQQ || '')
    if (account !== botQQ) {
      botQQ = account
      cache.clear()
      inflight.clear()
    }
    return account
  }

  /** 查身份（会等结果）。查不到返回 ''。 */
  async function get(gid, { fresh = false } = {}) {
    const account = currentAccount()
    if (!account) return ''
    const groupId = String(gid)
    const c = cache.get(groupId)
    if (!fresh && c && Date.now() - c.at < TTL) return c.role
    if (!inflight.has(groupId)) {
      const pending = Promise.resolve().then(async () => {
        const r = await onebot.call('get_group_member_info', { group_id: Number(gid), user_id: Number(account), no_cache: true }, { timeoutMs: 8000 })
        if (currentAccount() !== account || inflight.get(groupId) !== pending) return ''
        const role = Object.hasOwn(ROLE_LABEL, r?.role) ? r.role : ''
        if (role) cache.set(groupId, { role, at: Date.now() })
        else cache.delete(groupId)
        return role
      }).catch((error) => {
        log?.debug(`查群 ${gid} 里的身份失败：`, error.message)
        if (inflight.get(groupId) === pending) cache.delete(groupId)
        return ''
      }).finally(() => { if (inflight.get(groupId) === pending) inflight.delete(groupId) })
      inflight.set(groupId, pending)
    }
    return inflight.get(groupId)
  }

  /** 同步拿缓存（给每轮上下文用），过期就顺手在后台刷新。 */
  function peek(gid) {
    currentAccount()
    const c = cache.get(String(gid))
    if (c && Date.now() - c.at < TTL) return c.role
    get(gid).catch(() => {})
    return ''
  }

  const canManage = (role) => role === 'owner' || role === 'admin'

  return { get, peek, canManage, label: (role) => ROLE_LABEL[role] || '不清楚' }
}
