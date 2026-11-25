    function RecentLogs({ go }) {
      const [items, setItems] = useState(null)
      const [open, setOpen] = useState(false)
      useEffect(() => {
        if (!open) return
        let alive = true
        const load = () => get('/logs?limit=8&level=info').then((r) => alive && setItems(r.entries || []))
        load()
        const t = setInterval(load, 5000)
        return () => { alive = false; clearInterval(t) }
      }, [open])
      return h(Card, { fold: 'overview-logs', title: '最近日志', className: 'ab-recent', onToggle: (e) => setOpen(e.currentTarget.open), right: h(Btn, { kind: 'ghost', small: true, onClick: () => go('logs') }, '全部日志 →') },
        items === null ? h(Empty, { icon: '⏳', text: '加载中…' }) : items.length === 0 ? h('p', { className: 'ab-muted ab-small' }, '暂无日志') :
          h('div', { className: 'ab-logs', style: { maxHeight: 240 } }, items.slice().reverse().map((e, i) => h(LogLine, { key: i, e }))))
    }
