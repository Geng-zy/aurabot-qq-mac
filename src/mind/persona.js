// 人格卡与自我：她的人格卡（管理员写的/她自己改的/迁移来的）、公开人格卡、以及「这个窗口是不是管理员」的判断。
// 从 mind/index.js 抽出来：这一支只碰 self / versions 两张表与 id 归一。

import { publicPersonaStyle } from './self/public-style.js'

export function createPersona({ store, opts, now, place, isOwner, canon, privateOwners, addVersion, log }) {
  // ---------- 人格卡与自我（带版本） ----------
  function personaCard() {
    return store.get('self.persona', '')
  }
  function lastOwnerPersona() {
    const saved = store.get('self.publicPersona', null)
    if (saved) return saved
    const last = store.prep("SELECT json FROM versions WHERE kind = 'persona' AND by IN ('owner', 'migration') AND coalesce(json_extract(json, '$.published'), 1) = 1 ORDER BY id DESC LIMIT 1").get()
    return last ? JSON.parse(last.json) : { card: '', name: '', nickname: '' }
  }
  function publicPersona() {
    return { card: publicPersonaStyle(lastOwnerPersona().card), name: String(opts.publicName || '').trim() }
  }
  /**
   * 写人格卡。by：'owner' 管理员在面板里改；'self' 她自己改；'migration' 迁移。
   * 每次都存一个版本，带理由。
   */
  function setPersonaCard(text, { by = 'owner', reason = '', name, nickname, publish = by === 'owner' || by === 'migration' } = {}) {
    const card = String(text || '')
    return store.tx(() => {
      const self = store.get('self', { name: '', nickname: '' })
      if (name !== undefined) self.name = String(name || '').trim()
      if (nickname !== undefined) self.nickname = String(nickname || '').trim()
      const version = { card, name: self.name, nickname: self.nickname }
      store.set('self.publicPersona', publish ? version : lastOwnerPersona())
      store.set('self', self)
      store.set('self.persona', card)
      return addVersion('persona', { ...version, published: publish }, { by, reason })
    })
  }
  function isOwnerWindow(window) {
    const audience = place(window)
    return audience.kind === 'private' && isOwner(audience.platform ? `${audience.platform}:${audience.id}` : audience.id)
  }
  function isPrivateHistoryWindow(window) {
    const source = place(window)
    if (source.kind !== 'private') return false
    const id = source.platform ? `${source.platform}:${source.id}` : source.id
    return isOwner(id) || privateOwners.has(canon(id))
  }


  return { personaCard, lastOwnerPersona, publicPersona, setPersonaCard, isOwnerWindow, isPrivateHistoryWindow }
}
