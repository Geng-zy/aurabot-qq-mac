    /**
     * 行内二次确认：危险动作（导入备份、恢复、覆盖本机数据）不弹原生 confirm。
     * 原生弹窗挡住整页、不能带上细节，也没法被 Playwright 稳定断言；这里改成按钮原地展开成
     * 「确定要…吗」+ 取消/继续，焦点落在「继续」上，Esc/点「取消」撤回。
     */
    function ConfirmInline({ question, hint, confirmLabel = '继续', onConfirm, onCancel, children, tone = 'danger' }) {
      const [open, setOpen] = useState(false)
      const yesRef = useRef(null)
      useEffect(() => {
        if (!open) return
        yesRef.current?.focus()
        const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); onCancel?.() } }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [open])
      if (!open) {
        return h('span', { className: 'ab-confirm' }, h(Btn, {
          small: true, kind: tone === 'danger' ? 'ghost' : 'primary',
          onClick: () => setOpen(true),
        }, children))
      }
      return h('div', { className: 'ab-confirm ab-confirm-open', role: 'group', 'aria-label': question },
        h('b', null, question),
        hint ? h('small', null, hint) : null,
        h('div', { className: 'ab-confirm-actions' },
          h(Btn, { small: true, kind: 'ghost', onClick: () => { setOpen(false); onCancel?.() } }, '取消'),
          h('span', { ref: yesRef, tabIndex: -1, className: 'ab-confirm-focus' },
            h(Btn, { small: true, kind: 'primary', onClick: () => { setOpen(false); onConfirm?.() } }, confirmLabel))))
    }
