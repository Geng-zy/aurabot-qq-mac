    function FaceMapCard() {
      const [data, setData] = useState(null)
      const [q, setQ] = useState('')
      const [kind, setKind] = useState('all')
      const [copied, setCopied] = useState('')
      useEffect(() => {
        let alive = true
        get('/panel/faces')
          .then((r) => { if (alive && r && r.ok !== false) setData(r) })
          .catch(() => {})
        return () => { alive = false }
      }, [])
      const faces = data ? data.faces || [] : []
      const emojis = data ? data.emojis || [] : []
      const all = [
        ...faces.map((x) => ({ kind: 'face', name: String(x.name), id: String(x.id), label: String(x.name) })),
        ...emojis.map((x) => ({ kind: 'emoji', name: String(x.name), id: String(x.id), label: x.char + ' ' + x.name })),
      ]
      const key = String(q || '').trim().toLowerCase()
      const rows = all.filter((x) => (kind === 'all' || x.kind === kind) &&
        (!key || x.name.toLowerCase().includes(key) || x.id.includes(key) || x.label.toLowerCase().includes(key)))
      const copy = (x) => {
        clipboard(x.id).catch(() => {})
        setCopied(x.id)
        setTimeout(() => setCopied(''), 1200)
      }
      return h(Card, {
        title: '可用映射' + (all.length ? '（' + all.length + ' 条）' : ''),
        desc: '两种编号混着用都行。点一行复制编号，填进贴表情或让她自己挑。',
      },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' } },
          h(Seg, {
            value: kind,
            options: [
              { value: 'all', label: '全部' },
              { value: 'face', label: 'QQ 表情 ' + faces.length },
              { value: 'emoji', label: 'emoji ' + emojis.length },
            ],
            onChange: setKind,
          }),
          h('input', {
            className: 'ab-input sm',
            placeholder: '搜名字或编号',
            value: q,
            onChange: (e) => setQ(e.target.value),
            style: { width: 180 },
          }),
          copied ? h('span', { className: 'ab-small', style: { color: 'var(--ab-ok)' } }, '已复制 ' + copied) : null),
        data === null
          ? h('div', { className: 'ab-muted ab-small' }, '正在读表情目录…')
          : rows.length === 0
            ? h('div', { className: 'ab-muted ab-small' }, '没有匹配的')
            : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 6, maxHeight: 260, overflow: 'auto', paddingRight: 4 } },
                rows.map((x) => h('button', {
                  key: x.kind + x.id,
                  type: 'button',
                  title: '复制 ' + x.id,
                  onClick: () => copy(x),
                  style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', font: 'inherit', fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,.22)', background: 'rgba(127,127,127,.06)', color: 'inherit', cursor: 'pointer', textAlign: 'left' },
                },
                  h('span', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
                    x.kind === 'face'
                      ? h('img', {
                          src: QFACE_IMG(x.id), alt: '', width: 18, height: 18, loading: 'lazy',
                          style: { flex: '0 0 auto', width: 18, height: 18, objectFit: 'contain' },
                          onError: (e) => { e.currentTarget.style.visibility = 'hidden' },
                        })
                      : null,
                    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, x.kind === 'emoji' ? x.label : x.name)),
                  h('span', { style: { fontFamily: 'ui-monospace, Consolas, monospace', opacity: 0.75 } }, x.id)))),
      )
    }

    /** 滑块 + 数值，比纯数字框直观。 */
