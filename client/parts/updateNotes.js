    function UpdateNotes({ st }) {
      const [notes, setNotes] = useState(null)
      useEffect(() => {
        let seen = null
        try { seen = localStorage.getItem('aurabot.seenVersion') } catch (e) {}
        if (seen && seen !== st.version) get('/changelog').then((r) => r.notes && setNotes(r.notes))
        else if (!seen) { try { localStorage.setItem('aurabot.seenVersion', st.version) } catch (e) {} }
      }, [st.version])
      const dismiss = () => { try { localStorage.setItem('aurabot.seenVersion', st.version) } catch (e) {} setNotes(null) }
      return notes ? h('div', { className: 'ab-note' },
        h('div', { className: 'ab-flex' }, h('b', null, '已更新到 v' + st.version), h('div', { className: 'ab-spacer' }), h(Btn, { small: true, kind: 'ghost', onClick: dismiss }, '知道了')),
        h('div', { style: { whiteSpace: 'pre-wrap', marginTop: 6 } }, notes)) : null
    }
