    function AiButton({ onClick, empty }) {
      const [busy, setBusy] = useState(false)
      return h('button', {
        type: 'button', className: 'ab-aibtn', disabled: busy, title: empty ? '让 AI 按这一节的标题先写一版' : '让 AI 把这一节改得更具体、更像真人',
        onClick: async () => { setBusy(true); try { await onClick() } finally { setBusy(false) } },
      },
      busy ? h('i', { className: 'ab-spin' }) : navIcon('M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'),
      h('span', null, busy ? '润色中' : empty ? 'AI 写一版' : 'AI 润色'))
    }

    const personaDraftKey = (id) => 'aurabot.persona.draft.' + id
