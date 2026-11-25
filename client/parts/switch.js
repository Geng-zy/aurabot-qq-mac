    function Switch({ on, onChange, disabled, title, label }) {
      const p = primitives()
      return h(p.Switch, { checked: !!on, onChange, label: label || title || '开关', disabled: !!disabled, title })
    }
