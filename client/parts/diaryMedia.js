    function DiaryMedia({ st, draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const [preview, setPreview] = useState(null)
      const [busy, setBusy] = useState(false)
      const request = useRef(0)
      const unsaved = JSON.stringify(draft.diary) !== JSON.stringify(st.config.diary)
      // 修改配置后清掉旧预览，避免把旧目录或旧可见范围当成当前设置。
      useEffect(() => { request.current++; setPreview(null); setBusy(false) }, [JSON.stringify(draft.diary)])
      useEffect(() => () => { request.current++ }, [])
      const generate = async () => {
        const id = ++request.current
        setBusy(true)
        setPreview(null)
        try {
          const result = await post('/diary/preview', {})
          if (id !== request.current) return
          if (!result.ok) return toast(result.message || '预览没有生成')
          setPreview(result)
        } finally { if (id === request.current) setBusy(false) }
      }
      return h(Card, { fold: 'diary-rich', title: '图文日记与预览', right: f.sw('diary.rich.enabled'), desc: '默认关闭。开启后围绕公开浏览经历或心情写日记，按备注挑选配图；关闭后沿用原来的日记流程。' },
        draft.diary.rich?.enabled ? h('div', null,
          h(Row, { label: '表情包', hint: '默认关闭，需管理员单独开启；开启后可能将从群聊收藏的表情图发布到空间' }, f.sw('diary.rich.stickers')),
          h(Row, { label: '公开浏览配图', hint: '仅取已浏览作品的公开封面；发布会附原作者和作品链接' }, f.sw('diary.rich.browsing')),
          h(Row, { label: '使用指定目录的图片', hint: '只放你允许自动发布到空间的图片；文件内容不会自动识别隐私' }, f.sw('diary.rich.local')),
          h(Row, { label: '本地图片目录', hint: '由管理员主动填写完整路径。留空不扫描；不读取桌面或聊天截图' }, f.text('diary.rich.folder', { placeholder: '留空不读取本地图库' })),
          h(Row, { label: '每篇最多配图' }, f.num('diary.rich.maxImages', { min: 1, max: 4 })),
        ) : null,
        h('div', { className: 'ab-small ab-muted', style: { margin: '12px 0' } }, '先保存设置再预览。预览不会发布、记入发布历史或消耗当天次数；「现在写一篇」会重新写作，遵守保存的可见范围。'),
        unsaved ? h('div', { className: 'ab-small', style: { color: 'var(--ab-warn)', marginBottom: 8 } }, '日记设置尚未保存，保存后可生成预览。') : null,
        h(Btn, { kind: 'ghost', disabled: busy || unsaved, onClick: generate }, busy ? '正在生成预览…' : '生成预览（不发布）'),
        preview ? h('div', { className: 'ab-note', style: { marginTop: 14 } },
          h('div', { className: 'ab-small ab-muted' }, '预览 · ' + preview.label + ' · 尚未发布'),
          h('div', { style: { whiteSpace: 'pre-wrap', margin: '10px 0' } }, preview.text),
          h('div', { className: 'ab-flex', style: { flexWrap: 'wrap', alignItems: 'flex-start' } }, (preview.media || []).map((image) =>
            h('figure', { key: image.id, style: { margin: 0, width: 160 } },
              h('img', { src: image.src, alt: image.caption || '日记配图', style: { width: '100%', maxHeight: 180, objectFit: 'contain', borderRadius: 10 } }),
              h('figcaption', { className: 'ab-small ab-muted' }, image.kind === 'browsing' || image.sourceKind === 'browsing' ? image.platform + ' · ' + image.title : image.kind === 'local' ? '管理员指定图库 · ' + image.caption : '表情包 · ' + image.caption)))),
          (preview.warnings || []).map((warning, i) => h('div', { key: i, className: 'ab-small', style: { color: 'var(--ab-warn)' } }, warning)),
        ) : null,
      )
    }
