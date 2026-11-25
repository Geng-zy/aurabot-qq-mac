    function MindSettings({ toast, jump }) {
      const [d, setD] = useState(null)
      const [advanced, setAdvanced] = useState(false)
      const [group, setGroup] = useState('')
      const [search, setSearch] = useState('')
      const [exact, setExact] = useState('')
      const [pending, setPending] = useState('')
      const saving = useRef(false)
      useEffect(() => { get('/mind/settings').then(setD) }, [])
      useEffect(() => {
        if (jump?.section === 'mind-local-model') {
          setGroup('local')
          setSearch('')
          setExact('')
        } else if (jump?.setting) {
          setSearch(jump.setting.label)
          setExact(jump.setting.key)
          if (jump.setting.advanced) setAdvanced(true)
        }
      }, [jump])
      if (!d) return h(Card, { title: '设置' }, h('p', { className: 'ab-muted' }, '读取中…'))
      if (!d.ok) return h(Card, { title: '设置' }, h(Empty, { text: d.message || '心智核心没起来' }))
      const update = async (key, body, reset = false) => {
        if (saving.current) return
        saving.current = true
        setPending(key)
        try {
          const r = await post(reset ? '/mind/settings/reset' : '/mind/settings/save', body)
          if (!r.ok) { toast(r.message || '保存失败', 'err'); return }
          setD((old) => ({ ...old, values: r.values, saved: r.saved }))
          toast(reset ? '已恢复默认' : '已保存', 'ok')
        } finally { saving.current = false; setPending('') }
      }
      const show = (v) => v === null || v === undefined || v === '' ? '不填' : typeof v === 'boolean' ? (v ? '开' : '关') : String(v)
      const ctl = (p) => {
        const v = d.values[p.key]
        const save = (x) => update(p.key, { patch: { [p.key]: x } })
        if (typeof p.def === 'boolean') return h(Switch, { on: !!v, label: p.label, disabled: Boolean(pending), onChange: save })
        if (p.options) return h(Select, { value: v, options: p.options, ariaLabel: p.label, disabled: Boolean(pending), onChange: save })
        const number = typeof p.def === 'number' || p.min !== undefined
        return h(MindInput, { value: v, label: p.label, disabled: Boolean(pending), number, min: p.min, max: p.max, step: p.step, unit: p.unit, onCommit: save })
      }
      const hasAdvanced = d.params.some((p) => p.advanced)
      const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
      const groups = d.groups.filter((g) => d.params.some((p) => p.group === g.id && (advanced || !p.advanced)))
      const current = groups.find((g) => g.id === group) || groups[0]
      const panels = (words.length ? groups : [current].filter(Boolean)).flatMap((g) => {
        const params = d.params.filter((p) => p.group === g.id && (advanced || !p.advanced) && (exact ? p.key === exact : words.every((word) => [g.label, p.label, p.hint, p.key].join(' ').toLowerCase().includes(word))))
        return params.length ? [h(Card, { key: g.id, title: g.label }, params.map((p) => h(Row, {
          key: p.key, label: p.label, hint: p.hint, className: 'ab-param-row',
          details: h('details', { className: 'ab-param-details' }, h('summary', null, '默认值与依据'),
            h('p', null, '默认：' + show(p.def) + (p.unit && typeof p.def === 'number' ? ' ' + p.unit : '')),
            h('p', null, '依据：' + p.source), p.ownerOnly ? h('p', null, '只有你能改。') : null),
        }, ctl(p), Object.hasOwn(d.saved || {}, p.key) ? h(Btn, { small: true, kind: 'ghost', disabled: Boolean(pending), onClick: () => update(p.key, { key: p.key }, true) }, '恢复默认') : null)))] : []
      })
      return h('div', { className: 'ab-grid' },
        h(Card, { className: 'ab-settings-tools' }, h('div', { className: 'ab-settings-toolbar' },
          h('input', { className: 'ab-input', type: 'search', value: search, placeholder: '搜索设置，例如跨会话、情绪、预算', 'aria-label': '搜索设置', onChange: (e) => { setSearch(e.target.value); setExact('') } }),
          hasAdvanced ? h('div', { className: 'ab-switch-row' }, h('span', null, '显示高级'), h(Switch, { label: '显示高级', on: advanced, onChange: (v) => { setAdvanced(v); setExact('') } })) : null),
          h('nav', { className: 'ab-settings-nav', 'aria-label': '设置分类' }, groups.map((g) =>
            h('button', { key: g.id, type: 'button', 'aria-current': !words.length && current?.id === g.id ? 'true' : undefined, onClick: () => { setSearch(''); setExact(''); setGroup(g.id) } }, g.label)))),
        h('div', { className: 'ab-grid ab-settings-body' },
          !words.length && current?.id === 'local' ? h(MindLocalModel, { toast, settings: d.values }) : null,
          panels.length ? panels : h(Card, null, h(Empty, { text: '没有找到匹配的设置' }))))
    }
