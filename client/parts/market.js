    function Market({ st, toast, reload, go }) {
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState('')
      const [prog, setProg] = useState(null)
      const [q, setQ] = useState('')
      const [show, setShow] = useState('all')
      const [cat, setCat] = useState('')
      const [loadErr, setLoadErr] = useState('')
      const load = (force) => get('/modules/community' + (force ? '?force=1' : '')).then((r) => {
        if (r && r.ok !== false) { setData(r); setLoadErr('') } else { setData(r || null); setLoadErr(r?.message || '读不到模块库') }
      }).catch((e) => setLoadErr('连不上插件：' + e.message))
      useEffect(() => { load() }, [])
      // 一直查进度：恢复备份、老用户迁移时模块在后台装，不是从这个页面点的
      useEffect(() => {
        let was = false
        const tick = () => get('/modules/community/progress').then((r) => {
          const now = r.progress || null
          setProg(now)
          if (was && !now) load()
          was = Boolean(now)
        })
        const t = setInterval(tick, busy ? 300 : 1000)
        tick()
        return () => clearInterval(t)
      }, [busy])
      const percent = prog && prog.total ? Math.min(100, Math.round(prog.received / prog.total * 100)) : 0
      const stageText = () => {
        if (prog.stage === 'index') return '读取模块列表…'
        if (prog.stage === 'install') return '解压安装…'
        if (prog.stage === 'start') return '启动模块…'
        return '下载中 ' + (prog.total ? percent + '%' : Math.round(prog.received / 1024) + ' KB')
      }
      const progText = (word) => (prog ? stageText() : word + '中…')
      const STAGE_BAR = { index: 10, install: 90, start: 95 }
      const progBar = prog ? h('div', { className: 'ab-card', style: { marginBottom: 12 } },
        h('div', { className: 'ab-flex', style: { justifyContent: 'space-between' } }, h('b', null, '正在安装「' + (prog.name || prog.id) + '」'), h('span', { className: 'ab-muted ab-small' }, stageText())),
        h('div', { style: { height: 6, borderRadius: 3, background: 'var(--ab-foam-2)', marginTop: 8, overflow: 'hidden' } },
          h('div', { style: { height: '100%', width: (STAGE_BAR[prog.stage] || Math.max(12, 10 + percent * 0.8)) + '%', background: 'var(--ab-sea)', transition: 'width .3s' } }))) : null
      const done = async (r) => {
        notify(toast, r)
        await load()
        reload()
      }
      const [pending, setPending] = useState(null)
      const askInstall = (m) => {
        const caps = capText(m).join('、') || '无'
        setPending({
          kind: m.installed ? 'update' : 'install', m,
          why: '来源：' + MODULE_REPOS[m.registry] + ' · 版本：' + m.version + ' · 作者：' + m.author + ' · 能力：' + caps
            + (m.replacesBuiltin ? ' · 会替换同名内置模块' : '') + '。能力声明不是沙箱：模块和插件在同一进程里运行。',
        })
      }
      const doInstall = async () => {
        const m = pending?.m
        setPending(null)
        if (!m) return
        setBusy(m.id)
        try { await done(await post('/modules/community/install', { id: m.id, registry: m.registry, version: m.version, confirmReplace: Boolean(m.replacesBuiltin) })) } finally { setBusy('') }
      }
      const askRemove = (m) => setPending({ kind: 'uninstall', m })
      const doRemove = async (purge) => {
        const m = pending?.m
        setPending(null)
        if (!m) return
        setBusy(m.id)
        try { await done(await post('/modules/community/remove', { id: m.id, purge: Boolean(purge) })) } finally { setBusy('') }
      }
      const list = (data && data.list) || []
      const counts = { all: list.length, installed: list.filter((m) => m.installed).length, update: list.filter((m) => m.update).length }
      const word = q.trim().toLowerCase()
      const cats = [...new Set(list.map((m) => m.category).filter(Boolean))]
      const shown = list.filter((m) => (!cat || m.category === cat) && (show === 'all' || (show === 'installed' && m.installed) || (show === 'update' && m.update)) && (!word || (m.name + ' ' + m.id + ' ' + (m.description || '') + ' ' + (m.tags || []).join(' ')).toLowerCase().includes(word)))
      const openSettings = (m) => {
        const running = (st.modules || []).find((x) => x.id === m.id)
        return running && running.tab ? () => go(running.tab) : null
      }
      const chip = (id, label) => h('button', { key: id, type: 'button', className: cx('ab-chip', show === id && 'on'), onClick: () => setShow(id) }, label, h('span', { className: 'n' }, counts[id]))
      const card = (m) => {
        const settings = m.installed ? openSettings(m) : null
        const otherSource = m.installedRegistry && m.installedRegistry !== m.registry
        const originNote = otherSource ? `当前安装来自 ${MODULE_REPOS[m.installedRegistry]}。` + (m.switchSource ? `更新将切换到 ${MODULE_REPOS[m.registry]}。` : '') : ''
        const note = [m.delisted ? '已从市场下架' : '', m.foreign ? '有同名的自己写的文件夹，不会覆盖' : '', originNote, m.blocked].filter(Boolean).join(' · ')
        return h('div', { key: m.id, className: 'ab-card', style: { display: 'flex', flexDirection: 'column' } },
          h('h3', null, m.name, MODULE_REPOS[m.registry] ? h('span', { className: 'ab-badge', title: MODULE_REPOS[m.registry] }, m.registry === 'mac' ? 'macOS 模块库' : '上游参考') : null, m.update ? h('span', { className: 'ab-badge' }, '可更新') : null),
          h('div', { className: 'ab-small ab-muted' }, 'v' + (m.installed || m.version) + (m.update ? ' → v' + m.version : '') + (CATEGORY_LABEL[m.category] ? ' · ' + CATEGORY_LABEL[m.category] : '') + (m.author ? ' · ' + m.author : '') + (m.license ? ' · ' + m.license : '')),
          h('p', { className: 'ab-desc', style: { margin: '8px 0' } }, m.description),
          capText(m).length ? h('div', { className: 'ab-small ab-muted', style: { marginBottom: 10 } }, '会用到：' + capText(m).join('、')) : null,
          note ? h('div', { className: 'ab-note warn', style: { marginBottom: 10 } }, note) : null,
          h('div', { className: 'ab-flex', style: { marginTop: 'auto' } },
            !m.installed && !m.foreign && !m.delisted ? h(Btn, { small: true, kind: 'primary', disabled: Boolean(busy || m.blocked), onClick: () => askInstall(m) }, busy === m.id ? progText('安装') : '安装') : null,
            m.update ? h(Btn, { small: true, kind: 'primary', disabled: Boolean(busy || m.blocked), onClick: () => askInstall(m) }, busy === m.id ? progText('更新') : '更新') : null,
            settings ? h(Btn, { small: true, onClick: settings }, '去设置') : null,
            m.installed ? h(Btn, { small: true, kind: 'ghost', disabled: Boolean(busy), onClick: () => askRemove(m) }, '卸载') : null))
      }
      if (loadErr) return h('div', { className: 'ab-grid' }, h(ErrorBlock, { title: '读不到模块库', message: loadErr, hint: '模块库来自 GitHub；没网络时不影响已经装好的模块。', onRetry: () => load(true) }))
      return h('div', { className: 'ab-grid' },
        pending ? h(Card, { title: pending.kind === 'uninstall' ? '卸载「' + pending.m.name + '」' : (pending.kind === 'update' ? '更新「' : '安装「') + pending.m.name + '」' },
          h('p', { className: 'ab-muted ab-small', style: { margin: '0 0 8px' } }, pending.why || '装好以后可以在「模块管理」里开关它。'),
          pending.kind === 'uninstall'
            ? h('div', { className: 'ab-flex', style: { gap: 8, flexWrap: 'wrap' } },
              h(Btn, { small: true, kind: 'primary', onClick: () => doRemove(false) }, '卸载，保留数据'),
              h(Btn, { small: true, onClick: () => doRemove(true) }, '卸载并清掉数据'),
              h(Btn, { small: true, kind: 'ghost', onClick: () => setPending(null) }, '取消'))
            : h('div', { className: 'ab-flex', style: { gap: 8 } },
              h(Btn, { small: true, kind: 'primary', onClick: doInstall }, pending.kind === 'update' ? '更新' : '安装'),
              h(Btn, { small: true, kind: 'ghost', onClick: () => setPending(null) }, '取消'))) : null,
        data === null ? h(Skeleton, { kind: 'row', rows: 4, label: '正在读模块库' }) : null,
        progBar,
        h(Card, { title: 'AuraBot 模块库', desc: '这里装的是 AuraBot 自己的 .mjs 模块，不是 DSH 插件；DSH 插件请用 DSH 的插件市场管理。只安装本分支模块库；上游模块只读参考，不能安装。安装前请核对来源和能力，模块会与插件在同一进程运行。', right: h(Btn, { small: true, kind: 'ghost', onClick: () => load(true) }, '刷新') },
          h('div', { className: 'ab-flex' },
            h('input', { className: 'ab-input', placeholder: '搜模块', value: q, onChange: (e) => setQ(e.target.value) }),
            chip('all', '全部'), chip('installed', '已安装'), chip('update', '可更新')),
          cats.length > 1 ? h('div', { className: 'ab-flex', style: { marginTop: 10 } }, [''].concat(cats).map((c) => h('button', { key: c || 'any', type: 'button', className: cx('ab-chip', cat === c && 'on'), onClick: () => setCat(c) }, c ? CATEGORY_LABEL[c] || c : '全部分类'))) : null,
          ((data && data.revoked) || []).map((r) => h('div', { key: r.id, className: 'ab-note err', style: { marginTop: 10 } }, '「' + r.id + '」' + r.version + ' 已撤回：' + r.reason + '。建议关闭或卸载。'))),
        !data ? h(Empty, { icon: '⏳', text: '加载中…' }) : null,
        data && data.ok === false ? h('div', { className: 'ab-note warn' }, '模块库打不开：' + data.message) : null,
        data?.partial ? h('div', { className: 'ab-note warn' }, '部分模块库暂时无法访问，当前列表可能不完整。') : null,
        data?.referenceUnavailable ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, '上游参考库暂时读不到，不影响本分支模块安装。') : null,
        data && data.ok !== false && !shown.length ? h(Empty, { icon: '🐟', text: list.length ? '没有符合条件的模块' : '市场里还没有模块' }) : null,
        shown.length ? h('div', { className: 'ab-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' } }, shown.map(card)) : null,
        h(ModuleTutorial, { toast }))
    }

    /** 扩展页：所有模块（内置的 + 市场装的 + 自己写的）、安全模式；写模块的工具收在最下面。 */
