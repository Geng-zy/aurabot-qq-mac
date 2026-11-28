// 同一个人在不同平台的 id：连起来以后都算同一个人（记忆、关系、管理员身份都通用）。
// kv 'person.same'：{ 别的 id → 主 id }，只有一层。从 mind/index.js 抽出来，只碰 kv。

export function createIdentityMap({ store, opts }) {
  // 管理员或朋友在 QQ、微信、飞书上各有一个 id：连起来以后都算同一个人。
  function sameMap() { return store.get('person.same', {}) || {} }
  /** 这个 id 实际是谁（连过就给主 id）。 */
  function canon(id) {
    const k = String(id || '')
    return (k && sameMap()[k]) || k
  }
  let ownerId = canon(opts.ownerId || '')
  const privateOwners = new Set(store.get('identity.privateOwners', []))
  function keepOwnerPrivate(id) {
    if (!id || privateOwners.has(id)) return
    privateOwners.add(id)
    store.set('identity.privateOwners', [...privateOwners])
  }
  keepOwnerPrivate(ownerId)

  const getOwnerId = () => ownerId
  const setOwnerId = (next) => { ownerId = next; keepOwnerPrivate(ownerId) }

  return { sameMap, canon, getOwnerId, setOwnerId, keepOwnerPrivate, privateOwners }
}
