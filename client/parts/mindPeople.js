    function MindPeople({ toast }) {
      const [d, setD] = useState(null)
      const [q, setQ] = useState('')
      const [open, setOpen] = useState('')
      const [gone, setGone] = useState([])
      const [view, setView] = useState(() => { try { return localStorage.getItem('aurabot.peopleView') || 'list' } catch (e) { return 'list' } })
      const switchView = (v) => { setView(v); try { localStorage.setItem('aurabot.peopleView', v) } catch (e) {} }
      const pick = (id) => {
        switchView('list')
        setOpen(id)
        setQ('')
        setTimeout(() => {
          const el = document.getElementById('person-' + id.replace(/\W/g, ''))
          if (!el) return
          el.focus({ preventScroll: true })
          el.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
        }, 50)
      }
      const [follows, setFollows] = useState([])
      const [impression, setImpression] = useState(null)
      const load = () => {
        get('/mind/people').then(setD)
        get('/mind/people/forgotten').then((r) => setGone((r && r.list) || [])).catch(() => {})
        get('/mind/followups').then((r) => setFollows((r && r.list) || [])).catch(() => {})
      }
      const stopAsking = async (f) => { const r = await post('/mind/followups/close', { id: f.id }); toast(r.message, r.ok ? 'ok' : 'err'); load() }
      useEffect(() => { load() }, [])
      if (d && !d.ok) return h(Card, { title: '关系' }, h(Empty, { text: d.message || '心智核心没起来' }))
      // 忘掉一个人：删除要确认两次；「以后不记」可以选要不要连以前的一起移走；都先进恢复区，30 天内能放回来
      const forget = async (p, mode) => {
        const who = (p.name || '这个人') + '（' + p.id.replace(/^qq:/, 'QQ ') + '）'
        let body = { id: p.id, mode }
        if (mode === 'delete') {
          if (!confirm('忘掉 ' + who + '？\n\n她对他的关系、关于他的事、和他的私聊、他说过的原话都会移进恢复区（30 天内能放回来，之后就真的没了）。和别人一起经历、他只是在场的事留着。')) return
          if (!confirm('再确认一次：现在就忘掉 ' + who + '？')) return
          body.confirm = true
        } else if (mode === 'stop') {
          const clear = confirm('以后不记 ' + who + ' 了：他说的话不再进她的记忆（聊天照常回）。\n\n以前关于他的记忆要不要也一起移走？\n「确定」= 一起移进恢复区；「取消」= 以前的留着')
          body.clear = clear
        }
        const r = await post('/mind/people/forget', body)
        toast(r.message || (r.ok ? '好了' : '没成功'), r.ok ? 'ok' : 'err'); load()
      }
      const restorePerson = async (g) => { if (!confirm('把 ' + (g.name || g.id) + ' 从恢复区放回来？')) return; const r = await post('/mind/people/restore', { id: g.id }); toast(r.message, r.ok ? 'ok' : 'err'); load() }

      const list = d?.list || []
      const needle = q.trim().toLowerCase()
      const shown = list.filter((p) => !needle || [p.name, p.id, ...(p.aliases || []), p.typeLabel, p.tom?.note].join(' ').toLowerCase().includes(needle)).slice(0, 300)
      const edit = async (id, patch) => {
        const r = await post('/mind/people/edit', { id, patch })
        toast(r.message || (r.ok ? '已保存' : '没有保存成功'), r.ok ? 'ok' : 'err')
        if (r.ok) load()
        return r.ok
      }
      const texts = (arr) => (arr || []).map((x) => x.text || x).join('、')
      const personCard = (p) => {
        const r = p.rel || {}
        const t = p.tom || {}
        const isOpen = open === p.id
        const id = 'person-' + p.id.replace(/\W/g, '')
        const detailId = id + '-details'
        const name = p.name || '未命名'
        const pending = follows.filter((f) => f.about === p.id)
        const editing = isOpen && impression?.id === p.id
        const scoreFields = [['亲近', r.closeness], ['喜欢', r.liking], ['尊重', r.respect], ['信任', r.trust]]
        if (p.owner || r.intimacy) scoreFields.push(['亲密', r.intimacy], ['承诺', r.commitment])
        const showPassion = p.owner && (d?.passionEnabled ?? Boolean(r.passion))
        if (showPassion) scoreFields.push(['激情', r.passion])
        const change = r.passionChange
        const points = change ? Number((change.delta * 100).toFixed(1)) : 0
        const detailFields = [
          ['她叫对方', r.call && '「' + r.call + '」'],
          ['对方叫她', r.callMe && '「' + r.callMe + '」'],
          ['曾用名', (p.aliases || []).join('、')],
          ['喜欢 / 在意', texts(t.likes)],
          ['习惯', texts(t.habits)],
          ['她理解对方知道什么', (t.knowledge || []).slice(-6).map((e) => (e.state === 'known' ? '知道' : '还不知道') + '「' + e.topic + '」').join('；')],
          ['最近', t.mood && (t.mood.text + '（' + timeAgo(t.mood.at) + '）')],
          ['老梗', texts(r.topics)],
          ['别碰', texts(r.limits)],
          ['重要时刻', (r.moments || []).map((m) => mindDay(m.at).slice(0, 10) + ' ' + m.text).join('；')],
          ['没解开的结', texts(r.knots)],
          ['激情', showPassion && (change
            ? '最近一段变化 ' + (points > 0 ? '+' : '') + points + ' 分 · ' + timeAgo(change.at)
            : '整理管理员私聊时，按对话中明确表现出来的吸引变化更新。')],
          ['其他印象', [r.rivalry >= 0.3 && '有点暗暗较劲', (r.flirts || []).length >= 3 && '最近老撩她、纠缠她'].filter(Boolean).join(' · ')],
        ].filter(([, value]) => value)
        return h('article', { key: p.id, id, tabIndex: -1, className: cx('ab-person', p.owner && 'owner', isOpen && 'expanded') },
          h('header', { className: 'ab-person-head' },
            h('span', { className: 'ab-person-mark', 'aria-hidden': true }, p.name ? Array.from(p.name.trim())[0] || navIcon('mind') : navIcon('mind')),
            h('div', { className: 'ab-person-id' },
              h('h2', null, name),
              h('div', { className: 'ab-person-meta' },
                p.typeLabel ? h('span', { className: 'ab-person-tag' }, p.typeLabel) : null,
                h('span', null, p.id.replace(/^qq:/, 'QQ ')),
                r.lastContact ? h('span', null, timeAgo(r.lastContact) + '联系过') : p.lastSeen ? h('span', null, mindDay(p.lastSeen) + ' 来过') : null,
                r.n ? h('span', null, '聊过 ' + r.n + ' 段') : null,
                pending.length ? h('span', null, '惦记着 ' + pending.length + ' 件事') : null,
                p.noMemory ? h('span', null, '已停止记录') : null))),
          h('dl', { className: 'ab-person-scores', 'aria-label': '关系指标（满分 100）' }, scoreFields.map(([label, score]) => {
            const value = Math.round(Math.max(0, Math.min(1, Number(score) || 0)) * 100)
            return h('div', { key: label }, h('dt', null, label), h('dd', null, value),
              h('span', { className: 'track', 'aria-hidden': true }, h('i', { style: { width: value + '%' } })))
          })),
          r.debt ? h('div', { className: 'ab-person-meta' }, '人情 · ' + (r.debt > 0 ? '她欠 ' + r.debt : '对方欠 ' + -r.debt)) : null,
          t.note && !editing ? h('p', { className: 'ab-person-note' }, t.note) : null,
          isOpen ? h('div', { id: detailId, className: 'ab-person-details' },
            detailFields.length ? h('dl', { className: 'ab-person-fields' }, detailFields.map(([label, value]) =>
              h('div', { className: 'ab-person-field', key: label }, h('dt', null, label), h('dd', null, value)))) : null,
            pending.length ? h('div', { className: 'ab-person-field' }, h('b', null, '惦记着的事'), pending.map((f) =>
              h('div', { className: 'ab-person-follow', key: f.id },
                h('span', null, f.gist + (f.asks ? '（问过 ' + f.asks + ' 次）' : f.nextAt > Date.now() ? '（' + mindDay(f.nextAt).slice(0, 10) + ' 以后会问）' : '（下次聊天时会问）')),
                h(Btn, { small: true, kind: 'ghost', onClick: () => stopAsking(f) }, '不用问了')))) : null,
            editing ? h('div', { className: 'ab-person-edit' },
              h('label', { htmlFor: id + '-impression' }, '对这个人的印象'),
              h('textarea', { id: id + '-impression', className: 'ab-textarea', rows: 4, autoFocus: true, value: impression.text, onChange: (e) => setImpression({ id: p.id, text: e.target.value }) }),
              h('div', { className: 'ab-person-actions' },
                h(Btn, { small: true, kind: 'ghost', onClick: () => setImpression(null) }, '取消'),
                h(Btn, { small: true, kind: 'primary', onClick: async () => {
                  if (await edit(p.id, { note: impression.text })) setImpression((current) => current?.id === p.id ? null : current)
                } }, '保存印象'))) : null) : null,
          h('footer', { className: 'ab-person-actions' },
            isOpen && (r.knots || []).length ? h(Btn, { small: true, kind: 'ghost', onClick: () => { if (confirm('把她对这个人的心结都清掉？')) return edit(p.id, { knots: [] }) } }, '清掉心结') : null,
            isOpen && !p.owner ? (p.noMemory
              ? h(Btn, { small: true, kind: 'ghost', onClick: async () => { const r = await post('/mind/people/forget', { id: p.id, mode: 'resume' }); toast(r.message); load() } }, '恢复记录')
              : h(Btn, { small: true, kind: 'ghost', onClick: () => forget(p, 'stop') }, '停止记录')) : null,
            isOpen && !p.owner ? h(Btn, { small: true, kind: 'danger', onClick: () => forget(p, 'delete') }, '忘掉这个人') : null,
            editing ? null : h(Btn, { small: true, kind: 'ghost', onClick: () => {
              setOpen(p.id)
              setImpression((current) => current?.id === p.id ? current : { id: p.id, text: t.note || '' })
            } }, '写印象'),
            h(Btn, { small: true, expanded: isOpen, controls: isOpen ? detailId : undefined, onClick: () => setOpen(isOpen ? '' : p.id) }, isOpen ? '收起' : '详细')))
      }
      return h('div', { className: 'ab-people' },
        h(Card, { desc: d && (d.exclusive ? '「专一」已开启，亲密、激情和承诺只对管理员。' : '「专一」已关闭，她也可能慢慢喜欢上别人。') },
          h('div', { className: 'ab-people-tools' },
            h('label', { className: 'ab-people-search' }, navIcon('find'), h('input', {
              className: 'ab-input', type: 'search', 'aria-label': '查找人物', placeholder: '查找姓名、账号或关系', value: q, onChange: (e) => setQ(e.target.value),
            })),
            h(Seg, { value: view, options: [{ value: 'list', label: '列表' }, { value: 'map', label: '星图' }], onChange: switchView }))),
        view === 'map' ? h(Card, null, h(StarMap, { onPick: pick, q: q.trim() }))
          : !d ? h('p', { className: 'ab-muted', role: 'status' }, '读取中…')
          : !shown.length ? h(Card, null, h(Empty, { text: needle ? '没有找到匹配的人' : '还没认识谁' }))
          : h('div', { className: 'ab-people-grid' }, shown.map(personCard)),
        gone.length ? h(Card, { fold: 'people-recovery', title: '恢复区', desc: '忘掉的人可以在 30 天内恢复。' },
          h('div', { className: 'ab-list' }, gone.map((g) => h('div', { key: g.id, className: 'ab-li' },
            h('div', { className: 'meta' }, '保留到 ' + mindDay(g.until).slice(0, 10)),
            h('div', { className: 'body' }, h('b', null, g.name || '未命名'), h('div', { className: 'ab-muted ab-small' }, [
              g.id.replace(/^qq:/, 'QQ '), g.episodes + ' 件事、' + g.perception + ' 句原话', g.keepPerson && '已停止记录',
            ].filter(Boolean).join(' · '))),
            h(Btn, { small: true, onClick: () => restorePerson(g) }, '放回来'))))) : null,
        d?.groups?.length ? h(Card, { fold: 'people-groups', title: '她对群的了解' }, h('div', { className: 'ab-people-groups' }, d.groups.map((g) =>
          h('article', { key: g.id, className: 'ab-people-group' },
            h('b', null, g.name || '群'),
            h('div', { className: 'ab-person-meta' }, g.id + (g.at ? ' · ' + timeAgo(g.at) : '')),
            h('p', null, [...(g.style || []), ...(g.rules || []).map((x) => '规矩：' + x), g.note].filter(Boolean).join('；') || '还没摸清楚'))))) : null)
    }

    /** 人格与自我：她本来的样子（特质，等你确认）、现在的样子、不知不觉的变化和提醒、她自己改过的、自我故事、各种版本可以退回。 */
