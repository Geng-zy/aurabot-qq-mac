    function CostCard({ draft, setDraft, st }) {
      const f = useField(draft, setDraft)
      const [now, setNow] = useState(Date.now())
      useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30_000)
        return () => clearInterval(timer)
      }, [])
      const off = !!getPath(draft, 'cost.offPeak')
      const peak = Boolean(st?.offpeak?.peak)
      const next = Number(st?.offpeak?.next) || 0
      return h(Card, {
        title: 'DeepSeek 峰谷省钱模式',
        right: f.sw('cost.offPeak'),
        desc: '默认为关，现有行为不变。打开后只把「不着急的后台模型调用」尽量放到谷时，聊天回复不受影响。峰时 = 工作日北京时间 09:00–12:00、14:00–18:00；周末和法定节假日全天谷价，谷价约为峰价一半（以 DeepSeek 官网为准）。',
      },
        h(Row, { label: '现在的时段', hint: '按北京时间算；周末和下面填的节假日全天都算谷时' },
          h('span', { className: 'ab-small', style: { color: peak ? 'var(--ab-warn)' : 'var(--ab-ok)' } }, peak ? '峰时 · 省着用' : '谷时 · 可以跑'),
          next ? h('span', { className: 'ab-small ab-muted', style: { marginLeft: 8 } }, '下次切换 ' + fmtNextChange(next, now) + '（北京时间）') : null),
        off ? h(Row, { label: '峰时推迟什么', hint: '这些是额外的后台模型调用；聊天、工具、审批、定时任务本身不受影响，到点照常' },
          h('span', { className: 'ab-small ab-muted' }, '心情模型判断（退回关键词）。心智核心的睡觉整理本来就在夜里（谷时）；白天聊完记经历用的是最低思考深度，花得很少')) : null,
        off ? h(Row, { label: '法定节假日', hint: '一行一个 YYYY-MM-DD（北京时间）。中国法定节假日日期每年不同，这里不硬编码，按官网公布的放假日期自己填；填了当天全天按谷价' },
          f.list('cost.offPeakHolidays', { placeholder: '2026-10-01\n2026-10-02' })) : null,
      )
    }
