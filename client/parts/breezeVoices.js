    function BreezeVoices({ b, draft, setDraft }) {
      const [list, setList] = useState(null)
      const [err, setErr] = useState('')
      const [busy, setBusy] = useState(false)
      const load = async () => {
        setBusy(true); setErr('')
        try {
          const r = await get('/voice/breeze-voices')
          if (r && r.ok) setList(r.voices || [])
          else setErr(r?.message || '拉不到音色列表')
        } catch (e) { setErr(e.message) } finally { setBusy(false) }
      }
      const cur = String(b?.voiceId || '')
      const opts = (list || []).map((v) => ({ value: v.id, label: v.name || v.id, desc: [v.origin === 'cloned' ? '克隆' : v.origin, v.desc].filter(Boolean).join(' · ') || undefined }))
      if (list && cur && !opts.some((o) => o.value === cur)) opts.unshift({ value: cur, label: cur, desc: '当前配置里的音色（不在列表里）' })
      return h('div', null,
        h(Row, { label: 'Breeze 音色', hint: list ? '共 ' + list.length + ' 个，选一个就填进上面的音色 id' : '点「列出音色」从 Breeze 拉列表，选中自动填 id，不用去官网抄' },
          h('div', { className: 'ab-flex' },
            list ? h(Select, { width: 340, value: cur, options: opts, onChange: (v) => setDraft(setPath(draft, 'voice.breeze.voiceId', v)) }) : null,
            h(Btn, { small: true, kind: 'ghost', disabled: busy, onClick: load }, busy ? '拉取中…' : (list ? '刷新' : '列出音色')))),
        err ? h('div', { className: 'ab-note warn', style: { marginTop: 6 } }, err) : null,
      )
    }
    /** Breeze 云端额度：查余额、显示上次领取、手动领一次。 */
