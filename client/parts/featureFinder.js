    function FeatureFinder({ groups, go, st, embeddedModules }) {
      const [find, setFind] = useState(null)
      const [hi, setHi] = useState(0)
      const [params, setParams] = useState(null)
      const box = useRef(null)
      const trigger = useRef(null)
      const open = find !== null
      const hasMindSettings = groups.some((g) => g.pages.some((t) => t.id === 'mindsettings'))
      const close = () => { setFind(null); trigger.current?.focus() }
      const toggle = () => { setFind((f) => f === null ? '' : null); setHi(0) }
      useEffect(() => {
        const onKey = (e) => {
          if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyK' || e.key.toLowerCase() === 'k')) {
            e.preventDefault()
            if (open) close()
            else toggle()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])
      useEffect(() => {
        if (!open) return
        const onDown = (e) => { if (!box.current?.contains(e.target)) setFind(null) }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
      }, [open])
      useEffect(() => {
        if (!open || !hasMindSettings || params) return
        let active = true
        get('/mind/settings').then((r) => { if (active && r.ok) setParams(r.params || []) })
        return () => { active = false }
      }, [open, hasMindSettings, params])
      const query = (find || '').trim().toLowerCase()
      const words = query.split(/\s+/).filter(Boolean)
      const catalog = open ? groups.flatMap((g) => g.pages.flatMap((t) => {
        const path = g.label + ' / ' + t.label
        const sections = (FIND_SECTIONS[t.id] || []).flatMap(([section, label, search]) => {
          if (section === 'qq-group-admin' && !modOn(st, 'group-admin')) return []
          if (section.startsWith('diary-') && !modOn(st, section === 'diary-social' ? 'qzone-social' : 'diary')) return []
          return [{ id: section, tab: t.id, label, path, search, section }]
        })
        const settings = t.id === 'mindsettings' ? (params || []).map((p) => ({ id: p.key, tab: t.id, label: p.label, path, search: [p.key, p.hint].join(' '),
          aliases: p.key === 'models.backgroundTokensDaily' ? ['后台预算', '后台额度', '每日额度'] : [], setting: p })) : []
        const embedded = (embeddedModules[t.id] || []).map((m) => {
          const section = 'module-' + m.id
          return { id: section, tab: t.id, label: m.name, path, search: moduleSearchText(m), section }
        })
        return [{ id: t.id, tab: t.id, label: t.label, path: g.label, search: t.search }, ...sections, ...settings, ...embedded]
      })) : []
      const hits = words.length ? catalog.flatMap((entry) => {
        const title = entry.label.toLowerCase()
        const haystack = [title, entry.path, entry.search, entry.id, ...(entry.aliases || [])].join(' ').toLowerCase()
        if (!words.every((word) => haystack.includes(word))) return []
        const rank = title === query ? 10 : entry.aliases?.includes(query) ? 9 : title.startsWith(query) ? 8 : title.includes(query) ? 6 : entry.search?.toLowerCase().includes(query) ? 4 : 2
        return [{ entry, rank: rank + (entry.section || entry.setting ? 0.5 : 0) }]
      }).sort((a, b) => b.rank - a.rank).slice(0, 32).map(({ entry }) => entry)
        : ['connect', 'qq-allowlist', 'group', 'model', 'memory-vectors', 'mindsettings'].flatMap((id) => catalog.filter((entry) => entry.id === id))
      const pick = (entry) => { close(); go(entry.tab, entry) }
      return h('div', { className: 'ab-find', ref: box },
        h('button', { type: 'button', className: 'ab-find-btn', ref: trigger, 'aria-label': '查找功能', 'aria-expanded': open, onClick: toggle },
          navIcon('find'), h('span', null, '搜索功能或设置'), h('kbd', { className: 'ab-kbd' }, isMacLike() ? '⌥ K' : 'Alt K')),
        open ? h('div', { className: 'ab-finder', onKeyDown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } } },
          h('input', {
            className: 'ab-input', autoFocus: true, role: 'combobox', 'aria-label': '搜索功能', 'aria-expanded': true, 'aria-controls': 'ab-finder-list',
            'aria-activedescendant': hits[hi] ? 'ab-hit-' + hi : undefined,
            placeholder: '例如：精排、生图、群聊必回',
            value: find,
            onChange: (e) => { setFind(e.target.value); setHi(0) },
            onKeyDown: (e) => {
              if (e.nativeEvent?.isComposing) return
              if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); setHi((i) => Math.min(i + 1, hits.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)) }
              else if (e.key === 'Enter' && hits[hi]) { e.preventDefault(); pick(hits[hi]) }
            },
          }),
          h('div', { className: 'ab-finder-list', id: 'ab-finder-list', role: 'listbox', 'aria-label': '功能搜索结果' }, hits.length
            ? hits.map((entry, i) => h('button', {
              key: entry.id, id: 'ab-hit-' + i, type: 'button', role: 'option', 'aria-selected': i === hi,
              className: cx('ab-finder-item', i === hi && 'on'), onMouseEnter: () => setHi(i), onClick: () => pick(entry),
            }, h('span', { className: 'ab-finder-title' }, entry.label), h('small', null, entry.path)))
            : h('div', { className: 'ab-finder-empty' }, '没有匹配的功能'))) : null)
    }

    const runMode = (cfg) => cfg.debug ? '调试模式' : cfg.dryRun ? '试运行' : '正式模式'
