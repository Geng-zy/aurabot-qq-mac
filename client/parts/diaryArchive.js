    function DiaryArchive({ st, draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState(false)
      const unsaved = JSON.stringify(draft.diary.archive) !== JSON.stringify(st.config.diary.archive)
      const load = () => get('/diary/archive').then(setStatus)
      useEffect(() => {
        load()
        const timer = setInterval(load, 15_000)
        return () => clearInterval(timer)
      }, [])
      return h(Card, { fold: 'diary-archive', title: '按日期归档浏览图', right: f.sw('diary.archive.enabled'), desc: '默认关闭。每五分钟把已有的公开浏览配图保存一份，按浏览日期放入 20261031 这样的文件夹。不截取桌面或聊天。' },
        h(Row, { label: '归档文件夹', hint: '管理员主动指定的输出目录，留空不保存；每张图附来源说明文件' }, f.text('diary.archive.folder', { placeholder: '请填写完整路径' })),
        h('div', { className: 'ab-small ab-muted', style: { margin: '10px 0' } }, status ? '已归档 ' + status.count + ' 张' + (status.lastAt ? ' · 最近收集 ' + new Date(status.lastAt).toLocaleString() : '') : '正在读取归档状态…'),
        status?.error ? h('div', { className: 'ab-small', style: { color: 'var(--ab-warn)' } }, status.error) : null,
        h(Btn, { kind: 'ghost', disabled: busy || unsaved || !draft.diary.archive?.enabled || !draft.diary.archive?.folder, onClick: async () => {
          setBusy(true)
          try { const result = await post('/diary/archive/collect', {}); toast(result.message || '归档完成'); await load() }
          finally { setBusy(false) }
        } }, busy ? '正在收集…' : '现在收集浏览图'),
        h('div', { className: 'ab-small ab-muted', style: { marginTop: 8 } }, '先保存设置。总开关关闭或试运行开启时不保存图片；归档本身不会发布到空间。要用作日记配图，另在上方启用指定图库。'),
      )
    }
