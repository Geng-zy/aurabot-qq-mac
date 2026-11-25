    function Btn({ kind, small, onClick, disabled, children, title, expanded, controls }) {
      const [busy, setBusy] = useState(false)
      const run = async () => { if (!onClick) return; setBusy(true); try { await onClick() } finally { setBusy(false) } }
      const p = primitives()
      return h(p.Button, {
        variant: kind === 'primary' ? 'primary' : kind === 'danger' ? 'outline' : 'ghost',
        size: small ? 'sm' : 'md',
        className: kind === 'danger' ? 'ab-danger' : undefined,
        title, disabled: disabled || busy,
        'aria-expanded': expanded, 'aria-controls': controls, onClick: run,
      }, busy ? [h('i', { key: 's', className: 'ab-spin' }), ' 处理中'] : children)
    }

    /** 自定义下拉：替代系统自带的蓝白 select。options: [{value, label, desc?, group?}] */
    let nextSelectId = 0
