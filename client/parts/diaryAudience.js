    function DiaryAudience({ draft, setDraft, toast }) {
      const mode = draft.diary.visibility
      const partial = mode === 'selected' || mode === 'excluded'
      const [friends, setFriends] = useState(null)
      const [query, setQuery] = useState('')
      const qqText = draft.diary.audienceQQs || ''
      const selected = Array.from(new Set(String(qqText).split(/[\s,，;；]+/).filter(Boolean)))
      const setList = (list) => setDraft(setPath(draft, 'diary.audienceQQs', Array.from(new Set(list)).join('\n')))
      const toggle = (qq) => setList(selected.includes(qq) ? selected.filter((q) => q !== qq) : [...selected, qq])
      return h('div', null,
        h(Row, { label: '谁能看', hint: '和 QQ 空间的可见范围一致' },
          h(Select, { value: mode, options: AUDIENCE_OPTIONS, width: 170, onChange: (v) => setDraft(setPath(draft, 'diary.visibility', v)) })),
        partial ? h('div', { style: { marginTop: 10 } },
          h('div', { className: 'ab-flex', style: { gap: 8, marginBottom: 8 } },
            h(Btn, { small: true, kind: 'ghost', onClick: async () => { try { const r = await get('/diary/friends'); if (!r.ok) return toast(r.message || '读取好友失败'); setFriends(r.friends) } catch (e) { toast(e.message) } } }, '从好友列表选择'),
            h('span', { className: 'ab-muted ab-small' }, '已选 ' + selected.length + ' 人，只对之后发的说说生效')),
          friends ? h('div', { style: { marginBottom: 8 } },
            h('input', { className: 'ab-input', placeholder: '搜索昵称或 QQ 号', value: query, onChange: (e) => setQuery(e.target.value) }),
            h('div', { style: { maxHeight: 220, overflow: 'auto', marginTop: 6 } },
              friends.filter((f) => (f.name + f.qq).toLowerCase().includes(query.toLowerCase())).map((f) =>
                h('label', { key: f.qq, style: { display: 'block', padding: '4px 2px' } },
                  h('input', { type: 'checkbox', checked: selected.includes(f.qq), onChange: () => toggle(f.qq) }),
                  ' ' + (f.name || '（无备注）') + '（' + f.qq + '）')))) : null,
          h('textarea', {
            className: 'ab-textarea', style: { minHeight: 64 }, placeholder: '也可以直接填 QQ 号，一行一个',
            value: qqText, onChange: (e) => setDraft(setPath(draft, 'diary.audienceQQs', e.target.value)),
          }),
          h('div', { className: 'ab-small ab-muted', style: { marginTop: 6 } }, mode === 'selected' ? '名单为空时不会发布，也不会退回公开。' : '这些好友看不到之后的说说。')) : null,
      )
    }
