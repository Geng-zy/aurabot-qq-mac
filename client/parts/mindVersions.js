    function MindVersions({ versions, restore, load, toast }) {
      const [kind, setKind] = useState('traits')
      const [first, setFirst] = useState('')
      const [second, setSecond] = useState('')
      const [from, setFrom] = useState('')
      const [through, setThrough] = useState('')
      const [comparison, setComparison] = useState(null)
      const [extra, setExtra] = useState([])
      const [hasMore, setHasMore] = useState(true)
      const [loading, setLoading] = useState(false)
      const kinds = [{ value: 'traits', label: '性格' }, { value: 'habits', label: '习惯' }, { value: 'persona', label: '人格卡' }, { value: 'self', label: '自我' }]
      const rows = [...(versions[kind] || []), ...extra]
      const more = async () => {
        setLoading(true)
        try {
          const r = await get('/mind/version/list?kind=' + kind + '&before=' + rows.at(-1).id)
          if (r.ok) { setExtra([...extra, ...r.items]); setHasMore(r.hasMore) }
          else toast(r.message, 'err')
        } finally { setLoading(false) }
      }
      const options = [{ value: '', label: '选一个版本' }, ...rows.map((v) => ({
        value: String(v.id), label: '#' + v.id + ' · ' + mindDay(v.at) + (v.pinned ? ' · 已标记' : ''),
      }))]
      const selected = rows.find((v) => String(v.id) === first)
      const change = async (path, body) => {
        const r = await post(path, body)
        if (r.message) notify(toast, r)
        setComparison(null)
        setExtra([]); setHasMore(true); setFirst(''); setSecond('')
        load()
      }
      const compare = async () => {
        const r = await get('/mind/version/compare?first=' + encodeURIComponent(first) + '&second=' + encodeURIComponent(second))
        if (r.ok) setComparison(r.versions)
        else toast(r.message, 'err')
      }
      const bulk = async () => {
        const start = new Date(from + 'T00:00:00').getTime()
        const end = new Date(through + 'T00:00:00')
        end.setDate(end.getDate() + 1)
        if (await confirm.ask('清理这段日期内的版本？', { hint: '会保留标记的重要版本和最新版本。', confirmLabel: '清理' })) change('/mind/version/delete', { kind, from: start, through: end.getTime() })
      }
      const content = (v) => {
        if (v.kind === 'persona') return [v.data.name, v.data.card].filter(Boolean).join('\n')
        if (v.kind === 'habits') return v.data.habits.filter((x) => x.active).map((x) => x.sit + '时，' + x.act).join('\n') || '没有已经形成的习惯'
        if (v.kind === 'traits') return Object.entries(v.data.cur || {}).map(([key, value]) => key + ' · ' + Math.round(value * 100)).join('\n')
        return [v.data.before, v.data.after].filter(Boolean).join('\n\n')
      }
      const confirm = useConfirm()
      return h(Fragment, null, h(Card, { fold: 'self-versions-manage', title: '版本对比与清理' },
        h(Row, { label: '类别' }, h(Select, { value: kind, options: kinds, onChange: (value) => { setKind(value); setFirst(''); setSecond(''); setComparison(null); setExtra([]); setHasMore(true) }, disabled: loading })),
        h(Row, { label: '两个版本' },
          h(Select, { value: first, options, onChange: (value) => { setFirst(value); setComparison(null) } }),
          h(Select, { value: second, options, onChange: (value) => { setSecond(value); setComparison(null) } }),
          h(Btn, { small: true, disabled: !first || !second || first === second, onClick: compare }, '对比')),
        hasMore && rows.length >= (kind === 'persona' ? 30 : 50) ? h(Btn, { small: true, disabled: loading, onClick: more }, loading ? '读取中…' : '加载更早的版本') : null,
        comparison ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 } }, comparison.map((v) =>
          h('div', { key: v.id }, h('b', null, '#' + v.id + ' · ' + mindDay(v.at)), h('p', { className: 'ab-small' }, v.reason),
            h('pre', { className: 'ab-small', style: { whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' } }, content(v))))) : null,
        selected ? h(Row, { label: '第一个版本' },
          h(Btn, { small: true, onClick: () => change('/mind/version/pin', { id: selected.id, pinned: !selected.pinned }) }, selected.pinned ? '取消标记' : '标记重要'),
          kind === 'habits' ? h(Btn, { small: true, onClick: () => restore(kind, selected.id) }, '退回习惯版本') : null,
          h(Btn, { small: true, onClick: async () => { if (await confirm.ask('删除所选版本？', { confirmLabel: '删除' })) change('/mind/version/delete', { id: selected.id }).then(() => setFirst('')) } }, '删除版本')) : null,
        h(Row, { label: '按日期清理' },
          h('input', { type: 'date', className: 'ab-input', value: from, 'aria-label': '起始日期', onChange: (e) => setFrom(e.target.value) }),
          h('input', { type: 'date', className: 'ab-input', value: through, 'aria-label': '结束日期', onChange: (e) => setThrough(e.target.value) }),
          h(Btn, { small: true, disabled: !from || !through || from > through, onClick: bulk }, '清理范围'))),
        confirm.node)
    }

    /** 面板里的调试对话：不经过 QQ、不写进她的心智，直接把她说的话显示出来（来自原项目 f476866）。 */
