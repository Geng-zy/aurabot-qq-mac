    function AsrStatus({ toast }) {
      const [s, setS] = useState(null)
      const load = () => get('/voice/asr-status').then(setS)
      useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [])
      const active = s?.enabled && s.provider
      const downloading = ['preparing', 'downloading'].includes(s?.phase)
      const phase = active ? ({ ready: '已就绪', standby: '已就绪（休眠中）', idle: '还没下载模型', preparing: '正在下载模型…', downloading: '正在下载模型…', failed: '下载失败', error: '下载失败' }[s.phase] || s.phase) : null
      return h('div', { className: 'ab-flex' },
        h('span', { className: 'ab-pill' }, h('i', { className: cx('ab-dot', active && ['ready', 'standby'].includes(s.phase) ? 'ok' : s ? 'warn' : '') }), s === null ? '查询中…' : 'DSH 识别：' + (phase || s.message || '读取状态失败')),
        active && !['ready', 'standby'].includes(s.phase) ? h(Btn, { small: true, disabled: downloading, onClick: async () => { const r = await post('/voice/asr-prepare'); toast(r.message); load() } }, '下载识别模型') : null,
        active && ['ready', 'standby'].includes(s.phase) ? h(Btn, { small: true, onClick: async () => { toast('正在测试…'); const r = await post('/voice/asr-test', { text: '今天想吃白米饭' }); toast(r.ok ? '念的是「' + r.said + '」，听成了「' + r.heard + '」' : r.message) } }, '测试一下') : null)
    }
