    function StickerCell({ it, onChanged, toast, picking, selected, onToggle }) {
      const [name, setName] = useState(it.name || '')
      const tagText = (it.tags || []).join(' ')
      const [tags, setTags] = useState(tagText)
      // 外面改了（AI 起名 / 刷新列表）时，框里跟着换成新的
      useEffect(() => { setName(it.name || '') }, [it.name])
      useEffect(() => { setTags((it.tags || []).join(' ')) }, [(it.tags || []).join(' ')])
      const save = async (body, label) => {
        const r = await post('/sticker/rename', { md5: it.md5, ...body })
        toast(r.ok ? label + '改好了' : '没改成：' + (r.message || '找不到这张表情'), r.ok ? 'ok' : 'err')
        if (r.ok) onChanged()
      }
      const confirm = useConfirm()
      return h('div', {
        className: cx('ab-sticker', picking && 'pick', selected && 'on'),
        onClick: picking ? () => onToggle(it.md5) : undefined,
        title: picking ? (selected ? '再点一下取消选中' : '点一下选中这张') : undefined,
      },
        h('img', { src: API + '/sticker/image?md5=' + it.md5, alt: it.name || '表情', loading: 'lazy' }),
        it.variantOf ? h('span', { className: 'ab-badge', title: '同名表情的变体', style: { position: 'absolute', left: 6, top: 6 } }, '变体') : null,
        picking ? h('span', { className: 'ck' }, selected ? '✓' : '') : null,
        it.primary ? h('span', { className: 'ab-badge', title: '同名表情的主图', style: { position: 'absolute', right: 6, top: 6 } }, '主图') : null,
        h('input', { className: 'nm', value: name, placeholder: '未命名（点这里改）', title: '名字 / 备注，最多 12 字', maxLength: 12, readOnly: Boolean(picking), tabIndex: picking ? -1 : undefined, onChange: (e) => setName(e.target.value),
          onBlur: () => { if (!picking && name !== (it.name || '')) save({ name }, '名字') } }),
        h('input', { className: 'tg', value: tags, placeholder: '加标签，空格隔开', title: '标签，空格或逗号隔开，最多 5 个', readOnly: Boolean(picking), tabIndex: picking ? -1 : undefined, onChange: (e) => setTags(e.target.value),
          onBlur: () => { if (!picking && tags.trim() !== tagText) save({ tags: tags.split(/[\s,，、#]+/).map((x) => x.trim()).filter(Boolean).slice(0, 5) }, '标签') } }),
        picking ? null : h(Btn, { small: true, kind: 'danger', title: '删除', onClick: async () => { if (!(await confirm.ask('删掉这张表情？', { hint: 'QQ 收藏里也会删。', confirmLabel: '删掉' }))) return; await post('/sticker/delete', { md5: it.md5 }); onChanged() } }, '✕'),
        !picking && it.name ? h(Btn, { small: true, kind: 'ghost', title: '同名表情默认发这张', onClick: async () => { const r = await post('/sticker/primary', { md5: it.md5 }); toast(r.ok ? '设为主图了' : (r.message || '没设成'), r.ok ? 'ok' : 'err'); if (r.ok) onChanged() } }, '主图') : null,
        confirm.node)
    }

    // 和 QQ 空间自身的可见范围一致（ugc_right 1/4/16/64/128）
    const AUDIENCE_OPTIONS = [
      { value: 'all', label: '所有人可见' },
      { value: 'friends', label: '好友可见' },
      { value: 'selected', label: '部分好友可见' },
      { value: 'excluded', label: '部分好友不可见' },
      { value: 'self', label: '仅自己可见' },
    ]
    const AUDIENCE_LABEL = Object.fromEntries(AUDIENCE_OPTIONS.map((o) => [o.value, o.label]))

    /** 可见范围：固定范围存进配置；部分好友再配一份 QQ 名单。 */
