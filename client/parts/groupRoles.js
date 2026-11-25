    function GroupRoles() {
      const [result, setResult] = useState(null)
      const load = () => { setResult(null); get('/groups/roles').then(setResult) }
      const list = result?.list || []
      useEffect(load, [])
      return h(Card, { fold: 'qq-group-admin', title: '群管权限', desc: 'ta在群里是群主或群管理员时，管理员才能让ta禁言、踢人、发公告；改专属头衔要群主。按已保存的群白名单查。',
        right: h(Btn, { small: true, kind: 'ghost', onClick: load }, '刷新') },
        !result ? h('div', { className: 'ab-muted ab-small' }, h('i', { className: 'ab-spin' }), ' 查询中…')
          : !result.ok ? h('div', { className: 'ab-muted ab-small', role: 'status' }, result.message || '暂时查不到群管权限。')
          : list.length === 0 ? h('div', { className: 'ab-muted ab-small' }, '群白名单是空的。')
          : h('table', { className: 'ab-table' },
            h('thead', null, h('tr', null, ['群', 'ta的身份', '群管'].map((x) => h('th', { key: x }, x)))),
            h('tbody', null, list.map((g) => h('tr', { key: g.groupId },
              h('td', null, (g.name && g.name !== g.groupId ? g.name + ' ' : '') + '(' + g.groupId + ')'),
              h('td', null, g.label),
              h('td', null, g.canManage ? h('span', { className: 'ab-badge' }, '可以') : h('span', { className: 'ab-muted ab-small' }, '不行')))))))
    }

    /** 按群头衔不理：勾选的群里，专属头衔是某个词的成员（别的机器人）她不理。头衔可以从群里现有的里面点一个。 */
