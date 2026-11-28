    function MindMemory({ toast, privacy }) {
      const [state, setState] = useState(null)
      const [items, setItems] = useState(null)
      const [q, setQ] = useState('')
      const [status, setStatus] = useState('live')
      const [kind, setKind] = useState('')
      const [sleeping, setSleeping] = useState(false)
      const [next, setNext] = useState(null)
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState('')
      const [sources, setSources] = useState([])
      const [relation, setRelation] = useState(null)
      const [share, setShare] = useState(null)
      const [sharing, setSharing] = useState(false)
      const pageTicket = useRef(0)
      const relatedTicket = useRef(0)
      const sourceLabel = (id) => id === 'qq' ? 'QQ' : id || '未标平台'
      const load = async (offset = 0) => {
        const ticket = ++pageTicket.current
        setLoading(true)
        setError('')
        const r = await get('/mind/memories?status=' + status + '&kind=' + encodeURIComponent(kind) + '&q=' + encodeURIComponent(q) + '&limit=40&offset=' + offset)
        if (ticket !== pageTicket.current) return
        setLoading(false)
        if (!r.ok) { setError(r.message || '记忆读取失败'); return }
        setItems((old) => offset ? [...(old || []), ...(r.items || []).filter((item) => !old?.some((x) => x.id === item.id))] : r.items || [])
        if (!offset) setSources(r.sources || [])
        setNext(r.next ?? null)
      }
      const toggleRelated = async (id) => {
        const ticket = ++relatedTicket.current
        if (relation?.id === id) { setRelation(null); return }
        setRelation({ id, loading: true })
        const r = await get('/mind/memory/related?id=' + encodeURIComponent(id))
        if (ticket === relatedTicket.current) setRelation({ id, items: r.items || [], error: r.ok ? '' : r.message || '关联读取失败' })
      }
      const loadState = () => get('/mind/state').then(setState)
      useEffect(() => { loadState() }, [])
      useEffect(() => {
        setItems(null)
        setNext(null)
        setRelation(null)
        setSources([])
        const timer = setTimeout(() => load(), 250)
        return () => { clearTimeout(timer); pageTicket.current++; relatedTicket.current++ }
      }, [q, status, kind])
      if (state && !state.ok) return h('div', { className: 'ab-grid' }, h(Empty, {
        icon: '🧠', title: '心智核心没起来',
        text: state.message || '记忆库读不到；去「模块管理」看看心智核心在不在跑。',
        action: '去模块管理', onAction: () => { try { location.assign('#' + 'modules') } catch (e) {} },
      }))
      const counts = state?.status?.counts || {}
      const mem = counts.memory || {}
      const usage = state?.usage
      const act = async (path, id, ask) => {
        if (ask && !(await confirm.ask(ask, { confirmLabel: '继续' }))) return
        const r = await post(path, { id })
        toast(r.message || (r.ok ? '好了' : '没成功'))
        relatedTicket.current++
        setRelation(null)
        load(); loadState()
      }
      const sleepNow = async () => {
        if (!(await confirm.ask('现在就让她睡一觉整理记忆？', { hint: '会调用模型、花 token（按睡觉整理的思考深度），一般几十秒到几分钟。', confirmLabel: '让她睡' }))) return
        setSleeping(true)
        const r = await post('/mind/sleep', {})
        setSleeping(false)
        toast(r.message || (r.ok ? '整理完了' : '没成功'))
        load(); loadState()
      }
      const last = state?.sleep
      const saveShare = async () => {
        setSharing(true)
        try {
          const r = await post('/mind/memory/share', { ...share, audience: share.kind + ':' + share.target.trim() })
          toast(r.message)
          if (r.ok) { setShare(null); load() }
        } finally { setSharing(false) }
      }
      const confirm = useConfirm()
      return h(Fragment, null,
        h('div', { className: 'ab-memory-head' },
          h(Card, { title: '记忆概况', className: 'ab-memory-summary' },
            h('dl', { className: 'ab-metrics ab-memory-totals' },
              [['记得的经历', state?.ok ? mem.live ?? 0 : '—'], ['已淡忘的经历', state?.ok ? mem.archived ?? 0 : '—'], ['看到和说过的原话', counts.perception ?? '—'],
                ['今日后台用量', usage ? fmtTokens(usage.tokens) : '—']].map(([label, value]) =>
                h('div', { key: label, className: 'ab-metric' }, h('dt', null, label), h('dd', null, value)))),
            h(Row, { label: '上次睡觉整理', hint: last ? mindDay(last.at) + (last.report ? ' · ' + Object.entries(last.report).map(([k, v]) => k + '：' + (typeof v === 'object' && v ? JSON.stringify(v) : v)).join('，').slice(0, 200) : '') : '还没整理过' },
              h(Btn, { small: true, onClick: sleepNow, disabled: sleeping }, sleeping ? '正在整理…' : '现在整理一次')),
            state?.pending ? h('p', { className: 'ab-muted ab-small' }, state.pending + ' 个聊天有还没记下的新消息（停下几分钟后自动记）') : null,
            state?.deferredThoughts ? h('p', { className: 'ab-muted ab-small' }, state.deferredThoughts + ' 件事排到后面的日子继续想。') : null,
            state?.status?.recovered ? h('p', { className: 'ab-note warn' }, '数据库曾损坏，已从完好的快照恢复。快照之后的部分数据可能需要补回。') : null),
          privacy),
        h(Card, { fold: 'memory-entries', title: '她记得的事', collapseAtEnd: items?.length > 5 },
          h('div', { className: 'ab-flex', style: { gap: 8, marginBottom: 10, flexWrap: 'wrap' } },
            h('input', { className: 'ab-input', placeholder: '按字找（大意、细节、原始记录）', value: q, onChange: (e) => setQ(e.target.value), style: { flex: 1, minWidth: 160 } }),
            h(Seg, { value: status, onChange: setStatus, options: [{ value: 'live', label: '记得的' }, { value: 'archived', label: '想不起来的' }] }),
            h(Select, { value: kind, onChange: setKind, options: [{ value: '', label: '全部种类' }, ...Object.entries(MIND_KIND).map(([value, label]) => ({ value, label }))] })),
          sources.length ? h('p', { className: 'ab-muted ab-small' }, '来源分布 · ' + sources.map((s) => sourceLabel(s.platform) + ' ' + s.count).join(' · ')) : null,
          error ? h('p', { className: 'ab-muted' }, error) : null,
          error ? h(ErrorBlock, { title: '读不到记忆', message: error, onRetry: () => load() })
            : !items ? h(Skeleton, { kind: 'row', rows: 5, label: '正在读记忆' })
            : !items.length ? h(Empty, {
              icon: q ? '🔍' : '🌱',
              title: q ? '没有匹配的记忆' : status === 'archived' ? '暂时没有淡忘的经历' : '还没有记下的经历',
              text: q ? '换个词试试，或者把筛选切到「全部状态」。' : '她会在聊天和睡觉整理时自己记；也可以在这一页手动添加一条。',
              action: q ? '清空搜索' : undefined,
              onAction: q ? () => { setQ('') } : undefined,
            }) : h('div', { className: 'ab-list' }, items.map((m) => h('div', { key: m.id, className: 'ab-li' },
            h('div', { className: 'meta' }, mindDay(m.at), ' · ', sourceLabel(m.platform), ' · ', MIND_KIND[m.kind] || m.kind, ' · ', MIND_LEVEL[m.level] || '想不起来了', m.emotion ? ' · ' + m.emotion.name : '', m.outdated ? ' · 已过时：' + m.outdated.now : ''),
            h('div', { className: 'body' }, m.gist, m.detail ? h('div', { className: 'ab-muted ab-small' }, m.detail) : null,
              m.original ? h('div', { className: 'ab-muted ab-small', title: '她看不到原始记录；这里给你对照' }, '原来记的：' + m.original.gist) : null),
            h('div', { className: 'ab-flex', style: { gap: 6 } },
              h(Btn, { small: true, onClick: () => toggleRelated(m.id) }, relation?.id === m.id ? '收起关联' : '查看关联'),
              h(Btn, { small: true, onClick: () => act('/mind/memory/boost', m.id) }, '加强'),
              m.canShare ? h(Btn, { small: true, onClick: () => setShare({ id: m.id, text: '', kind: 'group', target: '' }), disabled: sharing }, '允许分享') : null,
              m.shareWith?.length ? h(Btn, { small: true, onClick: () => act('/mind/memory/share/revoke', m.id, '撤回这个会话的分享？'), kind: 'danger' }, '撤回分享') : null,
              h(Btn, { small: true, onClick: async () => { const r = await post('/mind/memory/private', { id: m.id, enabled: !m.privateOnly }); toast(r.message); load() } }, m.privateOnly ? '取消仅私聊' : '仅在私聊提'),
              h(Btn, { small: true, kind: 'danger', onClick: () => act('/mind/memory/delete', m.id, '删掉这条记忆？由它整理出来的「知道的事」会跟着删或重算。从备份恢复后也不会复活。') }, '删除')),
            m.shareWith?.length ? h('div', { className: 'ab-muted ab-small' }, '分享对象：' + m.shareWith.map((id) => id.replace(/^qq:group:/, 'QQ群 ').replace(/^qq:private:/, 'QQ 私聊 ')).join('、')) : null,
            share?.id === m.id ? h('div', { className: 'ab-note' },
              h(Row, { label: '可以聊的内容', hint: '只填你允许这个会话知道的细节' }, h('textarea', { className: 'ab-textarea', maxLength: 300, value: share.text, disabled: sharing, onChange: (e) => setShare({ ...share, text: e.target.value }) })),
              h(Row, { label: '分享给' },
                h(Select, { value: share.kind, options: [{ value: 'group', label: 'QQ群' }, { value: 'private', label: 'QQ 私聊' }], onChange: (kind) => setShare({ ...share, kind }), disabled: sharing }),
                h('input', { className: 'ab-input', inputMode: 'numeric', placeholder: share.kind === 'group' ? '群号' : '对方 QQ 号', value: share.target, disabled: sharing, onChange: (e) => setShare({ ...share, target: e.target.value }) })),
              h(Btn, { small: true, kind: 'primary', disabled: sharing || !share.text.trim() || !/^\d+$/.test(share.target.trim()), onClick: saveShare }, sharing ? '正在保存…' : '保存分享'),
              h(Btn, { small: true, disabled: sharing, onClick: () => setShare(null) }, '取消')) : null,
            relation?.id === m.id ? h('div', { className: 'ab-muted ab-small' },
              relation.loading ? '读取关联…' : relation.error || (relation.items.length ? relation.items.map((item) => h('div', { key: item.id },
                mindDay(item.at), ' · ', sourceLabel(item.platform), ' · ', ({ source: '来源', similar: '相近', cause: '因果', followup: '后续' })[item.relation] || item.relation, ' · ', item.gist)) : '暂无关联')) : null))),
          next !== null ? h(Btn, { onClick: () => load(next), disabled: loading }, loading ? '读取中…' : '加载更多') : null,
          error && next === null ? h(Btn, { onClick: () => load(), disabled: loading }, '重试') : null),
        h(Card, { fold: 'memory-dreams', title: '最近的梦', desc: '睡觉整理时做的梦。大部分醒来就忘；情绪强的、被叫醒的会记得，记得的才会变成她的记忆（梦不会被当成真发生过的事）。' },
          (state?.dreams || []).length ? h('div', { className: 'ab-list' }, state.dreams.map((d, i) => h('div', { key: i, className: 'ab-li' },
            h('div', { className: 'meta' }, mindDay(d.at), d.remembered ? ' · 她记得' : ' · 醒来忘了'),
            h('div', { className: 'body' }, d.text)))) : h(Empty, { text: '还没做过梦' })),
        confirm.node)
    }

    /** 关系：她认识的每个人（按 QQ 号认人）和每个群。数值是她自己的看法，你可以纠正几项。 */
    /**
     * 关系星图：她在正中，每个人一个点。越亲近点越大、离她越近；线是「在她的记忆里一起出现过」（越多越粗）。
     * 环上的顺序按谁和谁常一起出现排（贪心连成一串），一伙朋友会挨在一起。点一下打开那个人。
     */
