    function Seg({ value, options, onChange, disabled }) {
      return h('div', { className: 'ab-seg' + (disabled ? ' off' : '') }, options.map((o) => h('button', { key: o.value, type: 'button', className: value === o.value ? 'on' : '', 'aria-pressed': value === o.value, disabled: !!disabled, onClick: () => { if (!disabled) onChange(o.value) } }, o.label)))
    }
