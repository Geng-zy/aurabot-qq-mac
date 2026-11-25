    function NoticeWorkspaces({ toast }) {
      const [info, setInfo] = useState(null)
      const load = async () => {
        try { setInfo(await get('/notice/state')) } catch (e) { setInfo({ ok: false, workspaces: [] }) }
      }
      useEffect(() => { load() }, [])
      const toggle = async (kind, workspace, value) => {
        try {
          const r = await post('/notice/toggle', { kind, workspace, value })
          if (r && r.ok === false) toast(r.message, 'err')
          await load()
        } catch (e) { toast(e.message, 'err') }
      }
      const list = info?.workspaces || []
      return h('div', { style: { marginTop: 6 } },
        h('div', { className: 'ab-small ab-muted', style: { margin: '4px 0' } }, '按工作区分开管（点了立刻生效）：'),
        list.length === 0
          ? h('div', { className: 'ab-muted ab-small' }, info ? '这个 DSH 里还没有工作区。' : '读取中…')
          : list.map((w) => h(Row, { key: w.path, label: w.name, hint: w.path + (w.sessions ? ` · ${w.sessions} 个会话` : '') },
            h('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
              h('span', { className: 'ab-small ab-muted' }, '授权'), h(Switch, { on: w.approval, onChange: (v) => toggle('approval', w.path, v) }),
              h('span', { className: 'ab-small ab-muted' }, '提问'), h(Switch, { on: w.question, onChange: (v) => toggle('question', w.path, v) })))))
    }
