    function ImageFallbacks({ draft, setDraft }) {
      const f = useField(draft, setDraft)
      const rows = draft.imageGen.fallbacks || []
      const write = (list) => setDraft(setPath(draft, 'imageGen.fallbacks', list))
      const move = (index, delta) => {
        const list = [...rows]
        const target = index + delta
        if (target < 0 || target >= list.length) return
        const entry = list[index]
        list[index] = list[target]
        list[target] = entry
        write(list)
      }
      return h(Card, { fold: 'image-fallbacks', title: '备用生图服务', right: f.sw('imageGen.fallbackEnabled'), desc: '主服务不可用时按顺序尝试。提示词和参考图会发给尝试的备用服务。试运行会实际生成图片并存入画作库。' },
        rows.map((item, index) => {
          const codex = item.provider === 'codex'
          const set = (key, value) => write(rows.map((row, i) => i === index ? { ...row, [key]: value } : row))
          const input = (key, props = {}) => h('input', { className: 'ab-input wide', value: item[key] ?? '', onChange: (e) => set(key, e.target.value), ...props })
          return h('fieldset', { key: item.id, className: 'ab-card', style: { marginBottom: 8, minWidth: 0 } },
            h('legend', null, '备用服务 ' + (index + 1)),
            h(Row, { label: '接口格式' }, h(Select, { value: item.provider || 'openai', onChange: (v) => set('provider', v),
              options: [{ value: 'openai', label: 'OpenAI 兼容' }, { value: 'seedream', label: '豆包 Seedream' }, { value: 'xai', label: 'xAI' }, { value: 'gemini', label: 'Gemini' }, { value: 'sensenova', label: 'SenseNova' }, { value: 'codex', label: '已登录的 Codex 订阅' }] })),
            !codex ? h(Row, { label: '服务地址' }, input('baseUrl', { placeholder: 'https://example.com/v1' })) : null,
            h(Row, { label: '模型' }, input('model')),
            !codex ? h(Row, { label: 'API Key' }, input('apiKey', { type: 'password', placeholder: secretPlaceholder(item.apiKeySet, { savedText: '已保存', fallback: '可留空' }) }),
              item.apiKeySet ? h(Btn, { small: true, onClick: () => set('apiKey', null) }, item.apiKey === null ? '保存后清空' : '清空') : null) : null,
            h('div', { className: 'ab-flex' },
              h(Btn, { small: true, disabled: index === 0, onClick: () => move(index, -1) }, '上移'),
              h(Btn, { small: true, disabled: index === rows.length - 1, onClick: () => move(index, 1) }, '下移'),
              h(Btn, { small: true, kind: 'danger', onClick: () => write(rows.filter((_, i) => i !== index)) }, '移除')))
        }),
        rows.length < 5 ? h(Btn, { small: true, onClick: () => write([...rows, {
          id: globalThis.crypto?.randomUUID?.() || 'fallback-' + Date.now() + '-' + Math.random().toString(36).slice(2),
          provider: 'openai', baseUrl: '', apiKey: '', model: '',
        }]) }, '添加备用服务') : null)
    }
