    function MindNow({ toast }) {
      const [d, setD] = useState(null)
      const [food, setFood] = useState('')
      const [err, setErr] = useState('')
      const load = () => get('/mind/now').then((r) => {
        if (r && r.ok !== false) { setD(r); setErr('') } else { setD(r || null); setErr(r?.message || '读不到她的状态') }
      }).catch((e) => setErr('连不上插件：' + e.message))
      useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [])
      if (err) return h('div', { className: 'ab-grid' }, h(ErrorBlock, { title: '读不到她的状态', message: err, hint: '心智核心会在插件启动后几秒内就绪。', onRetry: load }))
      if (!d) return h('div', { className: 'ab-grid' }, h(Skeleton, { kind: 'card', label: '正在读她的状态' }), h(Skeleton, { kind: 'row', rows: 3, label: '正在读她的状态' }))
      if (!d.ok) return h('div', { className: 'ab-grid' }, h(Empty, {
        icon: '🧠', title: '心智核心没起来',
        text: d.message || '她的身体与心情读不到；去「模块管理」看看心智核心在不在跑。',
        action: '重新读取', onAction: load,
      }))
      const b = d.body
      const act = async (path, body) => { const r = await post(path, body || {}); toast(r.message || (r.ok ? '好了' : '没成功')); load(); return r }
      const feed = async () => { if (!food.trim()) return toast('填一个吃的'); const r = await act('/mind/feed', { food: food.trim() }); if (r.ok) setFood('') }
      const deg = (i) => (i >= 0.75 ? '很' : i >= 0.45 ? '有些' : '一点')
      const emotions = (d.emotions || []).filter((e) => e.intensity >= 0.05)
      const bodyState = b.asleep ? '睡着了' : b.groggy ? '刚睡醒' : '醒着'
      const details = [
        ['愉快度', Math.round(d.mood.v * 100)],
        ['活跃度', Math.round(d.mood.a * 100)],
      ]
      return h('div', { className: 'ab-now' },
        h('div', { className: 'ab-now-lead' },
          h('section', { className: 'ab-now-mood' },
            h('div', { className: 'ab-now-heading' }, navIcon(b.asleep ? 'moon' : 'pulse'), h('h1', null, '她现在')),
            h('p', { className: 'ab-now-date' }, d.now, b.shift ? ' · 时差 ' + b.shift + ' 小时' : ''),
            h('p', { className: 'ab-now-label' }, '当前心情', h('strong', null, d.mood.label)),
            h('dl', { 'aria-label': '心情指标，范围为负 100 到正 100' }, details.map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value > 0 ? '+' + value : value))))),
          h('section', { className: 'ab-card ab-body-state' },
            h('div', { className: 'ab-section-heading' }, h('h2', null, '身体状态'), h('span', null, bodyState, b.asleep && b.sleepAt ? ' · ' + timeAgo(b.sleepAt) : '')),
            h(Meter, { compact: true, icon: 'bolt', label: '精力', value: b.energy, warn: b.energy < 0.25 }),
            h(Meter, { compact: true, icon: 'moon', label: '困意', value: b.sleepiness, warn: b.sleepiness >= 0.6 }),
            d.hunger ? h(Meter, { compact: true, icon: 'meal', label: '饥饿', value: b.hunger, warn: b.hunger >= 0.6 })
              : h('p', { className: 'ab-small ab-muted' }, '「会饿」已关闭'),
            h('div', { className: 'ab-body-foot' },
              b.lastSleep ? h('span', null, `上一觉 ${b.lastSleep.hours} 小时 · 睡眠质量 ${Math.round(b.lastSleep.quality * 100)}%` + (b.lastSleep.wokenBy ? ' · 被叫醒' : '')) : null,
              b.asleep ? h(Btn, { small: true, onClick: () => act('/mind/wake') }, '叫醒她')
                : h(Btn, { small: true, onClick: () => { if (confirm('让她现在去睡？')) act('/mind/sleepnow') } }, '让她睡吧')))),
        h('div', { className: 'ab-now-detail' },
          h(Card, { fold: 'mind-feelings', title: '此刻的感受（' + emotions.length + ' 项）', className: 'ab-feelings', collapseAtEnd: emotions.length > 5 },
            emotions.length ? h('ul', { className: 'ab-feeling-list' }, emotions.map((e, i) => h('li', { key: i },
              h('span', { className: 'ab-feeling-mark' }, navIcon('pulse')),
              h('div', null, h('b', null, deg(e.intensity) + e.name),
                h('div', { className: 'ab-muted ab-small' }, '起于 ' + timeAgo(e.at) + (e.targetName ? ' · 对' + e.targetName : '') + (e.source === 'thought' ? ' · 源自念头' : e.source === 'deep' ? ' · 源自深想' : e.source === 'recall' ? ' · 回忆唤起' : '') + (e.hidden ? ' · 没表现出来' : '')),
                e.why && !(e.source === 'thought' && e.why === '想着想着') ? h('p', null, e.why) : null))))
              : h('div', { className: 'ab-quiet' }, navIcon('pulse'), h('span', null, '此刻没有明显的情绪'))),
          h(Card, { title: '投喂', desc: '虚拟投喂，不涉及任何付款。', className: 'ab-feed' },
            h('div', { className: 'ab-feed-form' },
              h('input', { className: 'ab-input', 'aria-label': '想投喂的食物', placeholder: '例如 奶茶', value: food, onChange: (e) => setFood(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter' && !e.nativeEvent?.isComposing) feed() } }),
              h(Btn, { kind: 'primary', onClick: feed, disabled: !food.trim() }, '投喂')),
            b.lastMeal ? h('p', { className: 'ab-small ab-muted' }, '上次吃东西 · ', timeAgo(b.lastMeal.at),
              b.lastMeal.by === 'self' || !b.lastMeal.by ? '，自己吃的' : '，' + (b.lastMeal.by === 'qq:' + (d.ownerQQ || '') ? '你' : b.lastMeal.by.replace(/^qq:/, '')) + '喂的',
              b.lastMeal.food ? '：' + b.lastMeal.food : '') : null,
            h('details', { className: 'ab-feed-help' }, h('summary', null, '怎么投喂'),
              h('ul', null,
                h('li', null, '在 QQ 里直接说「这块蛋糕给你」，也可以配一张食物图。'),
                h('li', null, '在 QQ 发送 ', h('code', null, '/投喂 食物名'), ' 或 ', h('code', null, '/喂 食物名'), '。'),
                h('li', null, '在这里填食物，点「投喂」。')),
              h('p', null, d.feedOnlyByOwner ? '「只靠管理员投喂」已开启。她饿了会来找你。' : '她饿了也会自己找吃的。')))),
        (d.history || []).length ? h(Card, { fold: 'mood-history', title: '最近的情绪变化', className: 'ab-emotion-history' },
          h('ol', null, d.history.slice(0, 15).map((x, i) => h('li', { key: i },
            h('span', null, timeAgo(x.at)), h('b', null, deg(x.i) + x.name), x.why ? h('small', null, x.why) : null)))) : null)
    }

    // ---------- 心智核心：记忆、人物、设置 ----------
    const MIND_KIND = { event: '经历', experience: '看过的', fact: '知道的事', hearsay: '听说的', belief: '我觉得', intention: '要做的事', semantic: '整理出来的', noted: '特意记下的', 'public-note': '可聊的片段', 'shared-note': '允许分享的片段', dream: '梦', 'own-post': '自己发过的', pending: '惦记别人的事', date: '每年的日子', 'day-summary': '那天的回顾', 'week-summary': '那一周的回顾', 'month-summary': '那个月的回顾' }
    const MIND_LEVEL = { clear: '记得清楚', vague: '只记得大概', tip: '要很强的线索才想得起' }
    const mindDay = (at) => {
      if (!at) return '时间未知'
      const d = new Date(at)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }

    /** 她的记忆：数量、今天花了多少、上次睡觉整理，按状态 / 种类 / 关键字翻，单条加强或删除，对照原始记录。 */
