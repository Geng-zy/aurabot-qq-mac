    function AurabotPage() {
      useStyle()
      const [st, setSt] = useState(null)
      const [err, setErr] = useState('')
      const [draft, setDraft] = useState(null)
      const [tab, setTab] = useState(() => {
        try {
          if (!localStorage.getItem('aurabot.persona-tab-v2')) {
            if (localStorage.getItem('aurabot.tab') === 'persona') localStorage.setItem('aurabot.tab', 'selfmind')
            if (localStorage.getItem('aurabot.tab') === 'character') localStorage.setItem('aurabot.tab', 'selfmind')
            localStorage.setItem('aurabot.persona-tab-v2', '1')
          }
          return localStorage.getItem('aurabot.tab') || 'overview'
        } catch { return 'overview' }
      })
      const [toastMsg, setToastMsg] = useState(null)
      const [jump, setJump] = useState(null)
      const [collapsedGroup, setCollapsedGroup] = useState(null)
      const [wizardOpen, setWizardOpen] = useState(false)
      const [saving, setSaving] = useState(false)
      const [savedFlash, setSavedFlash] = useState(false)
      const toastTimer = useRef(null)
      const dirtyRef = useRef(false)
      const saveRef = useRef(null)
      const writeLock = useRef(false)
      const stateRevision = useRef(0)
      const scrollRef = useRef(null)
      const toast = (m, kind) => {
        const text = String(m || '')
        const k = kind || (/失败|出错|没成功|不能|读不到|连不上/.test(text) ? 'err' : '')
        // 先交给总线（宿主有 shell.overlay 时由它渲染），再走面板自己的兜底
        AB_TOAST.publish(text, k)
        setToastMsg({ text, kind: k })
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToastMsg(null), 3200)
      }
      useEffect(() => () => clearTimeout(toastTimer.current), [])
      const toastView = (msg) => {
        const p = primitives()
        return h(p.Toast, {
          key: msg.kind + ':' + msg.text,
          text: msg.text,
          tone: msg.kind === 'ok' ? 'success' : undefined,
          holdMs: 2200,
          onDone: () => setToastMsg(null),
        })
      }
      const reload = useCallback(async () => {
        if (writeLock.current) return
        const revision = ++stateRevision.current
        const r = await get('/state')
        if (revision !== stateRevision.current) return
        if (!r || r.ok === false) { setErr(r?.message || '读不到插件状态'); return }
        setErr('')
        if (r.home) HOST.home = r.home
        setSt(r)
        if (!dirtyRef.current) setDraft(clone(r.config))
      }, [])
      useEffect(() => { reload(); const t = setInterval(reload, 5000); return () => { clearInterval(t); stateRevision.current++ } }, [reload])
      const go = (id, target) => {
        if (id === 'character') id = 'selfmind'
        setTab(id)
        setCollapsedGroup(null)
        setJump(target?.section || target?.setting ? { ...target } : null)
        if (!target?.section) scrollRef.current?.scrollTo(0, 0)
        try { localStorage.setItem('aurabot.tab', id) } catch {}
      }
      useEffect(() => {
        if (!jump?.section) return
        const root = scrollRef.current
        if (!root) return
        function reveal() {
          const section = document.getElementById('ab-section-' + jump.section)
          if (!root.contains(section)) return false
          for (let parent = section; parent && parent !== root; parent = parent.parentElement) {
            if (parent.tagName === 'DETAILS') parent.open = true
          }
          const focus = section.tagName === 'DETAILS' ? section.querySelector('summary') : section
          focus?.focus({ preventScroll: true })
          section.scrollIntoView({ block: 'start' })
          return true
        }
        if (reveal()) return
        const observer = new MutationObserver(() => { if (reveal()) observer.disconnect() })
        observer.observe(root, { childList: true, subtree: true })
        const timer = setTimeout(() => observer.disconnect(), 8000)
        return () => { observer.disconnect(); clearTimeout(timer) }
      }, [jump])
      const dirty = useMemo(() => !!(st && draft) && JSON.stringify(draft) !== JSON.stringify(st.config), [st, draft])
      dirtyRef.current = dirty
      const save = async (body = draft, immediate = false) => {
        if (writeLock.current) return false
        writeLock.current = true
        stateRevision.current++
        setSaving(true)
        try {
          const r = await post('/save', body)
          if (r.ok === false) { toast(r.message || '保存失败', 'err'); return false }
          setSt(r)
          setErr('')
          if (immediate && dirtyRef.current) {
            // 运行模式单独保存。用户正在编辑的表单继续保留。
            const applied = Object.fromEntries(Object.keys(body).map((key) => [key, r.config[key]]))
            setDraft((current) => ({ ...current, ...applied }))
          } else {
            dirtyRef.current = false
            setDraft(clone(r.config))
          }
          toast(r.message || '保存好了', 'ok')
          setSavedFlash(true)
          setTimeout(() => setSavedFlash(false), 2400)
          return true
        } finally {
          writeLock.current = false
          setSaving(false)
        }
      }
      saveRef.current = save
      useEffect(() => {
        const onKey = (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && dirtyRef.current) {
            e.preventDefault()
            saveRef.current?.()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])

      if (!st || !draft) {
        if (err) {
          return h('div', { className: 'ab-root' }, h('div', { className: 'ab-standalone' },
            h(ErrorBlock, { title: '暂时无法读取 AuraBot', message: err, hint: '插件可能正在重载；也可以去日志页看细节。', onRetry: () => reload() })))
        }
        // 首次加载：rail 骨架 + 内容骨架，别让用户看空白
        return h('div', { className: 'ab-root' },
          h('div', { className: 'ab-workspace' },
            h('aside', { className: 'ab-rail' },
              h('div', { className: 'ab-rail-skel' }, Array.from({ length: 8 }, (_, i) => h('div', { key: i, className: 'ab-skel ab-skel-line' })))),
            h('div', { className: 'ab-stage' },
              h('div', { className: 'ab-content' },
                h(Skeleton, { kind: 'card', label: '正在读取插件状态' }),
                h(Skeleton, { kind: 'row', rows: 4, label: '正在读取插件状态' })))))
      }
      const cfg = st.config
      const conn = st.onebot.state === 'connected' && !st.onebot.problem
      const connection = conn ? { cls: 'ok', text: 'QQ 已连接' }
        : { cls: cfg.enabled && st.onebot.state === 'connecting' ? 'warn' : cfg.enabled ? 'err' : '', text: cfg.enabled ? 'QQ 未就绪' : 'QQ 未连接' }
      const persona = st.personas.find((p) => p.id === cfg.persona.current)
      const displayName = st.onebot.login?.nickname || persona?.name || '大肥鱼'
      const props = { st, draft, setDraft, toast, reload, go, jump, connection, displayName, openWizard: () => setWizardOpen(true), pageState: { loading: !st, error: err, retry: reload } }
      const showWizard = !cfg.setupDone || wizardOpen

      const mods = st.modules || []
      const tabs = visibleTabs(st)
      // 兼容声明了目标页面的扩展。未声明或目标当前不可用的面板在「扩展」里可达。
      const tabOf = (m) => m.tab === 'persona' || m.tab === 'character' ? 'selfmind' : m.tab
      const hasBuiltinPage = (id) => TABS.some((t) => t.id === id || t.modules?.includes(id))
      const customUi = mods.filter((m) => !hasBuiltinPage(m.id) && (m.running === 'user' && !m.builtin
        ? Boolean((m.settings || []).length || m.panel)
        : m.running === 'builtin' && Boolean(m.panel)))
      const embedded = (m) => tabs.some((t) => t.id === tabOf(m))
      const embeddedModules = Object.groupBy(customUi.filter(embedded), tabOf)
      const extTabs = customUi.filter((m) => !embedded(m))
        .map((m) => ({ id: 'ext:' + m.id, label: m.name, ext: m.id, group: 'extensions', search: moduleSearchText(m) }))
      const groups = NAV_GROUPS.map((g) => ({ ...g, pages: [...tabs, ...extTabs].filter((t) => t.group === g.id) }))
      const current = [...tabs, ...extTabs].find((t) => t.id === tab) || tabs[0]
      const group = groups.find((g) => g.id === current.group)
      const body = current.ext ? ExtPage : TAB_CONTENT[current.id]
      const tabDirty = (id) => {
        if (!dirty) return false
        const differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b)
        if (id.startsWith('ext:')) return differs(draft.ext?.[id.slice(4)], cfg.ext?.[id.slice(4)])
        return (TAB_KEYS[id] || []).some((k) => differs(getPath(draft, k), getPath(cfg, k)))
          || customUi.some((m) => tabOf(m) === id && differs(draft.ext?.[m.id], cfg.ext?.[m.id]))
      }
      if (showWizard) {
        return h('div', { className: 'ab-root', ref: scrollRef }, h('div', { className: 'ab-standalone' },
          h(Wizard, { st, draft, setDraft, save, toast, reload, onClose: () => setWizardOpen(false) }),
          toastMsg && !AB_TOAST.hosted() ? toastView(toastMsg) : null))
      }
      return h('div', { className: 'ab-root', ref: scrollRef },
        h('div', { className: 'ab-workspace' },
          h(WorkspaceNav, {
            groups, current, go, dirtyOf: tabDirty, version: st.version, collapsedGroup,
            toggleGroup: (id) => setCollapsedGroup((old) => old === id ? null : id),
          }),
          h('div', { className: 'ab-stage' },
            h('header', { className: 'ab-topbar' },
              h('div', { className: 'ab-breadcrumb' }, navIcon(group.icon), group.label,
                current.id === 'overview' ? null : h(Fragment, null, h('span', { 'aria-hidden': true }, '/'), h('b', null, current.label))),
              h('div', { className: 'ab-top-actions' },
                h(FeatureFinder, { groups, go, st, embeddedModules }),
                h(RunControls, { cfg, busy: saving,
                  onToggle: (enabled) => save({ enabled }, true),
                  onMode: (mode) => save({ debug: mode === '调试模式', dryRun: mode !== '正式模式' }, true) }))),
            group.pages.length > 1 ? h(PageNav, { key: group.id, group, current, go, dirtyOf: tabDirty, expanded: collapsedGroup !== group.id }) : null,
            h(SectionNav, { pageId: current.id, go, sections: FIND_SECTIONS[current.id], activeId: jump?.section }),
            h('div', { key: current.id, className: 'ab-content', role: 'region', 'aria-label': current.label },
              current.id === 'overview' || current.id === 'now' ? null : h('h1', { className: 'ab-page-title' }, current.label),
              err ? h(ErrorBlock, { title: '读不到插件状态', message: err, hint: '插件可能正在重载；也可以看一下日志页。', onRetry: () => reload() }) : null,
              h(TabBoundary, { key: current.id, onHome: () => go('overview') }, h(body, { ...props, mod: current.ext, slot: current.id === 'video' ? 'video' : undefined })),
              (embeddedModules[current.id] || []).map((m) => h(Card, { key: m.id, fold: 'module-' + m.id, title: m.name },
                h(ExtPage, { ...props, mod: m.id, embedded: true }))),
              dirty ? h(SaveBar, {
                state: saving ? 'dirty' : 'dirty', saving, isMac: isMacLike(),
                onSave: () => save(), onReset: () => setDraft(clone(cfg)),
              }) : savedFlash ? h(SaveBar, { state: 'saved' }) : null))),
        toastMsg && !AB_TOAST.hosted() ? toastView(toastMsg) : null)
    }

    /** 硬依赖缺失时的兜底页：不渲染业务面板，只说明升级路径。 */
