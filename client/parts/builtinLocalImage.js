    function BuiltinLocalImage({ draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState('')
      const [preview, setPreview] = useState('')
      const [notice, setNotice] = useState('')
      useEffect(() => {
        let live = true
        let timer
        let active = busy === 'install' || status?.running || status?.pending > 0
        const poll = async () => {
          const next = await get('/image/local/status')
          if (!live) return
          if (typeof next.supported === 'boolean') {
            setStatus(next)
            active = next.running || next.pending > 0
          } else if (!active) setStatus(next)
          if (active) timer = setTimeout(poll, 1500)
        }
        poll()
        return () => { live = false; clearTimeout(timer) }
      }, [busy, status?.running, status?.pending])
      const act = async (action) => {
        setNotice('')
        setBusy(action)
        const result = await post('/image/local/' + action)
        if (action === 'install' && result.running) setStatus(result)
        setBusy('')
        if (result.image) setPreview(result.image)
        if (result.message) { setNotice(result.message); notify(toast, result) }
      }
      const download = status?.remainingBytes ? `约 ${(status.remainingBytes / 1024 ** 3).toFixed(1)} GiB 权重` : ''
      const label = status?.running ? status.step : !status ? '正在检查…' : status.supported === false ? '此设备不支持' : status.ready ? '已就绪' : status.supported ? '尚未部署' : '状态读取失败'
      return h('div', { className: 'ab-grid', style: { gap: 0 } },
        h(Row, { label: '本地模型', hint: 'Apple 芯片 · macOS 26 或更新版本 · 建议至少 16 GB 内存' },
          h('b', null, 'Qwen Image 2.1 · 4 位'), h('a', { href: 'https://huggingface.co/OsaurusAI/Qwen-Image-2.1-mflux-4bit/blob/235fd28de40d745382e9d7a33f008c7735ec21c2/LICENSE', target: '_blank', rel: 'noreferrer' }, '模型许可（非商业研究与评估）')),
        h(Row, { label: '部署状态' },
          h('span', { role: 'status' }, label),
          status?.reusedModel || status?.reusedPython ? h('span', { className: 'ab-muted ab-small' }, status.reusedModel && status.reusedPython ? '复用已有模型和环境' : status.reusedModel ? '复用已有模型' : '复用已有环境') : null,
          download && !status.running ? h('span', { className: 'ab-muted ab-small' }, '待下载 ' + download) : null),
        h(Row, { label: '运行环境', hint: '已有文件会复用。新环境装在 ~/Aurabot/imagegen，安装后可离线生成。' },
          h(Btn, { small: true, kind: status?.ready ? undefined : 'primary', disabled: !status?.supported || status.running || status.pending > 0 || Boolean(busy), onClick: () => {
            if (status.ready || confirm((download ? '将下载' + download + '并安装缺少的依赖。' : '将安装缺少的依赖。') + '继续表示你已查看并同意模型许可。')) act('install')
          } }, status?.running || busy === 'install' ? '正在部署…' : status?.ready ? '检查与修复' : '一键部署'),
          h(Btn, { small: true, disabled: !status?.ready || status.running || status.pending > 0 || Boolean(busy), onClick: () => act('test') }, busy === 'test' ? '正在试画…' : '试画一张')),
        (notice || status?.message) && !status?.running ? h('p', { className: 'ab-small', role: 'status' }, notice || status.message) : null,
        preview ? h('img', { src: 'data:image/png;base64,' + preview, alt: '本地生图试画结果', style: { width: 240, maxWidth: '100%', borderRadius: 8, margin: '8px 0' } }) : null,
        h(Row, { label: '生成步数', hint: '步数越多，生成越慢。保存后应用到聊天里的新任务。' }, f.num('imageGen.localSteps', { min: 4, max: 50 })))
    }
