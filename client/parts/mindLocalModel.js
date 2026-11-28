    function MindLocalModel({ toast, usage, settings }) {
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState('')
      const [result, setResult] = useState(null)
      const load = () => get('/mind/local/install/status').then(setStatus)
      useEffect(() => { load() }, [settings])
      useEffect(() => {
        if (!status?.running) return
        let cancelled = false
        let timer
        const poll = async () => {
          const next = await get('/mind/local/install/status')
          if (cancelled) return
          // 读状态失败时保留最后一步进度，下次再试。
          if (typeof next.running === 'boolean') setStatus(next)
          if (next.running !== false) timer = setTimeout(poll, 1000)
        }
        timer = setTimeout(poll, 1000)
        return () => { cancelled = true; clearTimeout(timer) }
      }, [status?.running])
      const act = async (action) => {
        setBusy(action)
        setResult(null)
        try {
          const response = await post('/mind/local/' + action)
          // 安装请求只确认任务已启动，完成结果来自安装状态接口。
          if (action === 'install' && response.ok) {
            setStatus((current) => ({ ...current, running: true, step: '', log: [], message: '' }))
            return
          }
          setResult(response)
          notify(toast, response)
          await load()
        } finally {
          setBusy('')
        }
      }
      const local = status?.local
      const canInstall = status?.supported !== false
      const notice = status?.running ? '' : result?.message || status?.message || local?.lastError
      const pathRow = (label, path) => path
        ? h(Row, { label }, h('code', { className: 'ab-small', style: { wordBreak: 'break-all' } }, path))
        : null
      return h(Card, { fold: 'mind-local-model', title: '本地小模型', desc: '处理日常念头。已有模型和 Python 环境会直接复用，约占 6 GB 内存，闲置后自动停止。' },
        h(Row, { label: '状态' }, !status ? '读取中…' : !local ? status.message || '心智核心未就绪'
          : local.configured ? (local.running ? '已就绪 · 运行中' : '已就绪 · 用时启动') : local.reason || '尚未安装'),
        pathRow('实际模型路径', local?.modelDir || status?.paths?.model),
        pathRow('实际 Python 路径', local?.python || status?.paths?.python),
        usage ? h(Row, { label: '今日后台用量' }, Math.round((usage.tokens || 0) / 1000) + 'K token') : null,
        status?.running || busy === 'install' ? h(Row, { label: '安装进度', hint: (status?.log || []).at(-1) || '' },
          status?.step || '正在检查本地环境…') : null,
        notice && busy !== 'install' ? h('div', { className: 'ab-small', role: 'status' }, notice) : null,
        local ? h('div', { className: 'ab-flex', style: { gap: 8 } },
          h(Btn, { small: true, kind: local.configured ? undefined : 'primary', disabled: !canInstall || status.running || Boolean(busy), onClick: async () => {
            if (local.configured || (await AB_CONFIRM.ask('安装到 ~/Aurabot/mind？', { hint: '已有文件会复用。缺少模型时会下载约 18 GB 的原版权重并在本机转换。', confirmLabel: '安装' }))) act('install')
          } }, status.running ? '正在检查或安装…' : local.configured ? '检查与修复' : '一键下载安装'),
          h(Btn, { small: true, disabled: !local.configured || status.running || Boolean(busy), onClick: () => act('test') }, busy === 'test' ? '正在测试…' : '试一下')) : null,
        local && !canInstall ? h('p', { className: 'ab-muted ab-small' }, '一键安装需要 Apple 芯片 Mac。') : null)
    }
