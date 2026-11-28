    function PaintGallery({ draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const shown = Math.min(50, Math.max(1, Number(draft.imageGen && draft.imageGen.galleryShown) || 20))
      const [data, setData] = useState(null)
      const load = async () => {
        const r = await get('/image/gallery?limit=' + shown).catch(() => null)
        setData(r && r.ok ? r : { items: [], total: 0, dir: '' })
      }
      useEffect(() => { load() }, [shown])
      const del = async (file) => {
        if (!(await AB_CONFIRM.ask('删掉这张画？', { hint: file, confirmLabel: '删掉' }))) return
        const r = await post('/image/gallery/delete', { file }).catch(() => ({ ok: false }))
        toast(r.message || (r.ok ? '删掉了' : '删除失败'), r.ok ? 'ok' : 'err')
        load()
      }
      return h(Card, {
        fold: 'image-library', title: '她的画作' + (data ? '（显示最近 ' + data.items.length + ' 张 / 共 ' + data.total + ' 张）' : ''),
        desc: 'ta画过的图都存在本机（不会自动删），这里只是面板里显示多少张。想看全部或者清理，点「打开文件夹」。',
        right: h('div', { className: 'ab-flex' },
          h(Btn, { small: true, kind: 'ghost', onClick: load }, '刷新'),
          h(Btn, { small: true, kind: 'ghost', onClick: () => post('/image/open-folder').then((r) => notify(toast, r)).catch(() => toast('打不开文件夹', 'err')) }, '打开文件夹')),
      },
        h(Row, { label: '面板显示最近', hint: '最多 50 张；只影响面板显示，不删文件' },
          f.num('imageGen.galleryShown', { min: 1, max: 50 }), h('span', { className: 'ab-muted' }, '张')),
        data && data.dir ? h('div', { className: 'ab-muted ab-small', style: { margin: '4px 0 8px', wordBreak: 'break-all' } }, '存图目录：' + data.dir) : null,
        !data ? h(Empty, { icon: '⏳', text: '加载中…' })
          : data.items.length === 0 ? h(Empty, { icon: '🎨', text: 'ta还没画过图。在聊天里说「画一张……」，画好的图会出现在这里。' })
            : h('div', { className: 'ab-shots' }, data.items.map((it) => h(PaintCell, { key: it.file, it, onDelete: () => del(it.file) }))),
      )
    }
