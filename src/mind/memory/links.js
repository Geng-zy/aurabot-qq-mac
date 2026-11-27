// 睡觉整理的两块基础件：判断「来源有没有变」、给相像的经历建联系（向量余弦 ≥ 0.8）。
// 从 memory/sleep.js 抽出来：这两个都只碰「库里的经历与向量」，与回放/回顾/做梦无关。

export function createLinks({ store, mem }) {
  function sourceUnchanged(e) {
    const current = mem.row(e.id)
    return current?.gist === e.gist && current.detail === e.detail && current.window === e.window && current.json === e.json
  }

  /** 给相像的经历建联系（向量余弦 ≥ 0.8）。 */
  function linkSimilar(ids) {
    let n = 0
    const ins = store.prep('INSERT OR IGNORE INTO links (a, b, kind, weight) VALUES (?, ?, ?, ?)')
    for (const id of ids) {
      const v = mem.vectors
      const self = mem.row(id)
      if (!self) continue
      // 拿它自己的向量去找
      const hits = v.search(vecOf(id), { model: mem.embedModel(), limit: 6, min: 0.8, filter: (x) => x !== id })
      for (const h of hits) {
        const [a, b] = id < h.id ? [id, h.id] : [h.id, id]
        n += ins.run(a, b, 'similar', h.sim).changes
      }
    }
    return n
  }
  function vecOf(id) {
    const r = store.prep('SELECT dim, vec FROM vectors WHERE id = ? AND model = ?').get(String(id), mem.embedModel())
    return r ? Array.from(new Float32Array(r.vec.buffer, r.vec.byteOffset, r.dim)) : null
  }


  return { sourceUnchanged, linkSimilar, vecOf }
}
