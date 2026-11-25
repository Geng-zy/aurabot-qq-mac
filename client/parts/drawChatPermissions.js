    function DrawChatPermissions({ st, draft, setDraft }) {
      const owner = String(draft.platforms?.qq?.ownerQQ || draft.ownerQQ || '')
      const bot = String(draft.platforms?.qq?.botQQ || draft.botQQ || '')
      const [names, setNames] = useState({})
      const savedAllow = st.config?.platforms?.qq?.allow || st.config?.allow
      useEffect(() => {
        let active = true
        get('/access/chat-names').then((result) => {
          if (active && result.ok) setNames(result)
        }).catch(() => {})
        return () => { active = false }
      }, [savedAllow?.private?.join(','), savedAllow?.groups?.join(',')])

      const row = (kind, label, ids, fallback) => {
        const selected = draft.platforms?.qq?.drawAllow?.[kind] ?? draft.drawAllow?.[kind] ?? []
        return h(Row, { label }, ids.length
          ? ids.map((id) => h('button', {
            className: cx('ab-chip', selected.includes(id) && 'on'), key: id, type: 'button',
            'aria-pressed': selected.includes(id),
            onClick: () => setDraft((prev) => {
              const current = prev.platforms?.qq?.drawAllow?.[kind] ?? prev.drawAllow?.[kind] ?? []
              return setPath(prev, 'platforms.qq.drawAllow.' + kind, current.includes(id) ? current.filter((x) => x !== id) : [...current, id])
            }),
          }, names[kind]?.[id] || fallback, h('span', { className: 'n' }, id)))
          : h('span', { className: 'ab-muted ab-small' }, '暂无可选会话。'))
      }

      return h(Card, { fold: 'qq-draw-allow', title: '生图白名单', desc: '生图启用后，管理员有权限画图。其他人只能在这里勾选的会话里请求画图。' },
        row('private', '其他好友私聊', ((draft.platforms?.qq?.allow || draft.allow)?.private || []).map(String).filter((id) => id !== owner && id !== bot), '好友'),
        row('groups', 'QQ 群', ((draft.platforms?.qq?.allow || draft.allow)?.groups || []).map(String), '群'))
    }
