    function Knowledge({ toast }) {
      const [list, setList] = useState(null)
      const [edit, setEdit] = useState({})
      const [open, setOpen] = useState(null)
      const readSeq = useRef(0)
      const [q, setQ] = useState('')
      const [hits, setHits] = useState([])
      const [hasMore, setHasMore] = useState(false)
      const [submittedQ, setSubmittedQ] = useState('')
      const [renaming, setRenaming] = useState(null)
      const [folderFilter, setFolderFilter] = useState('')
      const [note, setNote] = useState({ title: '', content: '', scope: 'all' })
      const [loadErr, setLoadErr] = useState('')
      const load = () => get('/knowledge/list').then((r) => {
        if (r && r.ok !== false) { setList(r.list || []); setLoadErr('') } else { setList([]); setLoadErr(r?.message || '读不到知识库') }
      }).catch((e) => { setList([]); setLoadErr('连不上插件：' + e.message) })
      useEffect(() => { void load() }, [])
      const mark = (text) => {
        const needle = String(submittedQ || q || '').trim()
        if (!needle) return text
        const safe = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return String(text || '').split(new RegExp('(' + safe + ')', 'ig')).map((part, i) => part.toLowerCase() === needle.toLowerCase() ? h('mark', { key: i }, part) : part)
      }
      const preview = async (path) => {
        const seq = ++readSeq.current
        setOpen({ path, text: '加载中…' })
        const r = await get('/knowledge/read?path=' + encodeURIComponent(path) + '&offset=0&limit=30000')
        if (seq !== readSeq.current) return
        setOpen(r.ok ? { path, text: r.text, total: r.total, truncated: r.truncated, offset: String(r.text || '').length } : { path, text: r.message || '读取失败' })
      }
      const loadMore = async () => {
        if (!open?.path || open.truncated === false) return
        const seq = ++readSeq.current
        const r = await get('/knowledge/read?path=' + encodeURIComponent(open.path) + '&offset=' + encodeURIComponent(open.offset || 0) + '&limit=30000')
        if (seq !== readSeq.current) return
        if (!r.ok) { toast(r.message || '读取失败', 'err'); return }
        setOpen({ ...open, text: open.text + r.text, total: r.total, truncated: r.truncated, offset: (open.offset || 0) + String(r.text || '').length })
      }
      const importScope = (text) => {
        const clean = String(text || '').replace(/^\uFEFF/, '').replace(/^\s*?(?=---\s*\n)/u, '')
        const m = /^---\s*\n([\s\S]*?)\n---/u.exec(clean)
        const line = m && m[1].split(/\r?\n/).find((x) => /^\s*(scope|visibility)\s*:/i.test(x))
        if (!line) return note.scope || 'all'
        return line.replace(/^\s*(scope|visibility)\s*:\s*/i, '').trim().replace(/^['"]|['"]$/g, '')
      }
      const importFile = async (e) => {
        const file = e.target.files?.[0]
        if (!file) return
        try {
          const text = await file.text()
          const scope = importScope(text)
          if (!confirm(`导入「${file.name}」\n可见范围：${scope || '（空，服务端会拒绝）'}\n确认写入知识库？`)) return
          const r = await post('/knowledge/note', { title: file.name.replace(/\.[^.]+$/, ''), content: text, scope })
          toast(r.ok ? '导入了' : (r.message || '导入失败'), r.ok ? 'ok' : 'err')
          if (r.ok) load()
        } catch (error) { toast('读取文件失败：' + error.message, 'err') }
        e.target.value = ''
      }
      const search = async (reset = true) => {
        const needle = reset ? q.trim() : submittedQ.trim()
        if (!needle) { setHits([]); setHasMore(false); return }
        if (reset) setSubmittedQ(needle)
        const offset = reset ? 0 : hits.length
        const r = await get('/knowledge/search?q=' + encodeURIComponent(needle) + '&limit=30&offset=' + offset)
        const next = r.list || []
        setHits(reset ? next : [...hits, ...next])
        setHasMore(Boolean(r.hasMore))
      }
      const importFolder = async (e) => {
        const files = [...(e.target.files || [])].filter((f) => /\.(md|txt)$/i.test(f.name))
        if (!files.length) { toast('文件夹里没有 .md / .txt', 'err'); return }
        const previews = []
        const ready = []
        const preFailed = []
        for (const file of files) {
          try {
            const text = await file.text()
            const scope = importScope(text)
            if (!scope) { preFailed.push(`${file.name}: scope 为空`); continue }
            ready.push({ file, text, scope })
            previews.push(`${file.name} → ${scope}`)
          } catch (error) { preFailed.push(`${file.name}: ${error.message}`) }
        }
        if (!confirm(`将导入 ${ready.length} 份文件${preFailed.length ? `，另有 ${preFailed.length} 份读取/范围为空的不会提交` : ''}\n\n${previews.join('\n')}${preFailed.length ? '\n\n不会提交：\n' + preFailed.join('\n') : ''}\n\n确认写入？`)) { e.target.value = ''; return }
        let ok = 0
        const failed = [...preFailed]
        for (const { file, text, scope } of ready) {
          try {
            const folder = String(file.webkitRelativePath || file.name).split('/').slice(0, -1).join('/')
            const r = await post('/knowledge/note', { title: file.name.replace(/\.[^.]+$/, ''), content: text, scope, folder })
            if (r.ok) ok++
            else failed.push(`${file.name}: ${r.message || '失败'}`)
          } catch (error) { failed.push(`${file.name}: ${error.message}`) }
        }
        toast(`导入 ${ok}/${files.length}${failed.length ? '；失败：' + failed.slice(0, 3).join('；') : ''}`, ok ? 'ok' : 'err')
        load(); e.target.value = ''
      }
      const save = async (path) => {
        const current = list?.find((f) => f.path === path)?.scope
        const scope = edit[path] ?? current
        if (!scope) { toast('scope 不能为空', 'err'); return }
        const r = await post('/knowledge/scope', { path, scope })
        toast(r.ok ? '改好了' : (r.message || '没改成'), r.ok ? 'ok' : 'err')
        if (r.ok) load()
      }
      const folders = list ? [...new Set(list.map((f) => f.path.split('/').slice(0, -1).join('/')).filter(Boolean))] : []
      const shown = list ? (folderFilter ? list.filter((f) => f.path.split('/').slice(0, -1).join('/') === folderFilter) : list) : null
      const rows = shown ? shown.map((f) => h('tr', { key: f.path },
        h('td', null,
          renaming?.path === f.path
            ? h('div', { className: 'ab-flex', style: { gap: 6 } },
              h('input', { className: 'ab-input sm', value: renaming.value, onChange: (e) => setRenaming({ ...renaming, value: e.target.value }) }),
              h(Btn, { small: true, onClick: async () => {
                const r = await post('/knowledge/rename', { path: f.path, title: renaming.value })
                toast(r.ok ? '改好了' : (r.message || '没改成'), r.ok ? 'ok' : 'err')
                if (r.ok) { setRenaming(null); load() }
              } }, '保存'),
              h(Btn, { small: true, kind: 'ghost', onClick: () => setRenaming(null) }, '取消'))
            : h('div', null,
              h('button', { className: 'ab-link', onClick: () => preview(f.path) }, h('b', null, f.title)),
              h('div', { className: 'ab-muted ab-small' }, f.path))),
        h('td', null, h('input', {
          className: 'ab-input', value: edit[f.path] ?? f.scope,
          placeholder: 'all / private / group / qq:group:9',
          onChange: (e) => setEdit({ ...edit, [f.path]: e.target.value }),
        })),
        h('td', { style: { textAlign: 'right' } },
          h(Btn, { small: true, onClick: () => save(f.path) }, '保存'),
          h(Btn, { small: true, kind: 'ghost', onClick: () => setRenaming({ path: f.path, value: f.title }) }, '改名'),
          h(Btn, { small: true, kind: 'danger', onClick: async () => {
            if (!confirm('删掉这个知识库文件？')) return
            const r = await post('/knowledge/delete', { path: f.path })
            toast(r.ok ? '删掉了' : (r.message || '删不掉'), r.ok ? 'ok' : 'err')
            if (r.ok) load()
          } }, '删除')))) : []
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '知识库文件', desc: 'data/knowledge 下的 Markdown / 文本。scope 控制哪些会话能读。', right: h('span', { className: 'ab-flex', style: { gap: 6 } }, h(Select, { value: folderFilter, onChange: setFolderFilter, width: 170, options: [{ value: '', label: '全部目录' }, ...folders.map((f) => ({ value: f, label: f }))] }), h(Btn, { small: true, kind: 'ghost', onClick: load }, '刷新')) },
          loadErr ? h(ErrorBlock, { title: '读不到知识库', message: loadErr, hint: '知识库文件在数据目录 knowledge/ 下。', onRetry: load })
            : !list ? h(Skeleton, { kind: 'row', rows: 4, label: '正在读知识库' })
            : list.length === 0 ? h(Empty, {
              icon: '📚', title: '知识库还是空的',
              text: '把资料放进数据目录的 knowledge/raw（支持 Markdown 与纯文本），或者在这一页直接写一篇笔记。',
              action: '写第一篇笔记', onAction: () => { const box = document.getElementById('ab-knowledge-new'); box?.scrollIntoView({ block: 'center' }); box?.querySelector('input,textarea')?.focus() },
            })
              : h('table', { className: 'ab-table' }, h('tbody', null, rows))),
        h(Card, { title: '全文搜索', desc: '在 knowledge/raw 和 notes 里按关键词搜，返回命中的文件和片段。' },
          h('div', { className: 'ab-flex', style: { gap: 8 } },
            h('input', { className: 'ab-input', style: { flex: 1 }, value: q, placeholder: '搜资料、笔记、设定…', onChange: (e) => setQ(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') search() } }),
            h(Btn, { small: true, onClick: () => search(true) }, '搜索')),
          hits.length ? h('div', { style: { marginTop: 8 } }, hits.map((x, i) => h('button', { key: i, className: 'ab-link', style: { display: 'block', textAlign: 'left', marginTop: 6 }, onClick: () => preview(x.path) },
            h('b', null, x.path), h('div', { className: 'ab-muted ab-small' }, mark(x.snippet))))) : null,
          hasMore ? h('div', { style: { marginTop: 8 } }, h(Btn, { small: true, onClick: () => search(false) }, '加载更多')) : null,
        ),
        h(Card, { title: '写一篇笔记', desc: '写进 knowledge/notes，之后可以检索。scope 控制哪些会话能读。' },
          h('div', { className: 'ab-note', style: { marginBottom: 8 } }, `导入范围预览：${note.scope || 'all'}（文件自带 scope 优先；导入前可在下面修改）`),
          h(Row, { label: '标题' }, h('input', { className: 'ab-input wide', value: note.title, placeholder: '例如：九群设定', onChange: (e) => setNote({ ...note, title: e.target.value }) })),
          h(Row, { label: 'scope' }, h('input', { className: 'ab-input wide', value: note.scope, placeholder: 'all / private / group / qq:group:9', onChange: (e) => setNote({ ...note, scope: e.target.value }) })),
          h(Row, { label: '正文' }, h('textarea', { className: 'ab-input wide', rows: 5, value: note.content, placeholder: 'Markdown 正文', onChange: (e) => setNote({ ...note, content: e.target.value }) })),
          h('div', { className: 'ab-flex', style: { marginTop: 8 } },
            h('input', { type: 'file', accept: '.md,.txt,text/markdown,text/plain', onChange: importFile }),
            h('label', { className: 'ab-btn ab-btn-small', style: { cursor: 'pointer' } },
              '导入文件夹', h('input', { type: 'file', webkitdirectory: '', multiple: true, style: { display: 'none' }, onChange: importFolder })),
            h(Btn, { small: true, onClick: async () => {
            const r = await post('/knowledge/note', note)
            toast(r.ok ? '写好了' : (r.message || '没写成'), r.ok ? 'ok' : 'err')
            if (r.ok) { setNote({ title: '', content: '', scope: 'all' }); load() }
          } }, '写入知识库')),
        ),
        open ? h(Card, { title: open.path, right: h(Btn, { small: true, kind: 'ghost', onClick: () => { readSeq.current++; setOpen(null) } }, '关闭') },
          h('pre', { style: { whiteSpace: 'pre-wrap', maxHeight: 460, overflow: 'auto', fontSize: 12.5 } }, open.text),
          open.total ? h('div', { className: 'ab-small ab-muted', style: { marginTop: 6 } }, `已显示 ${String(open.text || '').length} / ${open.total} 字` + (open.truncated ? '，还有后续内容' : '，已到结尾')) : null,
          open.truncated ? h('div', { style: { marginTop: 6 } }, h(Btn, { small: true, onClick: loadMore }, '加载更多')) : null) : null,
      )
    }
