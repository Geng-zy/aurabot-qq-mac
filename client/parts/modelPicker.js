    function ModelPicker({ kind, baseUrl, apiKey, keyFrom, value, onPick, toast }) {
      const [res, setRes] = useState(null)
      const [busy, setBusy] = useState(false)
      const [all, setAll] = useState(false)
      const [q, setQ] = useState('')
      const load = async () => {
        setBusy(true)
        try {
          const r = await post('/provider-models', { kind, baseUrl: baseUrl || '', apiKey: apiKey || '', keyFrom })
          if (!r || r.ok === false) { toast((r && r.message) || '没拿到模型列表', 'err'); setRes(null); return }
          setRes(r)
          setAll(!r.models.length)
          if (!r.models.length && !r.others.length) toast('服务没有列出任何模型，只能自己填', 'err')
        } finally { setBusy(false) }
      }
      const list = res ? (all ? [...res.models, ...res.others] : res.models).filter((m) => !q || m.toLowerCase().includes(q.toLowerCase())) : []
      return h('div', { style: { marginTop: 6 } },
        h('div', { className: 'ab-flex', style: { gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
          h(Btn, { small: true, disabled: busy, onClick: load }, busy ? '获取中…' : res ? '重新获取' : '获取可用模型'),
          res ? h('input', { className: 'ab-input', style: { flex: '1 1 160px', minWidth: 120 }, placeholder: '在 ' + (all ? res.models.length + res.others.length : res.models.length) + ' 个模型里找', value: q, onChange: (e) => setQ(e.target.value) }) : null,
          res && res.others.length && res.models.length ? h(Btn, { small: true, kind: 'ghost', onClick: () => setAll(!all) }, all ? '只看像是能用的' : '显示全部（另外 ' + res.others.length + ' 个）') : null,
          res ? h(Btn, { small: true, kind: 'ghost', onClick: () => setRes(null) }, '收起') : null),
        res ? h('div', { style: { maxHeight: 220, overflowY: 'auto', marginTop: 6, border: '1px solid var(--ab-line)', borderRadius: 8 } },
          list.length ? list.slice(0, 200).map((m) => h('div', {
            key: m, onClick: () => { onPick(m); toast('选了 ' + m, 'ok') },
            style: { padding: '6px 10px', cursor: 'pointer', fontSize: 12.5, wordBreak: 'break-all', background: m === value ? 'var(--ab-hover)' : 'transparent', fontWeight: m === value ? 600 : 400 },
          }, m === value ? '✓ ' + m : m)) : h('div', { className: 'ab-muted ab-small', style: { padding: 8 } }, '没有对得上的')) : null)
    }
