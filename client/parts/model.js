    function Model({ draft, setDraft, toast, st }) {
      const [list, setList] = useState(null)
      const [ping, setPing] = useState({})
      const [loadErr, setLoadErr] = useState('')
      const load = () => get('/models').then((r) => {
        if (r && r.ok !== false) { setList(r.list || []); setLoadErr('') } else { setList([]); setLoadErr(r?.message || '读不到模型列表') }
      }).catch((e) => { setList([]); setLoadErr('连不上插件：' + e.message) })
      useEffect(() => { load() }, [])
      const key = (m) => m.provider + '::' + m.model
      const cur = draft.model.provider && draft.model.model ? draft.model.provider + '::' + draft.model.model : ''
      const curModel = cur && list ? list.find((m) => key(m) === cur) : null
      // reasoning === null 表示 DSH 明确说这个模型不支持思考强度（本地 Ollama 之类）
      const noReasoning = Boolean(curModel && curModel.reasoning === null)
      // 视觉能力：自动时把 DSH 的声明显示出来，管理员一眼能看出会不会降级
      const autoVision = curModel ? curModel.vision : undefined
      const visionHint = draft.model.vision === 'on'
        ? '强制当「能看图」；模型其实看不了的话，带图的那一轮会报错'
        : draft.model.vision === 'off'
          ? '强制当「看不懂」：收到图片只给一行文字提示，不会把图塞给模型'
          : autoVision === true
            ? '自动：DSH 说这个模型支持看图'
            : autoVision === false
              ? '自动：DSH 说这个模型看不了图，会自动降级成文字提示'
              : '自动：DSH 没声明，默认照发；真看不了就手动选「不支持」'
      const test = async (m) => {
        setPing({ ...ping, [key(m)]: '测速中…' })
        const r = await post('/model/ping', { provider: m.provider, model: m.model })
        setPing((p) => ({ ...p, [key(m)]: r.ok ? (r.ms / 1000).toFixed(1) + ' 秒' : '失败：' + (r.message || '') }))
      }
      if (loadErr) return h('div', { className: 'ab-grid' }, h(ErrorBlock, { title: '读不到模型列表', message: loadErr, hint: '模型由 DSH 提供；确认 DSH 里有可用模型后重试。', onRetry: load }))
      return h('div', { className: 'ab-grid' },
        list === null ? h(Skeleton, { kind: 'card', label: '正在读模型列表' }) : null,
        list && list.length === 0 ? h(Empty, {
          icon: '🧩', title: 'DSH 里还没有可用模型',
          text: '先在 DSH 里配好一个模型（设置 → 模型），这里就能选它；也可以先留「跟随 DSH 默认」。',
        }) : null,
        h(Card, { title: '聊天用的模型', desc: '新建的 QQ 会话按这里的设置来；已有会话也可以在 DSH 里点开单独切换。聊天对速度很敏感，可以先点「测速」挑个快的。' },
          h(Row, { label: '思考强度', hint: noReasoning ? '这个模型不支持思考强度，会自动忽略' : '聊天建议「低」，回得快' }, h(Seg, { value: draft.model.reasoningEffort || 'low', disabled: noReasoning, onChange: (v) => setDraft(setPath(draft, 'model.reasoningEffort', v)), options: [{ value: 'low', label: '低' }, { value: 'high', label: '高' }, { value: 'max', label: '最高' }] })),
          h(Row, { label: '视觉能力', hint: visionHint }, h(Seg, {
            value: draft.model.vision || 'auto',
            onChange: (v) => setDraft(setPath(draft, 'model.vision', v)),
            options: [{ value: 'auto', label: '自动' }, { value: 'on', label: '支持' }, { value: 'off', label: '不支持' }],
          })),
          h(Row, { label: '模型' },
            h(Select, {
              value: cur, width: 280,
              options: [{ value: '', label: '跟随 DSH 默认', desc: '和你在 DSH 里平时用的一样' }].concat((list || []).map((m) => ({ value: key(m), label: m.name, desc: m.provider, group: m.provider }))),
              onChange: (v) => { const [p, ...m] = v.split('::'); setDraft(setPath(setPath(draft, 'model.provider', v ? p : ''), 'model.model', v ? m.join('::') : '')) },
            }),
            cur ? h(Btn, { small: true, onClick: () => test({ provider: draft.model.provider, model: draft.model.model }) }, '测速') : null,
            cur && ping[cur] ? h('span', { className: 'ab-muted ab-small' }, ping[cur]) : null),
        ),
        h(ChatModels, { draft, setDraft, list }),
        h(CostCard, { draft, setDraft, st }),
        h(Card, { fold: 'qq-model-speed', title: '模型列表与测速', desc: '点「测速」会真的问一次模型（花一点点额度），看它回一句话要多久。' },
          list === null ? h(Empty, { icon: '⏳', text: '加载中…' }) : list.length === 0 ? h(Empty, { text: 'DSH 没有列出模型' }) :
            h('table', { className: 'ab-table' }, h('tbody', null, list.map((m) => h('tr', { key: key(m) },
              h('td', null, m.name), h('td', { className: 'ab-muted' }, m.provider),
              h('td', null, ping[key(m)] || ''),
              h('td', { style: { textAlign: 'right' } }, h(Btn, { small: true, kind: 'ghost', onClick: () => test(m) }, '测速'), h(Btn, { small: true, kind: 'ghost', onClick: () => { setDraft(setPath(setPath(draft, 'model.provider', m.provider), 'model.model', m.model)); toast('选好了，记得保存') } }, '用这个')))))),
        ),
      )
    }

    /** 语音条变声：用「翻唱」页导入的 RVC 音色模型（TTS 后接一层 RVC）。 */
