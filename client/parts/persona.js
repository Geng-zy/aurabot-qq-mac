    function Persona({ st, toast, reload }) {
      const [list, setList] = useState(st.personas)
      const [current, setCurrent] = useState(st.config.persona.current)
      // 记住上次编辑的人格：切走标签页再回来还编辑同一个，而不是跳回正在用的那个
      const [sel, setSel] = useState(() => { try { return localStorage.getItem('aurabot.persona.sel') || st.config.persona.current } catch (e) { return st.config.persona.current } })
      const [edit, setEdit] = useState(null) // { id, name, tags, secs }
      const [dirty, setDirty] = useState(false)
      const [pending, setPending] = useState({}) // 节的 k → { text, view: 'new' | 'old' } AI 润色还没选定的
      const [whole, setWhole] = useState(() => { try { return localStorage.getItem('aurabot.persona.whole') === '1' } catch (e) { return false } })
      // 上次没保存的草稿：进来时只提示「要不要恢复」，不自动覆盖当前内容
      const [restore, setRestore] = useState(null)
      useEffect(() => { try { localStorage.setItem('aurabot.persona.sel', sel) } catch (e) {} }, [sel])
      const load = async (id) => {
        const r = await get('/persona/get?id=' + encodeURIComponent(id))
        if (!r.ok) return
        const server = { id: r.persona.id, name: r.persona.name, nickname: r.persona.nickname || '', tags: (r.persona.tags || []).join('，'), secs: splitPersona(r.persona.body) }
        let draft = null
        try { const raw = localStorage.getItem(personaDraftKey(id)); if (raw) { const d = JSON.parse(raw); if (d && d.id === id && typeof d.body === 'string' && d.body !== r.persona.body) draft = d } } catch (e) {}
        setEdit(server)
        setDirty(false)
        setRestore(draft ? { body: draft.body, name: draft.name, nickname: draft.nickname, tags: draft.tags, at: draft.at || 0 } : null)
        setPending({})
      }
      useEffect(() => { load(sel) }, [sel])
      // 编辑中的草稿只写 localStorage（不动磁盘）；切标签/刷新后在下次进来时提示是否恢复
      useEffect(() => {
        if (!edit || !dirty) return
        const t = setTimeout(() => {
          try { localStorage.setItem(personaDraftKey(edit.id), JSON.stringify({ id: edit.id, name: edit.name, nickname: edit.nickname, tags: edit.tags, body: joinPersona(edit.secs), at: Date.now() })) } catch (e) {}
        }, 200)
        return () => clearTimeout(t)
      }, [edit, dirty])
      const restoreDraft = () => {
        if (!restore) return
        setEdit({ ...edit, name: restore.name ?? edit.name, nickname: restore.nickname ?? edit.nickname, tags: restore.tags ?? edit.tags, secs: splitPersona(restore.body) })
        setDirty(true)
        setRestore(null)
        toast('已恢复上次的改动（还没保存，确认后点「保存人格」）', 'ok')
      }
      const discardDraft = () => {
        try { localStorage.removeItem(personaDraftKey(edit.id)) } catch (e) {}
        setRestore(null)
        toast('已丢弃上次没保存的改动')
      }
      const refresh = async () => { const r = await get('/personas'); if (r.ok) { setList(r.list); setCurrent(r.current) } }
      const body = edit ? joinPersona(edit.secs) : ''
      const waiting = Object.keys(pending).length
      const save = async () => {
        const r = await post('/persona/save', { id: edit.id, name: edit.name, nickname: edit.nickname || '', tags: edit.tags.split(/[,，\s]+/).filter(Boolean), body })
        toast(r.message || (r.ok ? '保存好了' : '没保存成功'))
        if (r.ok) { setDirty(false); setRestore(null); try { localStorage.removeItem(personaDraftKey(edit.id)) } catch (e) {} refresh() }
      }
      const patch = (p) => { setEdit({ ...edit, ...p }); setDirty(true) }
      const setSecs = (secs) => patch({ secs })
      const updSec = (k, p) => setSecs(edit.secs.map((s) => (s.k === k ? { ...s, ...p } : s)))
      const moveSec = (i, d) => { const n = edit.secs.slice(); const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setSecs(n) }
      const delSec = async (s) => { if (s.text.trim() && !(await confirm.ask('删掉「' + (s.title || '未命名') + '」这一节？', { confirmLabel: '删掉' }))) return; setSecs(edit.secs.filter((x) => x.k !== s.k)) }
      const addSec = (title) => setSecs([...edit.secs, psec(title, '')])
      const polish = async (s) => {
        const r = await post('/persona/polish', { name: edit.name, title: s.title === null ? '' : s.title, text: s.text, others: edit.secs.filter((x) => x.k !== s.k).map((x) => (x.title === null ? '开场' : x.title)) })
        if (!r.ok) { toast(r.message || '润色没成功', 'err'); return }
        if (!s.text.trim()) { updSec(s.k, { text: r.text }); toast('写好了，不满意就接着改', 'ok'); return }
        setPending({ ...pending, [s.k]: { text: r.text, view: 'new' } })
      }
      const pick = (s, view) => {
        const next = { ...pending }
        delete next[s.k]
        setPending(next)
        if (view === 'new') updSec(s.k, { text: pending[s.k].text })
      }
      const flip = (s) => setPending({ ...pending, [s.k]: { ...pending[s.k], view: pending[s.k].view === 'new' ? 'old' : 'new' } })
      const setMode = (w) => { if (w && waiting) { toast('先把 AI 润色的那几节选定一版', 'err'); return } setWhole(w); try { localStorage.setItem('aurabot.persona.whole', w ? '1' : '0') } catch (e) {} }
      const titles = edit ? edit.secs.map((s) => s.title) : []
      const suggest = PSEC_SUGGEST.filter((t) => !titles.includes(t))
      const confirm = useConfirm()
      return h('div', { className: 'ab-persona' },
        h('div', { className: 'ab-plist' },
          list.map((p) => h('button', { key: p.id, type: 'button', className: cx('ab-pitem', sel === p.id && 'on'), onClick: () => setSel(p.id) },
            h('div', { className: 'nm' }, p.name, p.id === current ? h('span', { className: 'ab-badge' }, '正在用') : null),
            h('div', { className: 'tg' }, (p.tags || []).join(' · ') || p.id + ' · ' + p.chars + ' 字'))),
          h(Btn, { kind: 'ghost', onClick: () => { const id = 'persona-' + Date.now().toString(36); setEdit({ id, name: '新人格', tags: '', secs: splitPersona('你是……\n\n【打字习惯】\n- 短句、口语，一次只说一两句。') }); setSel(id); setDirty(true); setPending({}) } }, '＋ 新建人格'),
          h(AvatarCard, { st, toast, reload }),
        ),
        edit ? h(Card, { title: '编辑人格', desc: '人格写在系统提示词的最前面，按节写更好改。离开不会自动保存；切标签/切页面会先记住草稿，下次进来会问你要不要恢复；输入框里 Ctrl+Z 可撤回。保存后大肥鱼下一轮回复起就按新的来。',
          right: h('div', { className: 'ab-flex' },
            edit.id !== current ? h(Btn, { small: true, onClick: async () => { const r = await post('/persona/use', { id: edit.id }); toast(r.message); refresh(); reload() } }, '设为当前') : null,
            edit.id !== current ? h(Btn, { small: true, kind: 'danger', onClick: async () => { if (!(await confirm.ask('删掉这个人格？', { confirmLabel: '删掉' }))) return; const r = await post('/persona/delete', { id: edit.id }); if (r.ok) { try { localStorage.removeItem(personaDraftKey(edit.id)) } catch (e) {} setList(r.list); setSel(current) } else toast(r.message) } }, '删除') : null) },
          restore ? h('div', { className: 'ab-flex', style: { marginTop: 12, padding: '8px 10px', border: '1px solid var(--ab-line-2, currentColor)', borderRadius: 8, background: 'rgba(255,255,255,.04)' } },
            h('span', { className: 'ab-small' }, '发现上次没保存的人格改动（' + String(restore.body || '').length + ' 字' + (restore.at ? '，' + new Date(restore.at).toLocaleString() : '') + '）。要恢复吗？'),
            h('div', { className: 'ab-spacer' }),
            h(Btn, { small: true, kind: 'primary', onClick: restoreDraft }, '恢复'),
            h(Btn, { small: true, kind: 'ghost', onClick: discardDraft }, '丢弃')) : null,
          h(Row, { label: '名字' }, h('input', { className: 'ab-input', value: edit.name, onChange: (e) => patch({ name: e.target.value }) })),
          h(Row, { label: '小名', hint: '和「人格与自我」里的小名联动' }, h('input', { className: 'ab-input', value: edit.nickname || '', onChange: (e) => patch({ nickname: e.target.value }) })),
          h(Row, { label: '标签', hint: '用逗号隔开' }, h('input', { className: 'ab-input', value: edit.tags, onChange: (e) => patch({ tags: e.target.value }) })),
          h('div', { className: 'ab-flex', style: { marginTop: 14 } },
            h(Seg, { value: whole ? 'whole' : 'secs', onChange: (v) => setMode(v === 'whole'), options: [{ value: 'secs', label: '分节' }, { value: 'whole', label: '整段' }] }),
            h('div', { className: 'ab-spacer' }),
            h('span', { className: 'ab-muted ab-small' }, (edit.secs.length - 1) + ' 节 · ' + body.length + ' 字')),
          whole
            ? h('textarea', { className: 'ab-textarea', style: { minHeight: 380, marginTop: 12 }, value: body, onChange: (e) => setSecs(splitPersona(e.target.value)) })
            : h('div', { className: 'ab-psecs' },
              edit.secs.map((s, i) => h(PersonaSection, {
                key: s.k, sec: s, lead: s.title === null, first: i <= 1, last: i === edit.secs.length - 1, pending: pending[s.k],
                onChange: (p) => updSec(s.k, p), onMove: (d) => moveSec(i, d), onDelete: () => delSec(s),
                onPolish: () => polish(s), onPick: (v) => pick(s, v), onFlip: () => flip(s),
              })),
              h('div', { className: 'ab-psec-add' },
                h('span', { className: 'ab-muted ab-small' }, '加一节：'),
                suggest.map((t) => h('button', { key: t, type: 'button', className: 'ab-chip', onClick: () => addSec(t) }, t)),
                h('button', { type: 'button', className: 'ab-chip solid', onClick: () => addSec('') }, '＋ 自己起名'))),
          h('div', { className: 'ab-flex', style: { marginTop: 14 } },
            waiting ? h('span', { className: 'ab-muted ab-small' }, '还有 ' + waiting + ' 节 AI 润色没选定，选好再保存') : null,
            h('div', { className: 'ab-spacer' }),
            h(Btn, { kind: 'primary', disabled: !dirty || !!waiting, onClick: save }, dirty ? '保存人格' : '已保存')),
        ) : h(Card, null, h(Empty, { icon: '⏳', text: '加载中…' })),
        confirm.node)
    }

    /**
     * 按工作区控制「授权 / 提问」要不要在 QQ 里说（移植自原项目 354160e）。
     * 工作区是 DSH 动态登记的，所以单独拉接口，不走配置表单的 draft。
     */
