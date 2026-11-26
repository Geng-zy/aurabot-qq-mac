// 每天的后台模型预算：记下每种用途花了多少，超了就不做（排到第二天），聊天不走这里、不受影响。

/**
 * @param {{ store: any, today: () => string, setting: (key: string) => any }} deps
 */
export function createBudget({ store, today, setting }) {
  const reservations = new Set()
  const add = store.prep(`INSERT INTO usage (day, kind, calls, tokens) VALUES (?, ?, 1, ?)
    ON CONFLICT(day, kind) DO UPDATE SET calls = calls + 1, tokens = tokens + excluded.tokens`)

  /** 记一次调用。tokens 拿不到真实用量时按字数估。 */
  function charge(kind, tokens) {
    add.run(today(), String(kind), Math.max(0, Math.round(Number(tokens) || 0)))
  }
  function spent(day = today()) {
    const rows = store.prep('SELECT kind, calls, tokens FROM usage WHERE day = ?').all(day)
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, { calls: r.calls, tokens: r.tokens }]))
    return { day, tokens: rows.reduce((n, r) => n + r.tokens, 0), byKind }
  }
  /** 这次还能不能花：估计的 token 加上今天已花的不超过上限。深想另有次数上限。 */
  function allow(kind, estimate = 0) {
    const cap = Number(setting('models.backgroundTokensDaily'))
    const safety = Math.max(0, Math.min(0.5, Number(setting('models.backgroundSafety')) || 0))
    const guarded = Math.ceil(Math.max(0, Number(estimate) || 0) * (1 + safety))
    const s = spent()
    const pending = [...reservations].filter((r) => r.day === s.day)
    if (store.get('budget.unlimitedDay') !== s.day && Number.isFinite(cap) && s.tokens + pending.reduce((sum, r) => sum + r.estimate, 0) + guarded > cap) return false
    if (kind === 'deep') {
      const n = (s.byKind.deep?.calls || 0) + pending.filter((r) => r.kind === 'deep').length
      if (n >= Number(setting('models.deepThinkDaily'))) return false
    }
    return true
  }
  function reserve(kind, estimate) {
    const safety = Math.max(0, Math.min(0.5, Number(setting('models.backgroundSafety')) || 0))
    const guarded = Math.ceil(Math.max(0, Number(estimate) || 0) * (1 + safety))
    if (!allow(kind, estimate)) return null
    const ticket = { kind, estimate: guarded, day: today() }
    reservations.add(ticket)
    return (used) => {
      if (reservations.delete(ticket) && used !== undefined) {
        add.run(ticket.day, kind, Math.max(0, Math.round(Number(used) || 0)))
      }
    }
  }
  return { charge, spent, allow, reserve }
}

/** 估算 token：中文大约 1 字 1 token，英文大约 4 字符 1 token。 */
export function estimateTokens(text) {
  const s = String(text || '')
  const cjk = (s.match(/[　-鿿＀-￯]/g) || []).length
  return Math.ceil(cjk + (s.length - cjk) / 4)
}
