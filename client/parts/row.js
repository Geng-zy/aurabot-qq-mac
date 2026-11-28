    function Row({ label, hint, details, className, children, error }) {
      const id = useId()
      const hintId = hint ? id + '-hint' : ''
      const errId = error ? id + '-err' : ''
      const described = [hintId, errId].filter(Boolean).join(' ') || undefined
      return h('div', { className: cx('ab-row', className, error && 'ab-row-error'), role: 'group', 'aria-labelledby': id, 'aria-describedby': described },
        h('div', { className: 'ab-label' }, h('b', { id }, label), hint ? h('small', { id: hintId }, hint) : null, details),
        h('div', { className: 'ab-ctl' }, children,
          error ? h('small', { id: errId, className: 'ab-row-err', role: 'alert' }, error) : null))
    }
