    function ModuleRow({ m, draft, setModules, toast, reload }) {
      const s = MOD_STATE(m)
      const [open, setOpen] = useState(false)
      const setMod = async (patch) => {
        const r = await post('/save', { modules: { [m.id]: { ...((draft.modules || {})[m.id] || {}), ...patch } } })
        if (r.ok === false) return toast(r.message, 'err')
        toast(patch.enabled === false ? `「${m.name}」关掉了` : patch.enabled ? `「${m.name}」打开了` : '好了', 'ok')
        setModules(r.modules)
        reload()
      }
      const act = async (path, body, okMsg) => {
        const r = await post(path, body)
        toast(r.message || okMsg, r.ok === false ? 'err' : 'ok')
        if (r.list) setModules(r.list)
        if (r.prompt && r.ok) copy(r.prompt, toast)
        reload()
        return r
      }
      const what = [m.tools.length ? '工具：' + m.tools.join('、') : '', m.commands.length ? '命令：' + m.commands.map((c) => '/' + c).join(' ') : ''].filter(Boolean).join('　')
      const errs = (m.error ? [{ label: '加载', message: m.error }] : []).concat(m.errors || [])
      return h('div', { className: 'ab-mod' },
        h('div', { className: 'main' },
          h('div', { className: 'nm' }, m.name, h('code', null, m.id),
            h('span', { className: cx('ab-badge', s.cls) }, s.text),
            m.outdated ? h('span', { className: 'ab-badge warn', title: '你复制 / 替换时内置的是 ' + m.forkedFrom + '，现在是 ' + m.builtinVersion }, '内置版本更新了') : null),
          m.description ? h('div', { className: 'ds' }, m.description) : null,
          what ? h('div', { className: 'what' }, what) : null,
          errs.length ? h('div', { className: 'ab-note err', style: { marginTop: 6 } },
            h('div', { style: { cursor: 'pointer' }, onClick: () => setOpen(!open) }, (open ? '▾ ' : '▸ ') + errs.length + ' 条报错：' + String(errs[0].message).split('\n')[0].slice(0, 120)),
            open ? h('div', { className: 'ab-code' }, errs.map((e) => (e.at ? new Date(e.at).toLocaleTimeString() + ' ' : '') + (e.label || '') + '：' + e.message).join('\n\n')) : null) : null,
          h('div', { className: 'acts' },
            m.builtin && !m.hasUser ? h(Btn, { small: true, onClick: () => act('/modules/fork', { id: m.id }, '复制好了'), title: '把这个内置模块的源码复制到 modules/' + m.id + '/，改了就替换内置的' }, '复制一份来改') : null,
            m.hasUser ? h(Btn, { small: true, onClick: () => post('/modules/open?id=' + encodeURIComponent(m.id)).then((r) => toast(r.message)) }, '打开文件夹') : null,
            m.hasUser ? h(Btn, { small: true, onClick: () => get('/modules/prompt?id=' + encodeURIComponent(m.id)).then((r) => copy(r.prompt, toast, '修改提示词复制好了，粘给 DSH，把【】里那句换成你想要的')) }, '复制给 DSH') : null,
            m.hasUser && !m.safeSkipped ? h(Btn, { small: true, onClick: () => act('/modules/reload', { id: m.id }, '重新加载好了') }, '重新加载') : null)),
        h('div', { className: 'side' },
          h(Switch, { on: m.enabled, onChange: (v) => setMod({ enabled: v }), title: m.enabled ? '关掉这个模块' : '打开这个模块' }),
          m.builtin && m.hasUser ? h('label', { className: 'ab-small ab-muted', style: { display: 'flex', alignItems: 'center', gap: 6 } }, '用内置的', h(Switch, { on: m.useBuiltin, onChange: (v) => setMod({ useBuiltin: v }) })) : null))
    }

    /** 模拟测试：不上 QQ 试模块。发出去的只截下来看，不真发。 */
