    function StarMap({ onPick, q }) {
      const [g, setG] = useState(null)
      const [hover, setHover] = useState('')
      useEffect(() => { get('/mind/people/graph').then(setG).catch(() => setG({ ok: false })) }, [])
      if (!g) return h('p', { className: 'ab-muted' }, '读取中…')
      if (!g.ok || !(g.people || []).length) return h(Empty, { text: '还没认识谁' })
      const people = g.people.slice(0, 120)
      const w = new Map()
      for (const e of g.edges || []) { w.set(e.a + '|' + e.b, e.n); w.set(e.b + '|' + e.a, e.n) }
      // 排顺序：从最亲近的开始，每次接上和上一个联系最多的人；上一个没联系，就接和已经排好的人联系最多的，
      // 再没有就接下一个最亲近的。这样一伙常一起出现的人挨在一起
      const left = [...people].sort((a, b) => Number(b.owner) - Number(a.owner) || b.closeness - a.closeness)
      const order = [left.shift()]
      while (left.length) {
        const last = order[order.length - 1].id
        let bi = 0
        let best = 0
        left.forEach((p, i) => { const n = w.get(last + '|' + p.id) || 0; if (n > best) { best = n; bi = i } })
        if (!best) left.forEach((p, i) => { const n = order.reduce((t, o) => t + (w.get(o.id + '|' + p.id) || 0), 0); if (n > best) { best = n; bi = i } })
        order.push(left.splice(bi, 1)[0])
      }
      const S = 600, C = S / 2, R = S / 2 - 40
      const near = (p) => Math.max(0, Math.min(1, p.owner ? 0.95 : p.closeness))
      // 每个人占的角度按点的大小分：越亲近点越大，占得越宽，名字不挤在一起
      const span = order.map((p) => 1 + 4 * near(p))
      const total = span.reduce((a, b) => a + b, 0)
      let acc = 0
      const pos = new Map(order.map((p, i) => {
        const a = ((acc + span[i] / 2) / total) * Math.PI * 2 - Math.PI / 2
        acc += span[i]
        const r = 60 + (1 - near(p)) * (R - 60)
        return [p.id, { x: C + r * Math.cos(a), y: C + r * Math.sin(a), p }]
      }))
      const maxN = Math.max(1, ...(g.edges || []).map((e) => e.n))
      const match = (p) => q && [p.name, p.id, p.typeLabel].join(' ').toLowerCase().includes(q.toLowerCase())
      const focus = hover || ''
      return h('figure', { className: 'ab-starmap' },
        h('svg', { viewBox: `0 0 ${S} ${S}`, role: 'group', 'aria-label': '关系星图' },
          [0.33, 0.66, 1].map((k) => h('circle', { key: k, className: 'orbit', cx: C, cy: C, r: 60 + k * (R - 60) })),
          (g.edges || []).filter((e) => pos.has(e.a) && pos.has(e.b)).map((e) => {
            const a = pos.get(e.a), b = pos.get(e.b)
            const on = focus && (e.a === focus || e.b === focus)
            return h('line', { key: e.a + e.b, x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: on ? 'var(--ab-sea)' : 'var(--ab-sub)', strokeOpacity: on ? 0.9 : focus ? 0.08 : 0.25, strokeWidth: 0.8 + 2.5 * (e.n / maxN) })
          }),
          h('circle', { cx: C, cy: C, r: 24, fill: 'var(--ab-foam-2)' }),
          h('circle', { cx: C, cy: C, r: 15, fill: 'var(--ab-sea)' }),
          h('text', { x: C, y: C + 34, textAnchor: 'middle', fontSize: 13, fill: 'var(--ab-text)', fontWeight: 700 }, g.self || '她'),
          order.map((p) => {
            const { x, y } = pos.get(p.id)
            const size = 4 + 12 * Math.max(0, Math.min(1, p.owner ? 1 : p.closeness))
            const dim = (q && !match(p)) || (focus && focus !== p.id && !w.get(focus + '|' + p.id))
            const personLabel = [p.name || p.id, p.typeLabel, '亲近 ' + Math.round(p.closeness * 100)].filter(Boolean).join(' · ')
            return h('g', { key: p.id, className: 'person-node', tabIndex: 0, role: 'button', 'aria-label': personLabel,
              style: { cursor: 'pointer' }, opacity: dim ? 0.25 : 1, onClick: () => onPick(p.id),
              onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick(p.id) } },
              onFocus: () => setHover(p.id), onBlur: () => setHover(''), onMouseEnter: () => setHover(p.id), onMouseLeave: () => setHover('') },
              h('circle', { cx: x, cy: y, r: size, fill: p.owner ? 'var(--ab-warn)' : p.noMemory ? 'var(--ab-dim)' : 'var(--ab-sky)', stroke: match(p) ? 'var(--ab-err)' : 'var(--ab-card)', strokeWidth: match(p) ? 3 : 1.5 }),
              (size >= 8 || match(p) || focus === p.id) ? h('text', { x, y: y - size - 4, textAnchor: 'middle', fontSize: 11, fill: 'var(--ab-text)' }, (p.name || p.id.replace(/^qq:/, '')).slice(0, 8)) : null,
              h('title', null, personLabel))
          })),
        h('figcaption', { className: 'ab-starmap-caption' }, '距离表示亲近程度，连线表示同一段记忆。选择人物查看详情。'))
    }
