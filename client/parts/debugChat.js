    function DebugChat({ toast }) {
      const [msgs, setMsgs] = useState([])
      const [text, setText] = useState('')
      const [busy, setBusy] = useState(false)
      const say = async () => {
        const t = text.trim()
        if (!t || busy) return
        setMsgs((m) => [...m, { who: 'me', text: t }])
        setText('')
        setBusy(true)
        try {
          const r = await post('/debug/say', { text: t })
          setMsgs((m) => [...m, { who: 'her', text: r.ok ? (r.text || '（她这次没说话）') : '✗ ' + (r.message || '出错了') }])
        } catch (error) {
          setMsgs((m) => [...m, { who: 'her', text: '✗ ' + error.message }])
        } finally {
          setBusy(false)
        }
      }
      return h('div', null,
        msgs.length ? h('div', { className: 'ab-list', style: { maxHeight: 340, overflow: 'auto', marginBottom: 8 } },
          msgs.map((m, i) => h('div', { key: i, className: 'ab-li' },
            h('div', { className: 'meta' }, m.who === 'me' ? '你' : '她'),
            h('div', { className: 'body', style: { whiteSpace: 'pre-wrap' } }, m.text)))) : h(Empty, { icon: '💬', text: '说点什么试试，比如「在吗」「今天心情怎么样」' }),
        h('div', { className: 'ab-flex', style: { marginTop: 6 } },
          h('input', { className: 'ab-input', style: { flex: 1 }, value: text, placeholder: '对她说…（回车发送）', onChange: (e) => setText(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') say() } }),
          h(Btn, { small: true, kind: 'primary', disabled: busy || !text.trim(), onClick: say }, busy ? '她在想…' : '发送')))
    }

    /** 心智设置的一个输入框：失焦或回车才保存（数字留空 = 没填）。 */
