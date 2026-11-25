    function ExtPanel({ m, settings, draftSettings, setSettings, toast, reload }) {
      const [src, setSrc] = useState(null)
      const [err, setErr] = useState('')
      const [height, setHeight] = useState(160)
      const frame = useRef(null)
      const token = useMemo(() => 'panel-' + m.id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2), [m.id, m.startedAt])
      useEffect(() => {
        let alive = true
        fetch(API + '/modules/panel?id=' + encodeURIComponent(m.id) + '&t=' + Date.now(), { cache: 'no-store' })
          .then((r) => (r.ok ? r.text() : Promise.reject(new Error('读不到 panel.js'))))
          .then((text) => { if (alive) setSrc(text) })
          .catch((e) => { if (alive) setErr(e.message) })
        return () => { alive = false }
      }, [m.id, m.startedAt])
      const doc = useMemo(() => src ? panelSandboxHtml(token, src, settings, draftSettings) : '', [token, src, JSON.stringify(settings), JSON.stringify(draftSettings)])
      useEffect(() => {
        const base = m.routesAtRoot ? '' : '/ext/' + m.id
        const onMessage = async (event) => {
          if (!frame.current || event.source !== frame.current.contentWindow) return
          const data = event.data
          if (!data || data.token !== token) return
          if (data.type === 'rpc' && data.payload) {
            let result = null
            try {
              const { id, type, payload } = data.payload
              if (type === 'call') {
                const p = String(payload.path || '')
                let decoded = p
                try { decoded = decodeURIComponent(p) } catch {}
                if (!p.startsWith('/') || decoded.includes('..') || decoded.includes('\\') || decoded.includes('://')) throw new Error('panel 接口路径不合法')
                result = payload.body === undefined ? await get(base + p) : await post(base + p, payload.body)
              }
              else if (type === 'save') result = await post('/save', { ext: { [m.id]: payload.patch } })
            } catch (error) { result = { ok: false, message: String(error.message || error) } }
            frame.current.contentWindow.postMessage({ token, type: 'rpc-result', id: data.payload.id, result }, '*')
          } else if (data.type === 'draft') setSettings?.(data.payload?.patch || {})
          else if (data.type === 'toast') toast?.(data.payload?.text || '', data.payload?.kind || 'ok')
          else if (data.type === 'height') setHeight(Math.max(80, Math.min(2000, Number(data.payload?.height) || 160)))
          else if (data.type === 'reload') reload?.()
          else if (data.type === 'error') setErr(data.payload?.message || 'panel.js 出错')
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [token, m.id, m.startedAt, m.routesAtRoot, get, post, toast, reload])
      if (err) return h('div', { className: 'ab-note err' }, '面板加载失败：' + err)
      if (!src) return h(Empty, { icon: '⏳', text: '加载中…' })
      return h('iframe', { ref: frame, sandbox: 'allow-scripts', srcDoc: doc, title: m.name || m.id, style: { width: '100%', height, border: 0, background: 'transparent' } })
    }
