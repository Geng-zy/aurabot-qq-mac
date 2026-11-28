    /**
     * 行内确认：面板里所有「删掉 / 覆盖 / 推送 / 重新开始」都走这里，不再用原生 confirm()。
     *
     * 两条入口共用一个渲染器（`GlobalConfirmHost`，挂在工作台根部）：
     *   `useConfirm()`   组件内用，返回 { ask, node }（node 现在恒为 null，保留是为了不改老调用点）；
     *   `AB_CONFIRM.ask()`  组件外或不想加 hook 的地方用。
     * 返回 Promise：默认 true / false；传 options 时得到选中的 value；Esc 等于取消。
     */
    const AB_CONFIRM = (() => {
      let state = null
      let resolver = null
      const listeners = new Set()
      const emit = () => { for (const fn of listeners) fn(state) }
      return {
        ask(question, opts = {}) {
          // 一次只处理一个：前一个还开着就先当取消，避免弹窗叠在一起
          if (resolver) { const prev = resolver; resolver = null; prev(false) }
          state = { question, hint: opts.hint || '', confirmLabel: opts.confirmLabel || '继续', cancelLabel: opts.cancelLabel || '取消', options: opts.options || null }
          emit()
          return new Promise((resolve) => { resolver = resolve })
        },
        answer(value) {
          const done = resolver
          resolver = null
          state = null
          emit()
          done?.(value)
        },
        current: () => state,
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
      }
    })()

    /** 挂在工作台根部的唯一渲染器。 */
    function GlobalConfirmHost() {
      const [state, setState] = useState(AB_CONFIRM.current())
      const firstRef = useRef(null)
      useEffect(() => AB_CONFIRM.subscribe(setState), [])
      useEffect(() => {
        if (!state) return
        firstRef.current?.focus()
        const onKey = (e) => { if (e.key === 'Escape') AB_CONFIRM.answer(state.options ? null : false) }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [state])
      if (!state) return null
      return h('div', { className: 'ab-confirm-sheet', role: 'alertdialog', 'aria-label': state.question },
        h('b', null, state.question),
        state.hint ? h('small', null, state.hint) : null,
        h('div', { className: 'ab-confirm-actions' },
          state.options
            ? state.options.map((o, i) => h('span', { key: o.value, ref: i === 0 ? firstRef : undefined, tabIndex: -1, className: 'ab-confirm-focus' },
              h(Btn, { small: true, kind: i === 0 ? 'primary' : 'ghost', onClick: () => AB_CONFIRM.answer(o.value) }, o.label)))
            : h('span', { ref: firstRef, tabIndex: -1, className: 'ab-confirm-focus' },
              h(Btn, { small: true, kind: 'primary', onClick: () => AB_CONFIRM.answer(true) }, state.confirmLabel)),
          h(Btn, { small: true, kind: 'ghost', onClick: () => AB_CONFIRM.answer(state.options ? null : false) }, state.cancelLabel)))
    }

    /** 组件里的老写法：`if (!(await confirm.ask('…'))) return`。渲染由 GlobalConfirmHost 负责。 */
    function useConfirm() {
      return { ask: (question, opts) => AB_CONFIRM.ask(question, opts), node: null }
    }
