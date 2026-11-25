    function ChatModels({ draft, setDraft, list }) {
      const cm = draft.chatModels || { privateDefault: {}, groupDefault: {}, privates: {}, groups: {} }
      const [open, setOpen] = useState(false)
      const [add, setAdd] = useState({ kind: 'private', id: '', sel: '' })
      const key = (m) => m.provider + '::' + m.model
      const val = (s) => (s && s.provider && s.model ? s.provider + '::' + s.model : '')
      const toSel = (v) => { const [p, ...m] = v.split('::'); return v ? { provider: p, model: m.join('::'), reasoningEffort: '' } : { provider: '', model: '', reasoningEffort: '' } }
      const base = [{ value: '', label: '跟随全局模型', desc: '上面「聊天用的模型」' }].concat((list || []).map((m) => ({ value: key(m), label: m.name, desc: m.provider, group: m.provider })))
      const optsFor = (v) => (v && !base.some((o) => o.value === v) ? base.concat([{ value: v, label: v.split('::').slice(1).join('::'), desc: '（DSH 里没找到）' }]) : base)
      const setCm = (patch) => setDraft(setPath(draft, 'chatModels', { ...cm, ...patch }))
      const rows = [['private', cm.privates || {}], ['group', cm.groups || {}]].flatMap(([kind, m]) => Object.entries(m).map(([id, sel]) => ({ kind, id, sel })))
      const label = (sel) => { const v = val(sel); const hit = (list || []).find((m) => key(m) === v); return hit ? hit.name : sel.model }
      const addRow = () => {
        if (!add.id || !add.sel) return
        const field = add.kind === 'private' ? 'privates' : 'groups'
        setCm({ [field]: { ...(cm[field] || {}), [add.id]: toSel(add.sel) } })
        setAdd({ ...add, id: '' })
      }
      const remove = (kind, id) => { const field = kind === 'private' ? 'privates' : 'groups'; const n = { ...(cm[field] || {}) }; delete n[id]; setCm({ [field]: n }) }
      return h(Card, { fold: 'qq-chat-models', title: '按会话选模型', desc: '顺序：这个私聊 > 这个群 > 所有私聊 / 所有群的默认 > 上面的全局模型。没选的一级就用下一级；选的模型在 DSH 里找不到时也自动退回。只有你能在这里改，聊天里的人换不了。换了之后从那个聊天的下一条消息起生效。' },
        h(Row, { label: '私聊默认模型' }, h(Select, { value: val(cm.privateDefault), width: 280, options: optsFor(val(cm.privateDefault)), onChange: (v) => setCm({ privateDefault: toSel(v) }) })),
        h(Row, { label: '群聊默认模型' }, h(Select, { value: val(cm.groupDefault), width: 280, options: optsFor(val(cm.groupDefault)), onChange: (v) => setCm({ groupDefault: toSel(v) }) })),
        h('div', { style: { marginTop: 8 } }, h(Btn, { small: true, kind: 'ghost', onClick: () => setOpen(!open) }, (open ? '收起' : '展开') + '单个 QQ / 群的例外（' + rows.length + '）')),
        open ? h('div', { style: { marginTop: 8 } },
          rows.length === 0 ? h('div', { className: 'ab-muted', style: { marginBottom: 10 } }, '还没有单独设置的 QQ 或群。') :
            rows.map((r) => h(Row, { key: r.kind + r.id, label: (r.kind === 'private' ? '私聊 ' : '群 ') + r.id }, h('span', { className: 'ab-muted' }, label(r.sel)), h(Btn, { small: true, kind: 'ghost', onClick: () => remove(r.kind, r.id) }, '移除'))),
          h('div', { className: 'ab-flex' },
            h(Seg, { value: add.kind, onChange: (v) => setAdd({ ...add, kind: v }), options: [{ value: 'private', label: '私聊' }, { value: 'group', label: '群' }] }),
            h('input', { className: 'ab-input', placeholder: add.kind === 'private' ? 'QQ 号' : '群号', value: add.id, onChange: (e) => setAdd({ ...add, id: e.target.value.replace(/\D/g, '') }) }),
            h(Select, { value: add.sel, width: 220, options: base.filter((o) => o.value), placeholder: '选模型', onChange: (v) => setAdd({ ...add, sel: v }) }),
            h(Btn, { small: true, disabled: !add.id || !add.sel, onClick: addRow }, '添加'))) : null)
    }

    /** 模型页：DeepSeek 峰谷省钱模式（默认关，只影响后台模型调用时机，聊天回复不变）。 */
