// 关系星图：她认识的人和他们之间的联系 —— 点是人（越亲近越大），线是「在她的记忆里一起出现过」（次数越多越粗）。
// 只用她自己记得的事，不另外存一份。从 mind/index.js 抽出来，只碰 store 与 relations。

export function createPeopleGraph({ store, relations }) {
  function peopleGraph({ limit = 150 } = {}) {
    const people = relations.list().slice(0, limit)
    const ids = new Set(people.map((p) => p.id))
    const pairs = new Map()
    for (const r of store.prep(`SELECT json FROM episodes WHERE status = 'live' AND json LIKE '%"who":["%",%'`).all()) {
      let who = []
      try { who = JSON.parse(r.json).who || [] } catch {}
      const list = [...new Set(who.map(String))].filter((x) => ids.has(x)).sort()
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const k = list[i] + '|' + list[j]
        pairs.set(k, (pairs.get(k) || 0) + 1)
      }
    }
    const edges = [...pairs].map(([k, n]) => { const [a, b] = k.split('|'); return { a, b, n } }).sort((x, y) => y.n - x.n).slice(0, 400)
    return {
      people: people.map((p) => ({ id: p.id, name: p.name, closeness: Number(p.rel?.closeness) || 0, owner: Boolean(p.owner), type: p.type, typeLabel: p.typeLabel, noMemory: p.noMemory === true, lastSeen: p.lastSeen || 0 })),
      edges,
    }
  }


  return { peopleGraph }
}
