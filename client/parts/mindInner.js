    function MindInner({ toast }) {
      const [d, setD] = useState(null)
      const [busy, setBusy] = useState('')
      const [err, setErr] = useState('')
      const load = () => get('/mind/inner').then((r) => {
        if (r && r.ok !== false) { setD(r); setErr('') } else { setD(r || null); setErr(r?.message || '读不到内心') }
      }).catch((e) => setErr('连不上插件：' + e.message))
      useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [])
      if (err) return h('div', { className: 'ab-grid' }, h(ErrorBlock, { title: '读不到内心活动', message: err, hint: '内心活动跟着心智核心走，稍后会自动刷新。', onRetry: load }))
      if (!d) return h('div', { className: 'ab-grid' }, h(Skeleton, { kind: 'card', label: '正在读内心活动' }), h(Skeleton, { kind: 'row', rows: 3, label: '正在读内心活动' }))
      if (!d.ok) return h('div', { className: 'ab-grid' }, h(Empty, {
        icon: '💭', title: '心智核心没起来',
        text: d.message || '念头、愿望和主动行为都读不到；去「模块管理」看看心智核心在不在跑。',
        action: '重新读取', onAction: load,
      }))
      const act = async (path, body, label) => { setBusy(label || path); try { const r = await post(path, body || {}); toast(r.message || (r.ok ? '好了' : '没成功')); load() } finally { setBusy('') } }
      const m = d.motivation
      const motivesByWant = new Map()
      for (const motive of d.motives || []) {
        for (const id of motive.wantIds || []) {
          const previous = motivesByWant.get(id)
          if (!previous || (!previous.available && motive.available)) motivesByWant.set(id, motive)
        }
      }
      const pending = (d.grants.requests || []).filter((r) => r.status === 'pending')
      const grantedKeys = Object.keys(d.grants.granted || {})
      const diary = (d.diary || []).slice(0, 40)
      const wants = m.wants || []
      const diaryTime = new Intl.DateTimeFormat('zh-CN', { timeZone: d.timezone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      return h(Fragment, null,
        h(Card, { fold: 'mind-journal', title: '内心日记（最近 ' + diary.length + ' 条）', collapseAtEnd: diary.length > 5, desc: '她醒着、空闲时，会结合各会话近况和回忆想一会儿。每条左侧是实际生成时间，正文是她的念头。标有「深想」的是她进一步思考后的结果。' + (d.boredom >= 0.5 ? '　现在有点无聊。' : '') },
          diary.length ? h('div', { className: 'ab-list' }, diary.map((x, i) => h('div', { key: i, className: 'ab-li' },
            h('div', { className: 'meta' }, diaryTime.format(x.at) + ' · ' + timeAgo(x.at) + (x.by === 'local' ? ' · 本地' : ' · 聊天模型') + (x.repeated ? ' · 在重复，放空了' : '')),
            h('div', { className: 'body' }, x.thought,
              x.feel ? h('span', { className: 'ab-muted ab-small' }, '  （' + x.feel.name + '）') : null,
              x.plan ? h('div', { className: 'ab-small' }, '想去：' + x.plan) : null,
              x.deep ? h('div', { className: 'ab-note', style: { marginTop: 4 } }, '深想（' + x.deep.reason + '）：' + x.deep.thought) : null)))) : h(Empty, { text: '还没想过什么' })),
        h(Card, { fold: 'mind-wants', title: '她想要的（' + wants.length + ' 项）', collapseAtEnd: wants.length > 5, desc: '这些念头会影响她的动力。醒着、空闲时，她会从能做的事里选一件。' },
          wants.length ? h('div', { className: 'ab-list', style: { marginBottom: 12 } }, wants.map((w) => {
            const motive = motivesByWant.get(w.id)
            const status = motive?.why || (motive ? (motive.motive < d.actThreshold ? '动力还不够' : '等她空闲时决定') : '没有对应的动作')
            return h('div', { key: w.id, className: 'ab-li' },
              h('div', { className: 'meta' }, timeAgo(w.at)),
              h('div', { className: 'body' }, w.text, h('div', { className: 'ab-muted ab-small' }, motive ? motive.label + ' · ' + status : status)),
              h(Btn, { small: true, onClick: () => act('/mind/want/close', { id: w.id }) }, '帮她放下'))
          })) : h('p', { className: 'ab-muted' }, '现在没什么特别想要的'),
          m.needs.filter((n) => n.deficit >= 0.05).sort((a, b) => b.deficit - a.deficit).slice(0, 8).map((n) => h(Meter, { key: n.id, label: n.name, value: n.deficit, warn: n.deficit >= 0.7 }))),
        h(Card, { fold: 'mind-actions', title: '能做的事', desc: '模块交给她的事，什么时候做由她决定：动力 ≈ 觉得能做成 × 有多想要 ÷（1 + 容易分心 × 回报要等多久），再看费不费力、精力和心情。动力没过门槛就犯懒不做。做完按结果学：比预想的开心，下次更想做。' },
          (d.motives || []).length ? h('div', { className: 'ab-list' }, d.motives.map((x) => h('div', { key: x.id, className: 'ab-li' },
            h('div', { className: 'meta' }, '动力 ' + x.motive.toFixed(2) + (x.why ? ' · ' + x.why : '') + (m.learned[x.id] ? ' · 以前做了 ' + m.learned[x.id].runs + ' 次，满意度 ' + Math.round(m.learned[x.id].expect * 100) + '%' : '')),
            h('div', { className: 'body' }, x.label, x.wants.length ? h('span', { className: 'ab-muted ab-small' }, '  惦记着：' + x.wants.join('、')) : null),
            h(Btn, { small: true, disabled: !x.available || Boolean(busy), onClick: () => act('/mind/act', { id: x.id }, x.id) }, busy === x.id ? '在做…' : '让她现在去')))) : h(Empty, { text: '还没有模块交给她事情做' }),
          (m.log || []).length ? h('div', { style: { marginTop: 12 } }, h('b', null, '最近做过的'), h('div', { className: 'ab-list' }, m.log.slice(0, 10).map((x, i) => h('div', { key: i, className: 'ab-li' },
            h('div', { className: 'meta' }, timeAgo(x.at)), h('div', { className: 'body' }, (x.ok ? '' : '没做成：') + x.label + (x.summary ? '——' + x.summary : '')))))) : null),
        h(Card, { fold: 'mind-outreach', title: '主动找你', desc: '想你了、有事想分享、答应你的事做好了、要申请权限时，她自己决定找不找你。你没回之前她不会追着发；一直没回她会有点失落。勿扰时段和每天上限在「设置 → 动机与行动」里设（默认不设，由她自己拿捏）。' },
          d.outreach.pending ? h('p', null, '刚找过你，还在等你回：' + d.outreach.pending.reason) : null,
          (d.outreach.log || []).length ? h('div', { className: 'ab-list' }, d.outreach.log.slice(0, 10).map((x, i) => h('div', { key: i, className: 'ab-li' },
            h('div', { className: 'meta' }, timeAgo(x.at) + (x.kind === 'permission' ? ' · 申请权限' : '')), h('div', { className: 'body' }, x.reason)))) : h('p', { className: 'ab-muted' }, '还没主动找过你')),
        h(Card, { fold: 'mind-grants', title: '权限申请', desc: '她想要一项还没有的权限时会私聊问你，说清楚要什么、为什么。你在 QQ 私聊里回「同意 #编号」或「不同意 #编号」就行（群里有人替你说不算），这里也能批。批过的随时可以收回。' },
          pending.length ? h('div', { className: 'ab-list' }, pending.map((r) => h('div', { key: r.n, className: 'ab-li' },
            h('div', { className: 'meta' }, '#' + r.n + ' · ' + timeAgo(r.at)),
            h('div', { className: 'body' }, r.what, r.why ? h('div', { className: 'ab-muted ab-small' }, '因为：' + r.why) : null),
            h('div', { className: 'ab-flex', style: { gap: 6 } },
              h(Btn, { small: true, kind: 'primary', onClick: () => act('/mind/permission/decide', { n: r.n, yes: true }) }, '批准'),
              h(Btn, { small: true, onClick: () => act('/mind/permission/decide', { n: r.n, yes: false }) }, '不批'))))) : h('p', { className: 'ab-muted' }, '没有等你批的'),
          grantedKeys.length ? h('div', { style: { marginTop: 10 } }, h('b', null, '已经批过的'), h('div', { className: 'ab-flex', style: { flexWrap: 'wrap', gap: 6, marginTop: 6 } }, grantedKeys.map((k) => h(Btn, { key: k, small: true, onClick: () => { if (confirm('收回「' + k + '」？')) act('/mind/permission/revoke', { key: k }) } }, k + ' ✕')))) : null),
        h(MindLocalModel, { toast, usage: d.usage }))
    }
