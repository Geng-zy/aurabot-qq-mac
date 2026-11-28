// 认识的人：people 表的读写、名字与曾用名、以及「这两个 id 是同一个人」的合并。
// 从 mind/index.js 抽出来：那边是心智各层的装配，这一支只碰 people 表与 id 归一表。

export function createPeople({ store, canon, sameMap, isOwner, setOwnerId, memory, log, now }) {
  function person(id) {
    const row = store.prep('SELECT json FROM people WHERE id = ?').get(canon(id))
    return row ? JSON.parse(row.json) : null
  }
  /** 记下或更新一个人：名字变了会留下曾用名。 */
  function notePerson(id, { name } = {}) {
    const key = canon(id)
    const p = person(key) || { id: key, name: '', aliases: [], firstSeen: now(), lastSeen: 0 }
    const n = String(name || '').trim()
    if (n && n !== p.name) {
      if (p.name && !p.aliases.includes(p.name)) p.aliases.push(p.name)
      p.name = n
    }
    p.lastSeen = now()
    store.prep('INSERT INTO people (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(key, JSON.stringify(p))
    return p
  }
  function listPeople() {
    return store.prep('SELECT json FROM people').all().map((r) => JSON.parse(r.json))
  }
  function savePerson(p) {
    const id = canon(p.id)
    store.prep('INSERT INTO people (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(id, JSON.stringify({ ...p, id }))
  }

  /**
   * 「这两个 id 是同一个人」（比如管理员的 QQ 和微信）：other 并进 main。
   * 名字留作曾用名，关系以 main 的为准（main 还没有就用 other 的），原话和经历里的 id 都改成 main。
   * 以后 other 发来的消息都算 main 的。
   */
  function linkPerson(otherId, mainId) {
    const other = String(otherId || '').trim()
    const main = canon(mainId)
    if (!other || !main || canon(other) === main) return { ok: false, message: canon(other) === main ? '已经是同一个人了' : 'id 是空的' }
    if (isOwner(other) && !isOwner(main)) return { ok: false, message: '要把别的 id 连到管理员身上，不能反过来' }
    const from = canon(other)
    store.tx(() => {
      const map = sameMap()
      // 原来连到 from 的也都改连 main
      for (const [k, v] of Object.entries(map)) if (v === from) map[k] = main
      map[from] = main
      if (other !== from) map[other] = main
      store.set('person.same', map)
      const a = store.prep('SELECT json FROM people WHERE id = ?').get(from)
      const b = store.prep('SELECT json FROM people WHERE id = ?').get(main)
      const pa = a ? JSON.parse(a.json) : null
      const pb = b ? JSON.parse(b.json) : { id: main, name: pa?.name || '', aliases: [], firstSeen: pa?.firstSeen || now(), lastSeen: 0 }
      if (pa) {
        const names = [pa.name, ...(pa.aliases || [])].filter((n) => n && n !== pb.name && !(pb.aliases || []).includes(n))
        pb.aliases = [...(pb.aliases || []), ...names]
        pb.firstSeen = Math.min(pb.firstSeen || Infinity, pa.firstSeen || Infinity)
        pb.lastSeen = Math.max(pb.lastSeen || 0, pa.lastSeen || 0)
        if (!pb.rel && pa.rel) pb.rel = pa.rel
        if (!pb.tom && pa.tom) pb.tom = pa.tom
        store.prep('DELETE FROM people WHERE id = ?').run(from)
      }
      pb.ids = [...new Set([...(pb.ids || []), ...(pa?.ids || []), from, other])].filter((x) => x !== main)
      store.prep('INSERT INTO people (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(main, JSON.stringify({ ...pb, id: main }))
      store.prep('UPDATE perception SET who = ? WHERE who = ?').run(main, from)
      const q = JSON.stringify(from)
      store.prep('UPDATE episodes SET json = replace(json, ?, ?) WHERE instr(json, ?) > 0').run(q, JSON.stringify(main), q)
    })
    if (isOwner(main)) { setOwnerId(main); memory.touchAudience() }
    log.info(`${other} 和 ${main} 连成了同一个人`)
    return { ok: true, main }
  }
  /** 这个人连着哪些 id（含主 id）。 */
  function idsOf(id) {
    const main = canon(id)
    return [main, ...Object.entries(sameMap()).filter(([, v]) => v === main).map(([k]) => k)]
  }


  return { person, notePerson, listPeople, savePerson, linkPerson, idsOf }
}
