    function Logs() {
      const [items, setItems] = useState(null)
      const [level, setLevel] = useState('info')
      const [area, setArea] = useState('')
      const [auto, setAuto] = useState(true)
      const [err, setErr] = useState('')
      const load = useCallback(() => get('/logs?limit=400&level=' + level + '&area=' + area).then((r) => {
        if (r && r.ok !== false) { setItems(r.entries || []); setErr('') } else { setItems([]); setErr(r?.message || '读不到日志') }
      }).catch((e) => { setItems([]); setErr('连不上插件：' + e.message) }), [level, area])
      useEffect(() => { load(); if (!auto) return; const t = setInterval(load, 3000); return () => clearInterval(t) }, [load, auto])
      return h(Card, { title: '日志', desc: '所有后台动作都在这里，令牌和密码已自动打码。完整日志文件在 ' + '~/.dsh/plugins-data/aurabot/logs/' + '。',
        right: h('div', { className: 'ab-flex' },
          h(Select, { value: level, onChange: setLevel, width: 110, options: [['debug', '全部'], ['info', '一般'], ['warn', '警告'], ['error', '错误']].map(([value, label]) => ({ value, label })) }),
          h(Select, { value: area, onChange: setArea, width: 130, options: [['', '所有模块'], ['core', '核心'], ['chat', '聊天'], ['onebot', 'QQ 网关'], ['snowluma', 'SnowLuma'], ['sticker', '表情'], ['qzone', '空间'], ['voice', '语音'], ['imagegen', '生图'], ['mind', '心智']].map(([value, label]) => ({ value, label })) }),
          h('span', { className: 'ab-switch-row' }, h(Switch, { on: auto, onChange: setAuto }), h('span', { className: 'ab-muted ab-small' }, '自动刷新'))) },
        err ? h(ErrorBlock, { title: '读不到日志', message: err, onRetry: load })
          : items === null ? h(Skeleton, { kind: 'row', rows: 6, label: '正在读日志' })
          : items.length === 0 ? h(Empty, {
            icon: '🗒️', title: '没有符合条件的日志',
            text: '换个级别或模块看看；「全部」会显示 debug 级别的细节。',
            action: '看全部级别', onAction: () => { setLevel('debug'); setArea('') },
          }) :
          h('div', { className: 'ab-logs' }, items.slice().reverse().map((e, i) => h(LogLine, { key: i, e }))))
    }

    // ---------------- 首次使用向导 ----------------
    const WIZ_STEPS = ['你们的 QQ 号', '接 QQ 网关', '连上机器人号', '完成']
