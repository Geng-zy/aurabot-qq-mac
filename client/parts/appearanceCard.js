    function AppearanceCard({ draft, toast }) {
      const [d, setD] = useState(null)
      const [busy, setBusy] = useState('')
      const [desc, setDesc] = useState(null)
      const fileRef = useRef(null)
      const load = () => get('/image/appearance').then((r) => { setD(r); setDesc(null) }).catch(() => setD({ ok: false, list: [] }))
      useEffect(() => { load() }, [])
      const upload = async (files) => {
        setBusy('upload')
        let n = 0
        try {
          for (const file of Array.from(files || [])) {
            const r = await fetch(API + '/image/appearance/upload', { method: 'POST', body: file }).then((x) => x.json()).catch((e) => ({ ok: false, message: e.message }))
            if (r && r.ok) n++
            else toast((file.name || '图片') + '：' + ((r && r.message) || '没导入成功'), 'err')
          }
          if (n) toast('导入了 ' + n + ' 张', 'ok')
        } finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; load() }
      }
      const act = async (path, body, ok) => { const r = await post(path, body); toast((r && r.message) || (r && r.ok ? ok : '没成功'), r && r.ok === false ? 'err' : 'ok'); load() }
      const describe = async () => { setBusy('describe'); try { const r = await post('/image/appearance/describe', {}); if (r.ok) { toast('写好了', 'ok'); load() } else toast(r.message, 'err') } finally { setBusy('') } }
      const list = (d && d.list) || []
      const img2imgOff = draft.imageGen && draft.imageGen.img2img === false
      const text = desc === null ? (d && d.description) || '' : desc
      return h(Card, { fold: 'image-appearance', title: '她的形象', desc: '导入几张她的图（最多 ' + ((d && d.max) || 8) + ' 张）。她画自己（自拍、她的样子、合照里有她）时会照着画：主图一定用，能一次收好几张参考图的生图服务（gpt-image 系列）其余几张也一起用。下面的形象描述也会加进提示词。' },
        img2imgOff ? h('div', { className: 'ab-note warn', style: { marginBottom: 8 } }, '「参考图」现在关着：她画自己时只用形象描述，不用这些图。') : null,
        h('div', { className: 'ab-flex', style: { gap: 8, marginBottom: 8 } },
          h('input', { ref: fileRef, type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, style: { display: 'none' }, onChange: (e) => upload(e.target.files) }),
          h(Btn, { small: true, kind: 'primary', disabled: busy === 'upload', onClick: () => fileRef.current && fileRef.current.click() }, busy === 'upload' ? '导入中…' : '导入图片（可以多选）')),
        !d ? h(Empty, { icon: '⏳', text: '加载中…' })
          : !list.length ? h(Empty, { icon: '🪞', text: '还没导入。导入以后，让她发自拍、画她自己时就会照着画。' })
            : h('div', { className: 'ab-shots' }, list.map((it) => {
              const src = API + '/image/appearance/image?file=' + encodeURIComponent(it.file)
              return h('div', { key: it.file, className: 'ab-shot' },
                h('a', { href: src, target: '_blank', rel: 'noreferrer' }, h('img', { src, alt: '她的形象', loading: 'lazy' })),
                h('div', { className: 'cap' }, it.primary ? '★ 主图' : h('a', { href: '#', onClick: (e) => { e.preventDefault(); act('/image/appearance/primary', { file: it.file }, '设成主图了') } }, '设为主图')),
                h(Btn, { small: true, kind: 'danger', title: '移到废纸篓', onClick: () => { if (confirm('把这张移到废纸篓？')) act('/image/appearance/delete', { file: it.file }, '移到废纸篓了') } }, '✕'))
            })),
        h(Row, { label: '形象描述', hint: '画她自己时加进提示词。可以点「看图写一段」让能看图的模型写，也可以自己写、改' },
          h('div', { style: { flex: 1 } },
            h('textarea', { className: 'ab-input', rows: 4, style: { width: '100%' }, value: text, placeholder: '比如：银白色长发、蓝眼睛、常穿水手服……', onChange: (e) => setDesc(e.target.value) }),
            h('div', { className: 'ab-flex', style: { gap: 6, marginTop: 6 } },
              h(Btn, { small: true, disabled: !list.length || busy === 'describe', onClick: describe }, busy === 'describe' ? '正在看图…' : '看图写一段'),
              desc !== null ? h(Btn, { small: true, kind: 'primary', onClick: () => act('/image/appearance/description', { text: desc }, '存好了') }, '保存描述') : null,
              text ? h(Btn, { small: true, kind: 'ghost', onClick: async () => { const r = await post('/mind/self/change', { what: 'looks', content: text, why: '管理员导入了她的形象图' }); toast((r && r.message) || '好了', r && r.ok === false ? 'err' : 'ok') } }, '也写进她的「外貌」') : null))))
    }
