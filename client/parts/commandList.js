    function CommandList() {
      const [list, setList] = useState([])
      useEffect(() => { get('/commands').then((r) => setList(r.list || [])) }, [])
      return h(Card, { fold: 'qq-commands', title: 'QQ 命令', desc: '管理员在 QQ 里（私聊或白名单群）直接发这些命令就能管ta，别人发了不算。总开关关着时也能用。' },
        h('table', { className: 'ab-table' }, h('tbody', null, list.map((c) => h('tr', { key: c.name },
          h('td', { style: { whiteSpace: 'nowrap' } }, h('code', null, '/' + c.name), c.aliases.length ? h('div', { className: 'ab-muted ab-small' }, c.aliases.map((a) => '/' + a).join(' ')) : null),
          h('td', null, c.desc))))))
    }

    /** 她在每个白名单群里的身份：群主 / 群管理员才能禁言踢人。 */
