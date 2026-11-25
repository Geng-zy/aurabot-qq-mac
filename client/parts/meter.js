    function Meter({ label, value, hint, warn, compact, icon }) {
      const pctv = Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)
      if (compact) return h('div', { className: cx('ab-vital', warn && 'warn') },
        h('div', { className: 'ab-vital-label' }, navIcon(icon), h('b', null, label), h('span', null, pctv + '%')),
        h('div', { className: 'ab-vital-meter', role: 'meter', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pctv },
          h('i', { style: { width: pctv + '%' } })))
      return h(Row, { label, hint }, h('div', { className: 'ab-flex', style: { gap: 8, minWidth: 220 } },
        h('div', { className: 'ab-mood', style: { flex: 1 } }, h('i', { style: { width: Math.max(3, pctv) + '%', background: warn ? 'var(--ab-warn)' : undefined } })),
        h('span', { className: 'ab-muted ab-small' }, pctv + '%')))
    }

    /** 身体、心情和情绪来自同一份心智状态。 */
