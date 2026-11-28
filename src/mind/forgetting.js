// 忘掉一个人：把人相关的事移进恢复区，能整份放回来；管理员不能忘。
// 从 mind/index.js 抽出来：那边是心智各层的装配，这一支要碰记忆、情绪、会话、内心四层，
// 把「碰谁」收成一组注入（getMemory/getEmotion/getConversation/getInner），模块内部只调用、不自己找。
//
// 规矩（原样保留）：
//   - 主要关于他、他说的、只涉及他的经历，以及和他的私聊、他说过的原话 → 恢复区；
//   - 和别人一起经历、他只是在场的事留着（那也是别人的记忆）；
//   - 管理员不能忘；恢复区留 30 天，过期才真删；
//   - keepPerson 时人留着但标成「以后不记」。

export function createForgetting({
  store, canon, isOwner, person, savePerson, now, log,
  getMemory, getEmotion, getConversation, getInner,
  recordDeletion, writeDeletion, addVersion, GENERATED_COLUMNS,
}) {
  // 删掉的东西先放进恢复区（kv 里 forgotten:<id>），FORGET_KEEP_DAYS 天内能整份放回去，过期才真的没了。
  const FORGET_KEEP_DAYS = 30
  const forgottenKey = (id) => 'forgotten:' + id
  /** 一行原样放回去（列名照原来的）。 */
  function putRow(table, r) {
    const skip = GENERATED_COLUMNS[table] || new Set()
    const cols = Object.keys(r).filter((c) => !skip.has(c))
    store.prep(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => r[c]))
  }
  /**
   * 忘掉一个人：关于他的事（主要关于他、他说的、只涉及他的）、和他的私聊、他说过的原话都移进恢复区。
   * 和别人一起经历、他只是在场的事留着（那也是别人的记忆）。管理员不能忘。
   * @param {string} id 人的 id（例如 qq:12345）
   * @param {{ keepPerson?: boolean, windows?: string[] }} [o]
   *   keepPerson：人留着、标成「以后不记」（不传 = 连人带关系一起删）；windows：和他的私聊窗口
   */
  function forgetPerson(id, { keepPerson = false, windows = [] } = {}) {
    const pid = canon(id)
    if (!pid || isOwner(pid)) return { ok: false, message: '管理员不能忘' }
    const p = person(pid)
    // 按字面找 id（不用 LIKE：微信这类 id 里有 _ 和 %，会被当成通配符）
    const q = JSON.stringify(pid)
    const wins = windows.map(String).filter(Boolean)
    const winSql = wins.length ? ` OR window IN (${wins.map(() => '?').join(', ')})` : ''
    const eps = store.prep(`SELECT * FROM episodes WHERE instr(json, ?) > 0${winSql}`).all(q, ...wins)
      .filter((r) => {
        if (wins.includes(r.window)) return true
        const d = JSON.parse(r.json)
        return d.about === pid || d.speaker === pid || (Array.isArray(d.who) && d.who.length === 1 && d.who[0] === pid)
      })
    const per = store.prep(`SELECT * FROM perception WHERE who = ?${winSql}`).all(pid, ...wins)
    const gone = new Set(eps.map((r) => r.id))
    const kept = store.prep('SELECT id, json FROM episodes WHERE instr(json, ?) > 0').all(q)
      .filter((r) => { if (gone.has(r.id)) return false; const d = JSON.parse(r.json); return Array.isArray(d.who) && d.who.includes(pid) }).length
    // 这些事之间、和别的事之间的联想连线也一起收着，放回来时连回去
    const linkRows = []
    const linkQ = store.prep('SELECT a, b, kind, weight FROM links WHERE a = ? OR b = ?')
    for (const r of eps) linkRows.push(...linkQ.all(r.id, r.id))
    const prev = store.get(forgottenKey(pid), null)
    // deleteEpisode 会级联删掉由这些经历派生的「知道的事」；恢复时也要把派生条目放回去。
    const derived = []
    const seen = new Set(eps.map((e) => e.id))
    const queue = [...seen]
    // 多跳收齐派生记忆：经历 → 日回顾 → 周总结 → 语义结论。
    while (queue.length) {
      const id = queue.shift()
      for (const row of store.prep("SELECT * FROM episodes WHERE instr(json, ?) > 0").all(JSON.stringify(id))) {
        if (seen.has(row.id)) continue
        seen.add(row.id)
        derived.push(row)
        queue.push(row.id)
      }
    }
    const bundle = {
      links: [...(prev?.links || []), ...linkRows],
      id: pid, at: now(), name: p?.name || prev?.name || '', keepPerson: Boolean(keepPerson),
      person: p || prev?.person || null,
      episodes: [...(prev?.episodes || []), ...eps], perception: [...(prev?.perception || []), ...per], derived: [...(prev?.derived || []), ...derived],
    }
    // 恢复包和删除必须一起提交：中途写库失败时不能只留下半份恢复区或半份活动记忆。
    store.tx(() => {
      store.set(forgottenKey(pid), bundle)
      for (const r of eps) getMemory().deleteEpisodeRaw(r.id)
      for (const r of per) store.prep('DELETE FROM perception WHERE id = ?').run(r.id)
      getEmotion().forgetAppraisals(pid, wins)
      if (!keepPerson) { store.prep('DELETE FROM people WHERE id = ?').run(pid); recordDeletion(pid, 'person') }
      else if (p) {
        const { rel, tom, ...rest } = p
        savePerson({ ...rest, noMemory: true })
      }
      getMemory().touchAudience()
    })
    getConversation().invalidatePerson(pid, wins)
    getInner().clearDeferred()
    log?.info?.(`忘掉 ${p?.name || pid}：${eps.length} 件事、${per.length} 句原话移进恢复区${keepPerson ? '，以后也不记他' : ''}`)
    return { ok: true, episodes: eps.length, perception: per.length, keptShared: Math.max(0, kept) }
  }
  /** 以后记不记这个人（不动以前的记忆）。 */
  function setNoMemory(id, on) {
    const pid = canon(id)
    if (!pid || (on && isOwner(pid))) return false
    const p = person(pid) || { id: pid, name: '', aliases: [], firstSeen: now(), lastSeen: 0 }
    if (on) p.noMemory = true
    else delete p.noMemory
    savePerson(p)
    return true
  }
  /** 恢复区里的人（过期的顺手清掉）。 */
  function forgottenList() {
    const out = []
    for (const r of store.prep("SELECT key, json FROM kv WHERE key LIKE 'forgotten:%'").all()) {
      const b = JSON.parse(r.json)
      if (now() - b.at > FORGET_KEEP_DAYS * 86400000) { store.del(r.key); continue }
      out.push({ id: b.id, name: b.name, at: b.at, keepPerson: b.keepPerson, episodes: b.episodes.length, perception: b.perception.length, until: b.at + FORGET_KEEP_DAYS * 86400000 })
    }
    return out.sort((a, b) => b.at - a.at)
  }
  /** 从恢复区整份放回去；返回放回的事的 id（向量要重新算）。 */
  function restorePerson(id) {
    const pid = canon(id)
    const b = store.get(forgottenKey(pid), null)
    if (!b) return null
    if (now() - b.at > FORGET_KEEP_DAYS * 86400000) {
      store.del(forgottenKey(pid))
      return null
    }
    store.tx(() => {
      for (const r of b.episodes) {
        putRow('episodes', r)
        store.prep("DELETE FROM deletions WHERE id = ? AND kind = 'episode'").run(r.id)
        writeDeletion(r.id, 'episode', false)
      }
      for (const r of b.perception) putRow('perception', r)
      for (const r of b.derived || []) {
        putRow('episodes', r)
        store.prep("DELETE FROM deletions WHERE id = ? AND kind = 'episode'").run(r.id)
        writeDeletion(r.id, 'episode', false)
      }
      // 联想连线：两头的事都还在才连
      const has = store.prep('SELECT 1 FROM episodes WHERE id = ?')
      for (const l of b.links || []) if (has.get(l.a) && has.get(l.b)) putRow('links', l)
      store.prep("DELETE FROM deletions WHERE id = ? AND kind = 'person'").run(pid)
      writeDeletion(pid, 'person', false)
      const cur = person(pid)
      if (b.person) {
        const merged = cur ? { ...b.person, ...cur, rel: cur.rel || b.person.rel, tom: cur.tom || b.person.tom, lastSeen: Math.max(cur.lastSeen || 0, b.person.lastSeen || 0) } : { ...b.person }
        delete merged.noMemory
        savePerson(merged)
      } else if (cur?.noMemory) setNoMemory(pid, false)
      store.del(forgottenKey(pid))
    })
    log?.info?.(`${b.name || pid} 从恢复区放回来了：${b.episodes.length} 件事、${b.perception.length} 句原话`)
    return [...b.episodes, ...(b.derived || [])].map((r) => r.id)
  }


  return { forgetPerson, setNoMemory, forgottenList, restorePerson }
}
