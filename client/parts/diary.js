    function Diary({ st, draft, setDraft, toast, go }) {
      const f = useField(draft, setDraft)
      const [data, setData] = useState(null)
      const [loadErr, setLoadErr] = useState('')
      const on = modOn(st, 'diary')
      const load = () => (on ? get('/diary/history').then((r) => {
        if (r && r.ok !== false) { setData(r); setLoadErr(''); if (r.warning) toast(r.warning) } else { setData(null); setLoadErr(r?.message || '读不到日记状态') }
      }).catch((e) => setLoadErr('连不上插件：' + e.message)) : null)
      useEffect(() => { load() }, [on])
      const social = modOn(st, 'qzone-social') ? h(QzoneSocial, { draft, setDraft, toast }) : h(ModOff, { name: '空间互动', go })
      if (!on) return h('div', { className: 'ab-grid' }, h(ModOff, { name: '空间日记', go }), social)
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '空间日记', right: f.sw('diary.enabled'), desc: '她用可公开的经历和当前心情写说说。普通日记只在「仅自己可见」时自动从当天的画作或表情包里配图。' },
          h(Row, { label: '每天自动发布上限', hint: '设为 0 可暂停自动发布' }, f.num('diary.timesPerDay', { min: 0, max: 6 })),
          h(Row, { label: '自动发布时段', hint: '按心智时区，空闲且有动力时才写' }, f.text('diary.windowStart', { size: 'sm' }), h('span', { className: 'ab-muted' }, '到'), f.text('diary.windowEnd', { size: 'sm' })),
          h(Row, { label: '自动发布最短间隔' }, f.num('diary.minGapMinutes', { min: 0 }), h('span', { className: 'ab-muted' }, '分钟')),
          h(Row, { label: '字数' }, f.num('diary.minChars', { min: 10 }), h('span', { className: 'ab-muted' }, '到'), f.num('diary.maxChars', { min: 20 }), h('span', { className: 'ab-muted' }, '字')),
          h(DiaryAudience, { draft, setDraft, toast }),
        ),
        h(Card, { section: 'diary-write', title: '现在写日记', right: h('div', { className: 'ab-flex' },
          data?.automatic ? h('span', { className: 'ab-muted ab-small' }, '今天 ' + data.automatic.count + '/' + data.automatic.limit + ' · ' + (data.automatic.reason || '等她空闲时决定')) : null,
          h(Btn, { small: true, kind: 'ghost', title: '刷新空间状态', onClick: load }, h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true }, h('path', { d: 'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17' }))),
          h(Btn, { small: true, kind: 'primary', onClick: async () => {
            toast('ta在写了…')
            try {
              const r = await post('/diary/run', {})
              const message = r.dryRun ? '写好了（试运行，没真发）' : '发出去了'
              toast(r.ok ? [message, ...(r.warnings || [])].join('；') : r.message)
            } catch (e) { toast(e.message) }
            finally { await load() }
          } }, '现在写一篇'),
          h(Btn, { small: true, onClick: async () => { const r = await post('/diary/run', { visibility: 'self' }); toast(r.message || (r.ok ? '已写入日记' : '日记生成失败')); await load() } }, '写一篇仅自己可见的日记')) }),
        h(DiaryMedia, { st, draft, setDraft, toast }),
        h(DiaryArchive, { st, draft, setDraft, toast }),
        h(Card, { fold: 'diary-history', title: '发布历史' },
          loadErr ? h(ErrorBlock, { title: '读不到日记状态', message: loadErr, hint: '空间日记由 diary 模块提供。', onRetry: load })
            : !data ? h(Skeleton, { kind: 'row', rows: 3, label: '正在读日记状态' })
            : !data.items || data.items.length === 0 ? h(Empty, {
              icon: '📔', title: '还没写过日记',
              text: '到了设定的时段、她又正好有空有动力时会自己写一条；也可以现在让她写一篇试试。',
            }) :
            h('div', { className: 'ab-list' }, data.items.map((d, i) => h('div', { key: i, className: 'ab-li' },
              h('div', { className: 'meta' }, new Date(d.at).toLocaleString(), h('br'), d.deletedAt ? '已从空间删除' : d.dryRun ? '试运行' : d.ok ? (AUDIENCE_LABEL[d.visibility] || '已发布') : '失败'),
              h('div', { className: 'body' }, d.text,
                (d.warnings || []).map((warning, index) => h('div', { key: index, className: 'ab-small', style: { color: 'var(--ab-warn)' } }, warning)),
                d.error ? h('div', { className: 'ab-small', style: { color: 'var(--ab-err)' } }, d.error) : null),
              d.tid && !d.deletedAt ? h(Btn, { small: true, kind: 'ghost', onClick: async () => { if (!confirm('从 QQ 空间删除这条说说？')) return; try { const r = await post('/qzone/delete', { tid: d.tid }); toast(r.message) } catch (e) { toast(e.message) } finally { await load() } } }, '从空间删除') : null))),
        ),
        social,
      )
    }

    const SOCIAL_KIND = { reply: '回复评论', comment: '评论', like: '点赞' }

    /** 空间互动：回复自己说说下的评论、逛好友动态。 */
