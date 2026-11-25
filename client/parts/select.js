    function Select({ value, options, onChange, placeholder, width, ariaLabel, disabled }) {
      const [open, setOpen] = useState(false)
      const [act, setAct] = useState(-1)
      const ref = useRef(null)
      const listId = useRef(null)
      if (!listId.current) listId.current = 'ab-sel-list-' + (++nextSelectId)
      const cur = options.find((o) => o.value === value)
      useEffect(() => {
        if (!open) return
        const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
        document.addEventListener('mousedown', close)
        return () => document.removeEventListener('mousedown', close)
      }, [open])
      const pick = (o) => { if (!disabled) onChange(o.value); setOpen(false) }
      const openAt = () => { setOpen(true); setAct(Math.max(0, options.indexOf(cur))) }
      const onKey = (e) => {
        if (e.key === 'Escape') { setOpen(false); return }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          if (!open) return openAt()
          setAct((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (open && options[act]) pick(options[act])
          else openAt()
        }
      }
      let lastGroup = null
      const items = []
      options.forEach((o, i) => {
        if (o.group && o.group !== lastGroup) items.push(h('div', { key: 'g' + i, className: 'ab-sel-group' }, o.group))
        lastGroup = o.group || lastGroup
        items.push(h('div', { key: 'o' + i, id: listId.current + '-' + i, role: 'option', 'aria-selected': o.value === value, className: cx('ab-sel-opt', o.value === value && 'on', i === act && 'act'), onMouseEnter: () => setAct(i), onMouseDown: (e) => e.preventDefault(), onClick: () => pick(o) },
          h('span', { className: 'ck' }, o.value === value ? '✓' : ''),
          h('span', { className: 'tx' }, o.label, o.desc ? h('span', { className: 'ds' }, o.desc) : null)))
      })
      return h('div', { className: cx('ab-sel', open && 'open'), ref, style: width ? { width, minWidth: 0 } : null, onBlur: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) } },
        h('button', { type: 'button', role: 'combobox', className: 'ab-sel-btn', disabled, onClick: () => (open ? setOpen(false) : openAt()), onKeyDown: onKey, 'aria-label': ariaLabel, 'aria-haspopup': 'listbox', 'aria-expanded': open, 'aria-controls': open ? listId.current : undefined, 'aria-activedescendant': open && act >= 0 ? listId.current + '-' + act : undefined },
          h('span', { className: 'v' }, cur ? cur.label : h('span', { className: 'ab-muted' }, placeholder || '请选择')),
          h('svg', { className: 'chev', width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }, h('path', { d: 'M3 4.5 6 7.5 9 4.5' }))),
        open ? h('div', { id: listId.current, className: 'ab-sel-pop', role: 'listbox', 'aria-label': ariaLabel }, items) : null)
    }

    /** 卡片式单选：选项少、需要解释时用。 */
