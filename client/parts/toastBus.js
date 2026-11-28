    /**
     * Toast 总线：面板里的动作结果本来只挂在面板自己身上（切页/关面板就没了）。
     * 宿主有 `shell.overlay` 时，把它挂到整个窗口那一层去；没有宿主时仍由面板自己渲染 —— 两种情况都不丢提示。
     *
     * 约定：面板只 publish，不关心谁在渲染。`hosted()` 为真时面板不再画自己的 Toast（避免两份）。
     */
    const AB_TOAST = (() => {
      const listeners = new Set()
      let hosted = false
      let current = null
      let timer = null
      const emit = () => { for (const fn of listeners) fn(current) }
      return {
        publish(text, kind) {
          const spoken = String(text || '')
          if (!spoken) return
          current = { text: spoken, kind: kind || '' }
          clearTimeout(timer)
          timer = setTimeout(() => { current = null; emit() }, 3200)
          emit()
        },
        clear() { current = null; clearTimeout(timer); emit() },
        current: () => current,
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
        claimHost() { hosted = true },
        hosted: () => hosted,
      }
    })()

    /** 挂在宿主 `shell.overlay` 上的那个渲染器（没有宿主时不会出现）。 */
    function Toaster() {
      const [msg, setMsg] = useState(AB_TOAST.current())
      useEffect(() => {
        AB_TOAST.claimHost()
        return AB_TOAST.subscribe(setMsg)
      }, [])
      if (!msg) return null
      return h('div', { className: 'ab-toaster' }, h(primitives().Toast, {
        key: msg.kind + ':' + msg.text,
        text: msg.text,
        tone: msg.kind === 'ok' ? 'success' : msg.kind === 'err' ? 'danger' : undefined,
        holdMs: 2200,
        onDone: () => AB_TOAST.clear(),
      }))
    }
