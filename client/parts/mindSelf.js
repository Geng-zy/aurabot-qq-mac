    function MindSelf({ toast }) {
      const [d, setD] = useState(null)
      const [draft, setDraft] = useState(null)
      const [busy, setBusy] = useState(false)
      const [edit, setEdit] = useState(null)
      const [loadErr, setLoadErr] = useState('')
      const [editErr, setEditErr] = useState('')
      const load = () => get('/mind/self').then((r) => {
        if (r && r.ok !== false) { setD(r); setLoadErr(''); setDraft(Object.fromEntries((r.personality?.traits || []).map((t) => [t.id, t.base]))) } else { setD(r || null); setLoadErr(r?.message || '读不到她的人格与自我') }
      }).catch((e) => setLoadErr('连不上插件：' + e.message))
      useEffect(() => { load() }, [])
      if (loadErr) return h('div', { className: 'ab-grid' }, h(ErrorBlock, { title: '读不到她的人格与自我', message: loadErr, hint: '人格卡和特质都跟着心智核心走。', onRetry: load }))
      if (!d) return h('div', { className: 'ab-grid' }, h(Skeleton, { kind: 'card', label: '正在读人格与自我' }), h(Skeleton, { kind: 'row', rows: 4, label: '正在读人格与自我' }))
      if (!d.ok) return h('div', { className: 'ab-grid' }, h(Empty, {
        icon: '🪞', title: '心智核心没起来',
        text: d.message || '人格卡、特质和习惯都读不到；去「模块管理」看看心智核心在不在跑。',
        action: '重新读取', onAction: load,
      }))
      const ps = d.personality
      const groups = [['E', '外向'], ['A', '宜人'], ['C', '尽责'], ['N', '情绪敏感'], ['O', '开放'], ['H', '诚实谦逊'], ['AT', '依恋'], ['X', '表达']]
      const restore = async (kind, id) => { if (!confirm('退回到这个版本？（会新存一个版本，写明是退回）')) return; const r = await post('/mind/self/restore', { kind, id }); toast(r.message || (r.ok ? '退回了' : '没成功')); load() }
      const infer = async () => { if (ps.confirmed && !confirm('重新从人格卡推一份？只是给你参考，确认之前不会改她本来的样子。')) return; setBusy(true); const r = await post('/mind/traits/infer', {}); setBusy(false); toast(r.message); load() }
      const confirmBase = async () => { const r = await post('/mind/traits/confirm', { base: draft }); toast(r.message); load() }
      const changeSelf = (what, label, multiline) => {
        const cur = what === 'values' || what === 'hobbies' || what === 'looks' ? d.profile[what] : what === 'story' ? d.profile.story.text : what === 'name' ? d.identity.name : what === 'ownerCall' ? d.ownerCall : d.identity.nickname
        setEdit({ what, label, multiline: Boolean(multiline), value: cur || '' })
      }
      const saveSelf = async () => {
        if (!edit) return
        if (!String(edit.value || '').trim()) { setEditErr('这一段不能空着'); return }
        setEditErr('')
        const r = await post('/mind/self/change', { what: edit.what, content: edit.value, why: '管理员在面板里改的' })
        toast(r.message); setEdit(null); load()
      }
      const unread = (ps.alerts || []).filter((a) => !a.read)
      const BY = { owner: '你', self: '她自己', sleep: '睡觉时', migration: '迁移' }
      return h(Fragment, null,
        edit ? h(Card, { title: '改' + edit.label, desc: '会存一个版本；长文字建议在「人设」页改。' },
          h(Field, {
            label: edit.label, textarea: true, rows: edit.multiline ? 6 : 2, value: edit.value, error: editErr,
            hint: '空着不保存；改完会在「性格的版本」里留一条记录。',
            onChange: (v) => { setEdit({ ...edit, value: v }); if (editErr && v.trim()) setEditErr('') },
          }),
          h('div', { className: 'ab-flex', style: { gap: 6 } },
            h(Btn, { small: true, kind: 'primary', onClick: saveSelf }, '保存'),
            h(Btn, { small: true, onClick: () => setEdit(null) }, '取消'))) : null,
        unread.length ? h(Card, { title: '提醒', right: h(Btn, { small: true, onClick: async () => { await post('/mind/traits/alerts/read', {}); load() } }, '知道了') },
          h('div', { className: 'ab-list' }, unread.map((a, i) => h('div', { key: i, className: 'ab-li' }, h('div', { className: 'meta' }, mindDay(a.at)), h('div', { className: 'body' }, a.text, h('span', { className: 'ab-muted ab-small' }, '  看下面「性格的版本」里的理由，必要时退回')))))) : null,
        h(Card, { fold: 'self-traits', title: '性格（19 项）', desc: '「本来的样子」相当于她的天生气质，从第一版人格卡推出来、由你确认，她改人格卡不会动它。「现在」随经历慢慢变：同一种表现要在不同的日子里出现够多次才走一小步，每晚睡觉时检查。数值只给你看，她看到的是每一档对应的那句话。' + (ps.shadowMode ? ' 影子模式开着：变化只计算、不生效。' : ''),
          right: h('div', { className: 'ab-flex', style: { gap: 6 } }, h(Btn, { small: true, onClick: infer, disabled: busy }, busy ? '推算中…' : '从人格卡推一份'), h(Btn, { small: true, kind: 'primary', onClick: confirmBase }, ps.confirmed ? '保存本来的样子' : '确认这就是她')) },
          !ps.confirmed ? h('div', { className: 'ab-note', style: { marginBottom: 10 } }, ps.inferred ? '下面「本来的样子」是从人格卡推出来的，括号里是依据。看看像不像她，不像就拖一下，再点「确认这就是她」。' : '还没推过：点「从人格卡推一份」（会调用一次模型），或者直接拖滑块设好再确认。') : null,
          groups.map(([g, label]) => h('div', { key: g, style: { marginBottom: 8 } },
            h('div', { className: 'ab-muted ab-small', style: { margin: '6px 0' } }, label),
            ps.traits.filter((t) => t.group === g).map((t) => h(Row, { key: t.id, label: t.label, hint: '现在：' + t.text + (t.band !== t.baseBand ? `（从第 ${t.baseBand} 档变到第 ${t.band} 档）` : '') + (ps.inferred && ps.inferred.why && ps.inferred.why[t.id] ? '　依据：' + ps.inferred.why[t.id] : '') },
              h('div', { className: 'ab-flex', style: { gap: 8, minWidth: 260 } },
                h(Range, { value: draft ? draft[t.id] : t.base, min: 0.02, max: 0.98, step: 0.01, onChange: (v) => setDraft({ ...draft, [t.id]: v }), fmt: (v) => '本来 ' + Math.round(v * 100) }),
                h('span', { className: 'ab-small', title: '现在的值' }, '现在 ' + Math.round(t.cur * 100) + (t.shadow !== null && t.shadow !== undefined && t.shadow !== t.cur ? '（影子 ' + Math.round(t.shadow * 100) + '）' : '')))))))),
        h(Card, { fold: 'self-habits', title: '小习惯', desc: '同一类场合里反复出现、又被正面回应的反应会变成习惯；被冷落、被责怪的慢慢消失。' },
          (ps.habits || []).length ? h('div', { className: 'ab-list' }, ps.habits.map((x) => h('div', { key: x.id, className: 'ab-li' },
            h('div', { className: 'meta' }, (x.active ? '已经是习惯' : '还在形成') + ' · 出现过 ' + x.count + ' 次'),
            h('div', { className: 'body' }, x.sit + '时，' + x.act)))) : h(Empty, { text: '还没有' })),
        h(Card, { title: '她自己写下的', desc: '她想通了可以随时改这些（人格卡、名字、价值观、爱好、外貌、自我故事、想变成的样子），改完会给你发通知（「设置 → 身份」里可以关），不需要你同意。年龄、生日、「专一」只有你能改。你也可以在这里改。' },
          h(Row, { label: '名字', hint: d.identity.name || '（没有）' }, h(Btn, { small: true, onClick: () => changeSelf('name', '名字') }, '改')),
          h(Row, { label: '小名', hint: d.identity.nickname || '（没有）' }, h(Btn, { small: true, onClick: () => changeSelf('nickname', '小名') }, '改')),
          h(Row, { label: '价值观', hint: d.profile.values || '（没写）' }, h(Btn, { small: true, onClick: () => changeSelf('values', '价值观') }, '改')),
          h(Row, { label: '爱好', hint: (d.profile.hobbies || '（没写）') + '（群里聊到这些，她更想接话）' }, h(Btn, { small: true, onClick: () => changeSelf('hobbies', '爱好') }, '改')),
          h(Row, { label: '外貌', hint: d.profile.looks || '（没写）' }, h(Btn, { small: true, onClick: () => changeSelf('looks', '外貌') }, '改')),
          h(Row, { label: '对你的称呼', hint: '她现在叫你「' + (d.ownerCall || '管理员') + '」' + (d.profile.ownerCall ? '' : '（你一开始设的）') + '。' + (d.ownerCallOk === true ? '她可以自己换个叫法，会通知你。' : '她现在不能自己改：' + d.ownerCallOk + '。') + '开关在「设置 → 身份」。' },
            h(Btn, { small: true, onClick: () => changeSelf('ownerCall', '对你的称呼') }, '改')),
          h(Row, { label: '想变成的样子', hint: (d.profile.goals || []).length ? d.profile.goals.map((g) => g.text).join('；') : '（没有）' }, (d.profile.goals || []).length ? h(Btn, { small: true, onClick: async () => { const g = d.profile.goals[0]; if (!confirm('删掉「' + g.text + '」？')) return; await post('/mind/self/goal/drop', { text: g.text }); load() } }, '删一个') : null)),
        h(Card, { fold: 'self-story', title: '她的故事', desc: '她用自己的话写的「我是怎么变成现在这样的」（叙事身份，McAdams）；有重要的经历时，睡觉整理会更新，重要的经历成为新的一章。', right: h(Btn, { small: true, onClick: () => changeSelf('story', '她的故事', true) }, '改') },
          d.profile.story.text ? h('div', { className: 'ab-small', style: { whiteSpace: 'pre-wrap' } }, d.profile.story.text) : h(Empty, { text: '还没写' }),
          (d.profile.story.chapters || []).length ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 8 } }, '章节：' + d.profile.story.chapters.map((c) => mindDay(c.at).slice(0, 10) + ' ' + c.title).join(' · ')) : null),
        h(Card, { fold: 'self-versions', title: '人格卡的版本', desc: '谁改的、为什么改。退回会新存一个版本。人格卡原文在「人设」页编辑。' },
          h('div', { className: 'ab-list' }, d.versions.persona.map((v, i) => h('div', { key: v.id, className: 'ab-li' },
            h('div', { className: 'meta' }, mindDay(v.at) + ' · ' + (BY[v.by] || v.by) + ' · ' + v.data.chars + ' 字' + (v.data.name ? ' · ' + v.data.name : '')),
            h('div', { className: 'body' }, v.reason || '（没写理由）'),
            i > 0 ? h(Btn, { small: true, onClick: () => restore('persona', v.id) }, '退回') : h('span', { className: 'ab-muted ab-small' }, '现在用的'))))),
        h(Card, { fold: 'self-changes', title: '她改过自己的记录' },
          d.versions.self.length ? h('div', { className: 'ab-list' }, d.versions.self.map((v) => h('div', { key: v.id, className: 'ab-li' },
            h('div', { className: 'meta' }, mindDay(v.at) + ' · ' + (BY[v.by] || v.by)),
            h('div', { className: 'body' }, v.reason, v.data && v.data.what !== 'persona' && v.data.what !== 'story' ? h('div', { className: 'ab-muted ab-small' }, (v.data.before ? '「' + String(v.data.before).slice(0, 60) + '」→ ' : '') + '「' + String(v.data.after || '').slice(0, 80) + '」') : null),
            v.data && v.data.what !== 'goal' ? h(Btn, { small: true, onClick: () => restore('self', v.id) }, '退回这一项') : null))) : h(Empty, { text: '还没改过' })),
        h(Card, { fold: 'self-trait-versions', title: '性格的版本', desc: '每次不知不觉走了一步、你确认或退回，都存一个版本，写着理由。' },
          d.versions.traits.length ? h('div', { className: 'ab-list' }, d.versions.traits.map((v, i) => h('div', { key: v.id, className: 'ab-li' },
            h('div', { className: 'meta' }, mindDay(v.at) + ' · ' + (BY[v.by] || v.by)),
            h('div', { className: 'body ab-small' }, v.reason),
            i > 0 ? h(Btn, { small: true, onClick: () => restore('traits', v.id) }, '退回') : null))) : h(Empty, { text: '还没有' })),
        h(MindVersions, { versions: d.versions, restore, load, toast }),
        h(Card, { fold: 'self-prompt', title: '她看到的「她是谁」', desc: '每轮放在系统提示词开头的内容（人格卡 + 她自己写的 + 故事摘要 + 不知不觉的变化）。很少变，所以大多数时候能命中缓存。' },
          h('pre', { className: 'ab-small', style: { whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' } }, d.prompt)))
    }
