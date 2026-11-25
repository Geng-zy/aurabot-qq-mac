    function TitleFilter({ draft, setDraft }) {
      const tf = draft.titleFilter || { enabled: true, groups: [], title: '大肥鱼' }
      const [info, setInfo] = useState(null) // { groups, titles, failed, message } 拉过才有 titles
      const [busy, setBusy] = useState(false)
      const set = (p) => setDraft(setPath(draft, 'titleFilter', { ...tf, ...p }))
      const pull = async () => {
        setBusy(true)
        const r = await get('/groups/titles')
        setBusy(false)
        if (r.ok) setInfo(r)
        else setInfo({ groups: [], titles: [], message: r.message || '没拉到' })
      }
      useEffect(() => { pull() }, [])
      const groups = (draft.allow.groups || []).map(String)
      const nameOf = (gid) => { const g = ((info && info.groups) || []).find((x) => x.groupId === gid); return g && g.name && g.name !== gid ? g.name : '' }
      const on = (gid) => tf.groups.includes(gid)
      const hit = info && info.titles ? info.titles.find((t) => t.title === tf.title.trim()) : null
      return h(Card, { fold: 'qq-title-filter', title: '按头衔不理（防机器人互聊）', right: h(Switch, { on: tf.enabled, onChange: (v) => set({ enabled: v }) }),
        desc: '同一个群里有别的机器人时，给它们挂上同一个专属头衔（比如「大肥鱼」），ta在勾选的群里就不理它们：说话、@ ta、戳ta都不回，免得机器人之间互相接话停不下来。只认专属头衔，昵称和群名片不算；私聊不受影响。' },
        h(Row, { label: '要不理的头衔', hint: '一字不差才算。下面列出白名单群里现有的头衔，点一个就填进来。' },
          h('div', { style: { width: '100%' } },
            h('div', { className: 'ab-flex' },
              h('input', { className: 'ab-input', value: tf.title, maxLength: 30, placeholder: '大肥鱼', onChange: (e) => set({ title: e.target.value }) }),
              h(Btn, { small: true, onClick: pull, disabled: busy }, busy ? '拉取中…' : '从群里拉取头衔')),
            info && info.titles ? h('div', { className: 'ab-psec-add', style: { marginTop: 10 } },
              info.titles.length
                ? info.titles.slice(0, 30).map((t) => h('button', { key: t.title, type: 'button', className: cx('ab-chip', t.title === tf.title.trim() && 'on'), title: t.members.map((m) => m.name).join('、'), onClick: () => set({ title: t.title }) }, t.title, h('span', { className: 'n' }, t.count + ' 人')))
                : h('span', { className: 'ab-muted ab-small' }, groups.length ? '这些群里还没有人挂专属头衔。' : '群白名单是空的，先在「权限」页加群。')) : null,
            hit ? h('div', { className: 'ab-tf-who' }, '挂着「' + hit.title + '」的：' + hit.members.map((m) => m.name + '（' + m.id + '）').join('、') + (hit.count > hit.members.length ? ' 等 ' + hit.count + ' 人' : '')) : null,
            info && info.message ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, info.message) : null)),
        h(Row, { label: '在哪些群生效', hint: '没勾的群照常回。只列白名单里的群。' },
          groups.length
            ? h('div', { className: 'ab-flex' }, groups.map((gid) => h('button', { key: gid, type: 'button', className: cx('ab-chip', on(gid) && 'on'), onClick: () => set({ groups: on(gid) ? tf.groups.filter((x) => x !== gid) : [...tf.groups, gid] }) },
              (on(gid) ? '✓ ' : '') + (nameOf(gid) || '群'), h('span', { className: 'n' }, gid))))
            : h('span', { className: 'ab-muted ab-small' }, '群白名单是空的。')),
        h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, '查不到某人的头衔时（网关抽风），那条先不回，过几秒再查；成员改了头衔一分钟内生效。'))
    }
