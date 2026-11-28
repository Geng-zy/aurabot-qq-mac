    function Modules({ st, draft, toast, reload, go }) {
      const [data, setData] = useState(null)
      const [newId, setNewId] = useState('')
      const [newName, setNewName] = useState('')
      const [loadErr, setLoadErr] = useState('')
      const load = () => get('/modules').then((r) => { if (r && r.ok !== false) { setData(r); setLoadErr('') } else setLoadErr(r?.message || '读不到模块列表') }).catch((e) => setLoadErr('连不上插件：' + e.message))
      useEffect(() => { load() }, [])
      useEffect(() => { if (data && st.modules) setData((d) => ({ ...d, list: st.modules })) }, [JSON.stringify(st.modules)])
      const setModules = (list) => list && setData((d) => ({ ...d, list }))
      if (loadErr) return h(ErrorBlock, { title: '读不到模块列表', message: loadErr, onRetry: load })
      if (!data) return h(Skeleton, { kind: 'card', label: '正在读模块列表' })
      const list = data.list || []
      const platformFeatures = list.filter((m) => m.platformFeature)
      const builtin = list.filter((m) => m.builtin && !m.platformFeature)
      const mine = list.filter((m) => !m.builtin && !m.community)
      const fromCommunity = list.filter((m) => m.community)
      const props = { draft, setModules, toast, reload: () => { reload(); load() } }
      const create = async () => {
        const r = await post('/modules/create', { id: newId.trim(), name: newName.trim() })
        if (!r.ok) return toast(r.message, 'err')
        setNewId(''); setNewName('')
        setModules(r.list)
        copy(r.prompt, toast, '建好了，修改提示词已复制，粘给 DSH 让它帮你写')
        reload()
      }
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '已安装', right: h(Btn, { small: true, kind: 'primary', onClick: () => go('market') }, '逛模块库'), desc: 'ta的每项本事都是一个模块：能单独关掉；能复制一份来改，改了就替换内置的；也能自己写新模块，让ta学会你想要的任何事。自己写的东西放在下面这个文件夹，插件升级不会动；改完保存几秒内自动生效，不用重启。不会写代码？点「复制给 DSH」，粘给 DSH，说你想要什么。' },
          h('div', { className: 'ab-flex' },
            h('code', { className: 'ab-small', style: { wordBreak: 'break-all', flex: 1 } }, data.dir),
            h(Btn, { small: true, onClick: () => post('/modules/open').then((r) => toast(r.message)) }, '打开文件夹'),
            h(Btn, { small: true, onClick: () => copy(data.prompt, toast, '修改提示词复制好了，粘给 DSH，把【】里那句换成你想要的') }, '复制给 DSH'),
            h(Btn, { small: true, kind: 'ghost', onClick: async () => { const r = await post('/modules/reload', {}); setModules(r.list); toast(r.message) } }, '重新检查')),
          h(Row, { label: '安全模式', hint: '打开后你写的模块一个都不加载，内置的全部恢复。出了问题先开它，看是不是你的模块引起的。' },
            h(Switch, { on: st.config.safeMode, onChange: async (v) => { const r = await post('/save', { safeMode: v }); toast(v ? '安全模式开了：只跑内置模块' : '安全模式关了', 'ok'); setModules(r.modules); reload() } })),
          st.config.safeMode ? h('div', { className: 'ab-note warn' }, '安全模式开着：你写的模块现在都没加载。') : null),
        fromCommunity.length ? h(Card, { title: '从市场装的（' + fromCommunity.length + '）' }, h('div', null, fromCommunity.map((m) => h(ModuleRow, { key: m.id, m, ...props })))) : null,
        mine.length ? h(Card, { title: '自己写的（' + mine.length + '）' }, h('div', null, mine.map((m) => h(ModuleRow, { key: m.id, m, ...props })))) : null,
        platformFeatures.length ? h('div', { className: 'ab-note', style: { marginBottom: 2 } }, 'QQ 平台功能（群管、联系人、资料、空间日记、语音、基础 QQ 工具）随 QQ 连接加载，不再作为通用模块显示；相关开关在 QQ 页面。') : null,
        h(Card, { title: '内置模块（' + builtin.length + '）', desc: '关掉的模块：ta就没有这项本事，相关的标签页也会藏起来。连接、权限、人格、聊天这些是核心，不能关。' },
          h('div', null, builtin.map((m) => h(ModuleRow, { key: m.id, m, ...props })))),
        h('details', { className: 'ab-card' },
          h('summary', { style: { cursor: 'pointer', fontWeight: 620 } }, '写模块的工具'),
          h('p', { className: 'ab-desc', style: { marginTop: 8 } }, '自己写模块或排查问题时才用得上。'),
          h('div', { className: 'ab-grid' },
        h(Card, { fold: 'modules-create', title: '新建一个模块', desc: '从模板建一个能直接跑的例子（关键词自动回复 + 一个命令 + 一个工具），在它上面改。id 用小写英文，比如 weather。想改内置的本事，用下面内置模块那一行的「复制一份来改」。' },
          h('div', { className: 'ab-flex' },
            h('input', { className: 'ab-input', style: { maxWidth: 180 }, placeholder: 'id，如 weather', value: newId, onChange: (e) => setNewId(e.target.value.toLowerCase()) }),
            h('input', { className: 'ab-input', placeholder: '名字，如 查天气', value: newName, onChange: (e) => setNewName(e.target.value) }),
            h(Btn, { kind: 'primary', small: true, disabled: !newId.trim(), onClick: create }, '新建'))),
            h(Simulate, { toast }))),
      )
    }

    /** 自己写的模块的面板：自动表单 + 模块自己的 panel.js。 */
