    function Overview({ st, toast, go, connection, displayName = '大肥鱼' }) {
      const [usage, setUsage] = useState(null)
      const [models, setModels] = useState([])
      const [usageOpen, setUsageOpen] = useState(false)
      // 下面三张明细表看哪个区间：today / yesterday / 7 / 30（点指标卡切换）
      const [usageRange, setUsageRange] = useState('7')
      const [usageErr, setUsageErr] = useState('')
      const loadUsage = (range) => get('/usage?range=' + (range || usageRange)).then((r) => {
        if (r && r.ok !== false) { setUsage(r); setUsageErr('') } else setUsageErr(r?.message || '读不到用量')
      }).catch((e) => setUsageErr('连不上插件：' + e.message))
      useEffect(() => { loadUsage(); get('/models').then((r) => setModels(r.list || [])) }, [])
      const cfg = st.config
      const s = st.stats || {}
      const conn = st.onebot.state === 'connected' && !st.onebot.problem
      const quick = (p, body) => async () => { const r = await post(p, body); toast(r.message || (r.ok ? '好了' : '没成功'), r.ok ? 'ok' : 'err') }
      const model = models.find((m) => m.provider === cfg.model.provider && m.model === cfg.model.model)
      const vision = cfg.model.vision === 'off' ? '仅文字提示' : cfg.model.vision === 'on' ? '按视觉模式发送' : model?.vision === true ? '默认模型支持看图' : model?.vision === false ? '默认模型仅接收提示' : '随会话模型'
      const voice = modOn(st, 'voice')
      const image = cfg.imageGen
      const imageModel = image.provider === 'local' ? '本地部署 · Qwen Image 2.1' : image.provider === 'codex' ? image.codex?.model : image.provider === 'custom' ? '自定义接口' : image.model
      const imageLabel = !modOn(st, 'imagegen') ? '模块已停用'
        : cfg.local?.image && image.provider !== 'local' ? '优先使用本地接口'
          : !image.enabled ? '未启用'
            : imageModel ? (image.provider === 'codex' ? 'Codex · ' : '') + imageModel : '尚未选择模型'
      const chatModel = cfg.model.model || '跟随 DSH 默认'
      const sessionCount = Object.keys(st.sessions || {}).filter((k) => !k.startsWith('system:')).length
      const capabilities = [
        ['图片', vision, 'model', 'image'],
        ['语音', voice && cfg.voice.asr ? '转写成文字' : '未开启转写', voice ? 'asr' : 'modules', 'mic'],
        ['合并转发', '展开文字和图片', null, 'forward'],
        ['视频', '显示消息提示', null, 'video'],
      ]
      const usageToday = usage && usage.ranges ? usage.ranges.today : null
      // 维度小表：名称在左，其余数字右对齐；金额加粗提一档
      const dimTable = (list, nameOf) => (list && list.length
        ? h('div', { className: 'ab-scroll-table' }, h('table', { className: 'ab-table num' },
          h('thead', null, h('tr', null, ['名称', '调用', '合计 tokens', '缓存命中率', '花费'].map((t) => h('th', { key: t }, t)))),
          h('tbody', null, list.map((x) => h('tr', { key: x.key },
            h('td', null, nameOf(x.key)),
            h('td', null, x.runs),
            h('td', null, fmtTokens(x.totalTokens)),
            h('td', null, x.promptTokens ? Math.round(x.cacheHitRate * 100) + '%' : '–'),
            h('td', { className: 'money' }, fmtCost(x.cost, usage.currency)))))))
        : h('div', { className: 'ab-muted ab-small' }, '这段时间没有记录。'))
      const openUsage = () => {
        const next = !usageOpen
        setUsageOpen(next)
        if (next) loadUsage()
      }
      const cur = usage && usage.current
      const RANGE_LABEL = { today: '今日', yesterday: '昨日', 7: '近 7 天', 30: '近 30 天' }
      // 点指标卡 = 换下面三张表看的区间（range 参数跟后端对齐：today / yesterday / 7 / 30）
      const pickRange = (param) => (e) => {
        if (e && e.stopPropagation) e.stopPropagation()
        if (usageRange === param) return
        setUsageRange(param)
        loadUsage(param)
      }
      // 四个区间做成指标卡：大字是 tokens，下面一行是花费 + 调用次数 + 命中率；当前选中的那张高亮
      const usageTile = ([label, key, param]) => {
        const r = usage.ranges[key]
        const active = usageRange === param
        return h('div', {
          key, role: 'button', tabIndex: 0,
          className: cx('ab-utile', 'pick', active && 'hi'),
          title: active ? '下面三张表就是在看' + label : '点一下，下面三张表换成' + label,
          onClick: pickRange(param),
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickRange(param)(e) } },
        },
          h('div', { className: 'k' }, label, active ? h('span', { className: 'ab-utile-cur' }, ' · 明细中') : null),
          h('div', { className: 'v' }, fmtTokens(r.totalTokens)),
          h('div', { className: 's' }, fmtCost(r.cost, usage.currency) + ' · ' + r.runs + ' 次'
            + (r.promptTokens ? ' · 命中 ' + Math.round(r.cacheHitRate * 100) + '%' : '')))
      }
      const usagePanel = !usageOpen ? null
        : usage && usage.ranges ? h(Card, {
        title: 'token 用量与花费',
        right: h(Btn, { small: true, kind: 'ghost', onClick: () => setUsageOpen(false) }, '收起'),
        desc: '按模块、会话和模型查看用量。费用按价目表估算，未定价的调用单独显示。',
      },
        h('div', { className: 'ab-utiles' },
          usageTile(['今日', 'today', 'today']),
          usageTile(['昨日', 'yesterday', 'yesterday']),
          usageTile(['近 7 天', 'last7', '7']),
          usageTile(['近 30 天', 'last30', '30'])),
        cur
          ? h('div', { className: 'ab-upills' },
            h('span', { className: 'ab-upill' }, '新输入 ', h('b', null, fmtCost(cur.freshCost, usage.currency))),
            h('span', { className: 'ab-upill' }, '缓存命中 ', h('b', null, fmtCost(cur.cachedCost, usage.currency))),
            h('span', { className: 'ab-upill' }, '输出 ', h('b', null, fmtCost(cur.outputCost, usage.currency))),
            h('span', { className: cx('ab-upill', usage.peak && 'warn') },
              '峰时占比 ', h('b', null, Math.round((cur.peakRatio || 0) * 100) + '%'),
              usage.peak ? '（现在高峰价）' : '（现在空闲价）'),
            cur.unpricedCalls
              ? h('span', { className: 'ab-upill warn' }, '未定价 ', h('b', null, cur.unpricedCalls + ' 次'), ' 不算花费')
              : null,
            cur.assumedCalls
              ? h('span', { className: 'ab-upill' }, '含 ', h('b', null, cur.assumedCalls + ' 次'), ' 旧数据按 DeepSeek flash 价估')
              : null)
          : null,
        cur ? h('div', null,
          h('div', { className: 'ab-section-title' }, '按模块（' + RANGE_LABEL[usageRange] + '）'),
          dimTable(cur.byModule, (k) => k),
          h('div', { className: 'ab-section-title' }, '按聊天（' + RANGE_LABEL[usageRange] + ' · 哪个群 / 哪个私聊花得多）'),
          dimTable(cur.byChat, chatLabel),
          h('div', { className: 'ab-section-title' }, '按模型（' + RANGE_LABEL[usageRange] + '）'),
          dimTable(cur.byModel, (k) => k || '（跟随默认）')) : null,
        cur && cur.unpricedCalls
          ? h('div', { className: 'ab-note warn', style: { marginTop: 12 } },
            '有 ' + cur.unpricedCalls + ' 次调用没算进花费（' + fmtTokens(cur.unpricedTokens) + ' tokens）：'
            + (cur.unpricedModels || []).map((m) => m.model).join('、')
            + '。这些模型价格表里没有，在 config.usage.pricing 里加一条就会算进去。')
          : null,
        h('div', { className: 'ab-muted ab-small', style: { marginTop: 12 } },
          '数据保留 ' + (usage.days || 90) + ' 天；聊天回合的 token 由 DSH 会话上报，后台任务由插件自己记。'))
        : h(Card, { title: 'token 用量与花费', right: h(Btn, { small: true, kind: 'ghost', onClick: () => setUsageOpen(false) }, '收起') },
          usageErr
            ? h(ErrorBlock, { title: '读不到用量', message: usageErr, hint: '统计来自 DSH 会话上报，稍后会自动更新。', onRetry: () => loadUsage() })
            : h(Skeleton, { kind: 'card', label: '正在取用量' }))
      // 连接状态看渠道的 state（QQ 是 'connected'）；一个都没连上才给教学空态
      const noChannel = !(st.channels || []).some((c) => c && (c.state === 'connected' || c.ready === true))
      const emptyHint = noChannel ? h(Empty, {
        icon: '🔌', title: '还没有接上任何一个平台',
        text: '先把 QQ 网关接上，她才能收到消息；接好以后这一页会显示连接状态、用量和最近日志。',
        action: '去接网关', onAction: () => go('connect'), secondary: '看接入说明', onSecondary: () => go('about'),
      }) : null
      return h('div', { className: 'ab-overview' },
        h(UpdateNotes, { st, toast }),
        h('section', { className: 'ab-cover', 'aria-label': '运行概览' },
          h('div', { className: 'ab-cover-copy' },
            h('div', { className: 'ab-cover-meta' }, h('i', { className: cx('ab-dot', connection.cls), 'aria-hidden': true }), connection.text, h('span', { 'aria-hidden': true }, '·'), cfg.enabled ? runMode(cfg) : '已停用'),
            h('h1', null, displayName),
            h('p', null, '聊天模型', h('strong', null, chatModel)),
            h('button', { type: 'button', className: 'ab-cover-link', onClick: () => go(conn ? 'now' : 'connect') }, conn ? '查看她现在' : '检查 QQ 连接', navIcon('next'))),
        emptyHint,
          h('button', { type: 'button', className: 'ab-cover-portrait', 'aria-label': '查看人格卡和头像', onClick: () => go('selfmind') },
            h('img', { src: avatarSrc(st), alt: '' }))),
        cfg.enabled && !conn ? h('div', { className: 'ab-note err' }, st.onebot.problem || 'QQ 网关未就绪。请检查 OneBot 连接。') : null,
        st.outbox?.count ? h('div', { className: 'ab-note warn' }, `${st.outbox.count} 条消息待补发，QQ 网关恢复后会继续发送。`) : null,
        cfg.enabled && cfg.debug ? h(Card, { title: '调试对话', desc: '对话仅在面板和 DSH 中可见，不会发到 QQ 或写入长期记忆。',
          right: h(Btn, { small: true, onClick: quick('/debug/session') }, '打开 DSH 调试会话') }, h(DebugChat, { toast })) : null,
        cfg.enabled && !cfg.debug && cfg.dryRun ? h('div', { className: 'ab-note' }, '试运行会照常记录记忆，回复只写日志。') : null,
        h('section', { className: 'ab-card ab-activity', 'aria-label': '今日活动' },
          h('div', { className: 'ab-section-heading' }, h('h2', null, '今日活动'),
            h('button', { type: 'button', className: 'ab-inline-link', 'aria-expanded': usageOpen, onClick: openUsage }, usageOpen ? '收起用量' : '查看用量', navIcon('chevron'))),
          h('dl', { className: 'ab-metrics' }, [
            ['收到消息', s.received ?? '—'], ['发出消息', s.sent ?? '—'], ['发出语音', s.voice ?? '—'], ['表情使用', s.stickers ?? '—'],
            ['今日 token', usageToday ? fmtTokens(usageToday.totalTokens ?? usageToday.total ?? 0) : '—'],
          ].map(([label, value]) => h('div', { key: label, className: 'ab-metric' }, h('dt', null, label), h('dd', null, value))))),
        usagePanel,
        h('div', { className: 'ab-overview-pair' },
          h('section', { className: 'ab-card ab-reception' },
            h('div', { className: 'ab-section-heading' }, h('h2', null, 'QQ 接收能力'), h('span', null, sessionCount + ' 个会话')),
            h('ul', { className: 'ab-data-list' }, capabilities.map(([label, state, target, icon]) =>
              h('li', { key: label }, target ? h('button', { type: 'button', onClick: () => go(target) }, navIcon(icon), h('b', null, label), h('small', null, state), navIcon('next'))
                : h('div', null, navIcon(icon), h('b', null, label), h('small', null, state)))))),
          h('section', { className: 'ab-card ab-overview-paths' },
            h('div', { className: 'ab-section-heading' }, h('h2', null, '常用入口')),
            h('ul', { className: 'ab-data-list' }, [
              ['记忆', '跨会话使用与私聊隐私', 'mood', 'memory'],
              ['生图配置', imageLabel, modOn(st, 'imagegen') ? 'imagegen' : 'modules', 'sparkles'],
              ['回复规则', '群聊插话、连发合并', 'group', 'chat'],
              ['白名单与权限', '谁可以和她聊天', 'access', 'lock'],
              ['聊天模型', '默认模型与每个会话的模型', 'model', 'settings'],
            ].map(([label, description, id, icon]) => h('li', { key: id }, h('button', { type: 'button', onClick: () => go(id) },
              navIcon(icon), h('b', null, label), h('small', null, description), navIcon('next'))))))),
        h(RecentLogs, { go }))
    }
