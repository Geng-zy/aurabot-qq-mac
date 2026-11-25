    function RunControls({ cfg, busy, onToggle, onMode }) {
      const [open, setOpen] = useState(false)
      const box = useRef(null)
      const trigger = useRef(null)
      useEffect(() => {
        if (!open) return
        const outside = (e) => { if (!box.current?.contains(e.target)) setOpen(false) }
        document.addEventListener('mousedown', outside)
        return () => document.removeEventListener('mousedown', outside)
      }, [open])
      const selected = runMode(cfg)
      const modes = [
        ['正式模式', '正常发送 QQ 回复。'],
        ['试运行', '照常记录记忆，回复只写日志。'],
        ['调试模式', '仅在面板和 DSH 对话，不写长期记忆。'],
      ]
      return h('div', { className: 'ab-run', ref: box, onKeyDown: (e) => { if (open && e.key === 'Escape') { setOpen(false); trigger.current?.focus() } } },
        h('button', { type: 'button', className: 'ab-run-btn', ref: trigger, 'aria-label': '运行模式：' + (cfg.enabled ? selected : '已停用'), 'aria-expanded': open, onClick: () => setOpen(!open) },
          h('i', { className: cx('ab-dot', cfg.enabled && (cfg.dryRun || cfg.debug ? 'warn' : 'ok')), 'aria-hidden': true }), cfg.enabled ? selected : '已停用', navIcon('chevron')),
        open ? h('div', { className: 'ab-run-pop' },
          h('div', { className: 'ab-run-power' }, h('b', null, '启用 AuraBot'), h(Switch, { label: '总开关', on: cfg.enabled, disabled: busy, onChange: onToggle })),
          h('div', { role: 'group', 'aria-label': '运行模式' }, modes.map(([mode, description]) => h('button', {
            key: mode, type: 'button', className: 'ab-run-option', 'aria-pressed': mode === selected, disabled: busy, onClick: () => onMode(mode),
          }, h('span', null, h('b', null, mode), h('small', null, description)), h('span', { className: 'ab-mode-indicator', 'aria-hidden': true }))))) : null)
    }
