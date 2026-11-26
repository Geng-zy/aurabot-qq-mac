    function ExtPage({ st, draft, setDraft, toast, reload, mod, embedded }) {
      const m = (st.modules || []).find((x) => x.id === mod)
      const f = useField(draft, setDraft)
      if (!m) return h(Empty, { icon: '🧩', text: '这个模块没在跑了' })
      const base = 'ext.' + m.id + '.'
      const settings = { ...(m.defaults || {}), ...((st.config.ext || {})[m.id] || {}) }
      const draftSettings = { ...(m.defaults || {}), ...((draft.ext || {})[m.id] || {}) }
      const setSettings = (patch) => setDraft((previous) => ({ ...previous, ext: { ...previous.ext, [m.id]: { ...(previous.ext || {})[m.id], ...patch } } }))
      const field = (s) => {
        const p = base + s.key
        if (s.type === 'switch') return f.sw(p)
        if (s.type === 'number') return f.num(p, { min: s.min, max: s.max, step: s.step })
        if (s.type === 'select') return f.select(p, (s.options || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o)))
        if (s.type === 'textarea') return h('textarea', { className: 'ab-textarea', value: getPath(draft, p) ?? '', placeholder: s.placeholder, onChange: (e) => setDraft(setPath(draft, p, e.target.value)) })
        if (s.type === 'password') return f.secret(p, { fallback: s.placeholder || '' })
        return f.text(p, { placeholder: s.placeholder })
      }
      return h('div', { className: 'ab-grid' },
        ((m.settings || []).length || (m.errors || []).length || !m.panel) ? h(Card, { title: m.name, desc: m.description, right: h('span', { className: 'ab-badge mine' }, embedded ? '扩展模块 · ' + m.id : m.id) },
          (m.settings || []).map((s) => h(Row, { key: s.key, label: s.label || s.key, hint: s.hint }, field(s))),
          (m.settings || []).length ? h('div', { className: 'ab-small ab-muted' }, '改完点下面的「保存设置」。') : null,
          (m.errors || []).length ? h('div', { className: 'ab-note err', style: { marginTop: 8 } }, '最近的报错：' + m.errors[0].message) : null) : null,
        m.panel ? h(ExtPanel, { m, settings, draftSettings, setSettings, toast, reload }) : null)
    }


    /** 「她的画作」：读存图目录里最近的 N 张，可以单张删除、开文件夹。 */
    /**
     * 她的形象：导入几张她的图，她画自己（自拍、她的样子、合照里有她）时照着画。
     * 看图写的（或你写的）形象描述也会加进提示词：生图服务不收参考图时靠它画得像。
     */
