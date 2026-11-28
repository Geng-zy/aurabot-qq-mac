    function Backup({ toast }) {
      const [s, setS] = useState(null)
      const [path, setPath] = useState('')
      const [busy, setBusy] = useState(false)
      const [over, setOver] = useState(false)
      const [remoteFiles, setRemoteFiles] = useState(null)
      const [remoteBusy, setRemoteBusy] = useState(false)
      const [checks, setChecks] = useState({})
      const fileRef = useRef(null)
      const [loadErr, setLoadErr] = useState('')
      const [pendingFile, setPendingFile] = useState(null)
      const [pendingRemote, setPendingRemote] = useState('')
      const [confirmCancelSessions, setConfirmCancelSessions] = useState(false)
      const load = () => get('/backup/state').then((r) => {
        if (r && r.ok !== false) { setS(r); setLoadErr('') } else { setS(null); setLoadErr(r?.message || '读不到备份状态') }
      }).catch((e) => setLoadErr('连不上插件：' + e.message))
      useEffect(() => { load() }, [])
      const running = Boolean(s && s.job && s.job.running)
      useEffect(() => {
        if (!running) return
        const t = setInterval(load, 1000)
        return () => clearInterval(t)
      }, [running])
      const call = (p, body) => fetch(API + p, { method: 'POST', headers: { 'x-aurabot-backup': '1', 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json()).catch((error) => ({ ok: false, message: '备份请求失败：' + error.message }))
      const after = (r) => { toast(r.ok ? (r.message || ('备份已导入（' + r.files + ' 个文件），重启 DSH 后换上')) : r.message, r.ok ? 'ok' : 'err'); load() }
      const upload = async (file) => {
        if (!file) return
        // 危险动作走行内二次确认（见页面里的 pendingFile 区块）
        setPendingFile(file)
      }
      const uploadConfirmed = async () => {
        const file = pendingFile
        setPendingFile(null)
        if (!file) return
        setBusy(true)
        try { after(await fetch(API + '/backup/upload', { method: 'POST', headers: { 'x-aurabot-backup': '1' }, body: file }).then((r) => r.json())) } catch (e) { toast(e.message) } finally { setBusy(false) }
      }
      const loadRemote = async () => {
        setRemoteBusy(true)
        try {
          const r = await call('/backup/remote/list')
          if (!r.ok) toast(r.message, 'err')
          else setRemoteFiles(r.files || [])
        } finally { setRemoteBusy(false) }
      }
      const restoreRemote = async (name) => setPendingRemote(name)
      const restoreRemoteConfirmed = async () => {
        const name = pendingRemote
        setPendingRemote('')
        if (!name) return
        setBusy(true)
        try { after(await call('/backup/remote/restore', { name })) } finally { setBusy(false) }
      }
      const deferredHint = () => s?.deferredSessions?.remaining ? `\n\n注意：现在还有 ${s.deferredSessions.remaining} 个会话等待工作区「${s.deferredSessions.target}」，导入新备份会替换这个等待任务。` : ''
      const retrySessions = async () => {
        setBusy(true)
        try { after(await call('/backup/sessions/retry')) } finally { setBusy(false) }
      }
      const cancelSessions = async () => {
        setConfirmCancelSessions(false)
        setBusy(true)
        try { after(await call('/backup/sessions/cancel')) } finally { setBusy(false) }
      }
      const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB')
      const verify = async (name) => {
        setChecks((old) => ({ ...old, [name]: { busy: true } }))
        const r = await call('/backup/verify', { name })
        setChecks((old) => ({ ...old, [name]: r }))
        toast(r.ok ? '备份校验通过' : (r.message || '校验失败'), r.ok ? 'ok' : 'err')
      }
      const job = s && s.job
      const backupRows = s?.list?.length ? h('div', { style: { marginTop: 10 } }, s.list.slice(0, 8).map((b) => {
        const c = checks[b.name] || {}
        return h('div', { key: b.name, className: 'ab-small', style: { marginTop: 4 } },
          h('div', null, b.name + ' · ' + size(b.bytes) + (b.createdAt ? ' · ' + String(b.createdAt).replace(/^(\d{4})(\d{2})(\d{2})-(\d{6}).*$/, '$1-$2-$3 $4') : '')),
          h('div', { className: 'ab-flex', style: { gap: 6, marginTop: 2 } },
            h(Btn, { small: true, disabled: c.busy, onClick: () => verify(b.name) }, c.busy ? '校验中…' : '验证'),
            c.ok ? h('span', { className: 'ab-muted' }, `✓ ${c.files} 个文件 · ${c.configOnly ? '仅配置' : '完整'} · ${c.version || '版本未知'}${c.sessions ? ' · ' + c.sessions + ' 个会话' : ''}`) : c.message ? h('span', { style: { color: 'var(--ab-err)' } }, c.message) : null))
      })) : null
      if (loadErr) return h('div', { className: 'ab-grid' }, h(ErrorBlock, { title: '读不到备份状态', message: loadErr, hint: '备份目录在数据目录 backups/ 下。', onRetry: load }))
      if (!s) return h('div', { className: 'ab-grid' }, h(Skeleton, { kind: 'card', label: '正在读备份状态' }), h(Skeleton, { kind: 'row', rows: 3, label: '正在读备份状态' }))
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '备份', desc: '把配置、记忆、人设、表情、模块和ta的数据打成一个文件，放到新电脑上恢复。' },
          h('div', { className: 'ab-note warn', style: { marginBottom: 10 } }, '备份文件里有账号凭证和聊天记录，别发给别人，也别传到公开的地方。'),
          h('div', { className: 'ab-flex' },
            h(Btn, { small: true, kind: 'primary', disabled: running, onClick: async () => { after(await call('/backup/create')) } }, running ? '打包中 ' + (job.done || 0) + ' / ' + (job.total || '…') : '立即备份'),
            h(Btn, { small: true, onClick: async () => { const r = await call('/backup/open'); if (!r.ok) toast(r.message) } }, '打开备份文件夹')),
          job && job.error ? h('div', { className: 'ab-note err', style: { marginTop: 10 } }, '备份失败：' + job.error) : null,
          job && job.result ? h('div', { className: 'ab-small ab-muted', style: { marginTop: 10 } }, '刚生成：' + job.result.name + '，' + job.result.files + ' 个文件' + (job.result.skipped.length ? '；有 ' + job.result.skipped.length + ' 个文件没能带上：' + job.result.skipped.slice(0, 5).join('、') : '')) : null,
          s?.ok === false ? h('div', { className: 'ab-note err', role: 'status' }, s.message || '读不到备份状态') : null,
          backupRows),
        h(RemoteBackup, { toast }),
        h(Card, { fold: 'backup-restore', title: '从备份恢复', desc: '在新电脑上先装好 DSH 和 Aurabot，再把备份拖进来。重启 DSH 后自动换上设置和数据、重新安装模块库里的模块、放回 QQ 会话，原来的文件留在 backups 文件夹。' },
          s && s.modules && s.modules.length ? h('div', { className: 'ab-small ab-muted', style: { marginBottom: 8 } }, '还没装回来的模块：' + s.modules.join('、') + '（下次启动再试）') : null,
          s && s.deferredSessions ? h('div', { className: 'ab-note warn', style: { marginBottom: 10 } },
            '还有 ' + s.deferredSessions.remaining + ' 个会话等待工作区「' + s.deferredSessions.target + '」；普通数据已经恢复。挂回外盘后可以继续补会话。',
            h('div', { className: 'ab-flex', style: { marginTop: 8 } },
              h(Btn, { small: true, kind: 'primary', disabled: busy || !s.deferredSessions.remaining, onClick: retrySessions }, busy ? '处理中…' : '继续恢复会话'),
              confirmCancelSessions
                ? h(ConfirmInline, { question: '取消等待中的会话恢复？', hint: '已经恢复的普通数据不会撤销。', confirmLabel: '取消等待', onConfirm: cancelSessions, onCancel: () => setConfirmCancelSessions(false) }, '取消等待')
                : h(Btn, { small: true, kind: 'ghost', disabled: busy, onClick: () => setConfirmCancelSessions(true) }, '取消等待'))) : null,
          s && s.pending ? h('div', { className: 'ab-note warn' }, '已导入 ' + s.pending.files + ' 个文件（备份于 ' + String(s.pending.createdAt || '').slice(0, 16).replace('T', ' ') + '），重启 DSH 后换上。',
            h('div', { style: { marginTop: 8 } }, h(Btn, { small: true, kind: 'ghost', onClick: async () => { after(await call('/backup/cancel')) } }, '取消恢复'))) : [
            h('input', { key: 'f', ref: fileRef, type: 'file', accept: '.zip', style: { display: 'none' }, onChange: (e) => { upload(e.target.files[0]); e.target.value = '' } }),
            h('div', { key: 'b', className: cx('ab-drop', over && 'over'), onClick: () => fileRef.current && fileRef.current.click(),
              onDragOver: (e) => { e.preventDefault(); setOver(true) }, onDragLeave: () => setOver(false),
              onDrop: (e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files[0]) } }, busy ? '导入中…' : '把备份 zip 拖到这里，或点这里选择文件'),
          pendingFile ? h(ConfirmInline, {
            question: '导入「' + pendingFile.name + '」并替换本机数据？',
            hint: '重启 DSH 后，这台电脑上的配置、记忆、人设等会被这份备份替换；原来的文件留在 backups 文件夹。' + (deferredHint() ? ' 注意：' + String(deferredHint()).trim() : ''),
            confirmLabel: '导入并替换', onConfirm: uploadConfirmed, onCancel: () => setPendingFile(null),
          }, '确认导入') : null,
            h('div', { key: 'p', className: 'ab-flex', style: { marginTop: 10 } },
              h('input', { className: 'ab-input', placeholder: '文件很大时填完整路径，如 ' + exPath('Desktop/aurabot-backup.zip'), value: path, onChange: (e) => setPath(e.target.value) }),
              path.trim() ? h(ConfirmInline, {
                question: '导入「' + path.trim() + '」并替换本机数据？',
                hint: '重启 DSH 后会替换这台电脑上的配置、记忆与人设。' + (deferredHint() ? ' 注意：' + String(deferredHint()).trim() : ''),
                confirmLabel: '导入并替换',
                onConfirm: async () => { setBusy(true); try { after(await call('/backup/restore-path', { path })) } finally { setBusy(false) } },
              }, '导入') : h(Btn, { small: true, disabled: true }, '导入')),
            h('div', { key: 'r', style: { marginTop: 14 } },
              h('div', { className: 'ab-section-title' }, '从 WebDAV 恢复'),
              h('div', { className: 'ab-flex' },
                h(Btn, { small: true, disabled: remoteBusy, onClick: loadRemote }, remoteBusy ? '读取中…' : '拉取备份列表')),
              remoteFiles === null
                ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, '先在「云备份」里切到 WebDAV 并保存设置。')
                : remoteFiles.length === 0
                  ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, '远端 aurabot-backups 里还没有备份。')
                  : h('div', { style: { marginTop: 8 } }, remoteFiles.map((name) => h('div', { key: name, className: 'ab-flex', style: { alignItems: 'center', padding: '5px 0', borderTop: '1px solid var(--ab-line)' } },
                    h('span', { className: 'ab-small', style: { flex: 1, minWidth: 0, wordBreak: 'break-all' } }, (name.startsWith('aurabot-config-') ? '仅配置 · ' : '') + name),
                    pendingRemote === name
                      ? h(ConfirmInline, { question: '从 WebDAV 拉回「' + name + '」并恢复？', hint: '重启 DSH 后替换本机数据。', confirmLabel: '拉回并恢复', onConfirm: restoreRemoteConfirmed, onCancel: () => setPendingRemote('') }, '拉回并恢复')
                      : h(Btn, { small: true, disabled: busy, onClick: () => restoreRemote(name) }, '拉回并恢复'))))),
          ]),
        h(Card, { fold: 'backup-exclusions', title: '备份范围', desc: '这些要在新电脑上重新弄一下。' },
          h('div', { className: 'ab-small ab-muted' }, 'DSH 自己的设置和模型密钥、QQ 网关 SnowLuma 的登录、QQ 工作区以外的 DSH 会话；外部模块的浏览器登录要重新扫码；日志和缓存不备份；翻唱环境和外部桌面模块的 Electron 要重新安装；数据目录以外的路径（比如 ffmpeg、本地图片文件夹）在新电脑上要重新填。')))
    }
