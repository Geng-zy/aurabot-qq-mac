    function Range({ value, min, max, step, onChange, fmt }) {
      return h('div', { className: 'ab-range' },
        h('input', { type: 'range', min, max, step: step || 1, value: value ?? min, onChange: (e) => onChange(Number(e.target.value)) }),
        h('span', { className: 'val' }, fmt ? fmt(value) : value))
    }
