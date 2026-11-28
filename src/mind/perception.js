// 感知记录：收到的每条消息、她说出去的每句话，都落在 perception 表里（重复投递只记一次）。
// 从 mind/index.js 抽出来：那边是心智各层的装配，这一支只碰 perception 表与「谁是谁」的几个判断。

export function createPerception({ store, now, canon, notePerson, isOwner, isOwnerWindow, isPrivateHistoryWindow, getOwnerId, getMemory, log, place }) {
  /**
   * 记一条收到的消息。
   * @param {{ window: string, who: string, name?: string, text: string, msgId?: string, at?: number, addressed?: boolean, seen?: 'replied'|'ignored'|'pending' }} m
   * @returns {boolean} 是否新记下（重复投递返回 false）
   */
  function perceive(m) {
    const at = Number(m.at) || now()
    const who = canon(m.who)
    if (who) notePerson(who, { name: m.name })
    const r = store.prep('INSERT OR IGNORE INTO perception (at, window, who, dir, text, msg_id, json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(at, String(m.window), who, 'in', String(m.text || ''), m.msgId ? String(m.msgId) : null, JSON.stringify({ name: m.name || '', seen: m.seen || 'pending', ...(m.addressed ? { addressed: true } : {}) }))
    if (r.changes && isOwner(who)) getMemory().notePrivacyContext(String(m.window), m.text)
    return r.changes > 0
  }
  function noteAddressed(window, msgId) {
    if (!msgId) return
    store.prep("UPDATE perception SET json = json_set(COALESCE(json, '{}'), '$.addressed', json('true')) WHERE window = ? AND msg_id = ? AND dir = 'in'")
      .run(String(window), String(msgId))
  }

  /** 管理员的私聊来信，以感知原话的时间为准。 */
  function lastOwnerMessageAt() {
    if (!getOwnerId()) return 0
    const rows = store.prep("SELECT window, MAX(at) AS at FROM perception WHERE who = ? AND dir = 'in' AND at <= ? GROUP BY window")
      .all(getOwnerId(), now())
    return Math.max(0, ...rows.filter((row) => isOwnerWindow(row.window)).map((row) => row.at))
  }
  /**
   * 记一条她发出去的话。所有出口（回复、命令回复、发文件、主动找人、模块代发）都要走这里。
   * @param {{ window: string, text: string, msgId?: string, at?: number, kind?: string }} m
   */
  function said(m) {
    const at = Number(m.at) || now()
    const audienceShares = getMemory().sharesIn(String(m.window)).map((e) => e.id)
    const r = store.prep('INSERT OR IGNORE INTO perception (at, window, who, dir, text, msg_id, json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(at, String(m.window), 'self', 'out', String(m.text || ''), m.msgId ? String(m.msgId) : null, JSON.stringify({ kind: m.kind || 'reply', ...(audienceShares.length ? { audienceShares } : {}) }))
    // 她刚想起来的事说出口了：记下跟这里的人说过（在场 = 最近两小时在这里说过话的人）
    if (r.changes > 0) {
      try { getMemory().noteSaid({ window: String(m.window), text: String(m.text || ''), audience: audienceOf(String(m.window), at) }) } catch (error) { log.debug('记「说过」出错：', error.message) }
    }
    return r.changes > 0
  }
  /** 这个窗口里此刻在场的人：最近两小时在这里说过话的（私聊没人说话时，算最近一个月说过话的那个人）。 */
  function audienceOf(window, at = now()) {
    const q = store.prep("SELECT DISTINCT who FROM perception WHERE window = ? AND dir = 'in' AND at >= ? LIMIT 30")
    const recent = q.all(window, at - 2 * 3600000).map((r) => r.who)
    if (recent.length || place(window).kind !== 'private') return recent
    return q.all(window, at - 30 * 86400000).map((r) => r.who).slice(0, 1)
  }
  /** 「翻聊天记录」：按窗口和时间取原话。 */
  function history(window, { since = 0, until = Infinity, limit = 200, audienceWindow } = {}) {
    if (audienceWindow !== undefined && window !== audienceWindow && isPrivateHistoryWindow(window)) return []
    const rows = store.prep('SELECT at, who, dir, text, json FROM perception WHERE window = ? AND at >= ? AND at <= ? ORDER BY at DESC, id DESC LIMIT ?')
      .all(String(window), since, Number.isFinite(until) ? until : 8.64e15, limit).reverse()
    return rows.flatMap(({ json, ...line }) => {
      const shares = audienceWindow === undefined ? [] : JSON.parse(json || '{}').audienceShares || []
      return shares.every((id) => getMemory().visibleIn(getMemory().row(id), audienceWindow)) ? [line] : []
    })
  }


  return { perceive, noteAddressed, lastOwnerMessageAt, said, history, audienceOf }
}
