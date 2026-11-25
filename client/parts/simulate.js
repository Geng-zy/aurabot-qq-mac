    function Simulate({ toast }) {
      const [as, setAs] = useState('owner')
      const [kind, setKind] = useState('private')
      const [text, setText] = useState('')
      const [reply, setReply] = useState('')
      const [out, setOut] = useState(null)
      const [tools, setTools] = useState([])
      const [tool, setTool] = useState('')
      const [args, setArgs] = useState('{}')
      const [tout, setTout] = useState(null)
      useEffect(() => { get('/modules/tools?as=' + as + '&kind=' + kind).then((r) => { const l = r.list || []; setTools(l); if (!l.some((t) => t.name === tool)) setTool(l[0] ? l[0].name : '') }) }, [as, kind])
      const cur = tools.find((t) => t.name === tool)
      const run = async () => { const r = await post('/modules/simulate', { as, kind, text, reply }); if (r.ok === false) return toast(r.message, 'err'); setOut(r) }
      const call = async () => {
        let a
        try { a = JSON.parse(args || '{}') } catch (e) { return toast('参数要是 JSON，比如 {"city":"北京"}', 'err') }
        const r = await post('/modules/tool', { as, kind, name: tool, args: a })
        if (r.ok === false) return toast(r.message, 'err')
        setTout(r)
      }
      const sentList = (sent) => (sent && sent.length ? h('div', { className: 'ab-code' }, sent.map((s) => '→ ' + s.chatId + '：' + s.text).join('\n')) : h('div', { className: 'ab-small ab-muted', style: { marginTop: 6 } }, '没有发出任何消息'))
      return h(Card, { fold: 'modules-simulate', title: '模拟测试', desc: '不用上 QQ 就能试模块：这里发出去的消息只截下来显示，不会真发到 QQ。（模块直接调 api.onebot 的操作，比如禁言、发空间，是真的会执行的；会改设置的内置命令不执行。）' },
        h(Row, { label: '假装是', hint: '谁在说话、在哪儿说' },
          h('div', { className: 'ab-flex' },
            h(Seg, { value: as, options: [{ value: 'owner', label: '管理员' }, { value: 'other', label: '别人' }], onChange: setAs }),
            h(Seg, { value: kind, options: [{ value: 'private', label: '私聊' }, { value: 'group', label: '群聊' }], onChange: setKind }))),
        h(Row, { label: '发一条消息', hint: '看哪个模块接管、命令回什么（/开头是命令）' },
          h('input', { className: 'ab-input', value: text, placeholder: '比如：早安，或 /weather 北京', onChange: (e) => setText(e.target.value) })),
        h(Row, { label: 'ta的回复', hint: '可选：假设ta这样回，看经过各个模块改写后最后发出去什么（可以用 ||| 分条、<voice>…</voice>）' },
          h('input', { className: 'ab-input', value: reply, placeholder: '比如：早呀|||今天也要加油', onChange: (e) => setReply(e.target.value) })),
        h('div', { className: 'ab-flex' }, h(Btn, { kind: 'primary', small: true, disabled: !text.trim() && !reply.trim(), onClick: run }, '模拟')),
        out ? h('div', { style: { marginTop: 8 } }, out.steps.map((s, i) => h('div', { key: i, className: 'ab-small' }, '· ' + s)), sentList(out.sent)) : null,
        h('div', { className: 'ab-section-title' }, '调用工具'),
        tools.length ? h('div', null,
          h(Row, { label: '工具', hint: cur ? cur.description : '' }, h(Select, { value: tool, options: tools.map((t) => ({ value: t.name, label: t.name })), onChange: (v) => { setTool(v); setArgs('{}'); setTout(null) } })),
          cur && cur.parameters && Object.keys(cur.parameters.properties || {}).length ? h('div', { className: 'ab-small ab-muted', style: { margin: '0 0 6px' } }, '参数：' + Object.entries(cur.parameters.properties).map(([k, v]) => k + (v.description ? '（' + v.description + '）' : '')).join('；')) : null,
          h('textarea', { className: 'ab-textarea', style: { minHeight: 50, fontFamily: 'ui-monospace,Consolas,monospace' }, value: args, onChange: (e) => setArgs(e.target.value) }),
          h('div', { className: 'ab-flex', style: { marginTop: 6 } }, h(Btn, { small: true, onClick: call, disabled: !tool }, '调用')),
          tout ? h('div', null, h('div', { className: 'ab-code' }, JSON.stringify(tout.result, null, 2)), sentList(tout.sent)) : null)
          : h('div', { className: 'ab-small ab-muted' }, '这个场合没有工具'))
    }

    /** 写模块的教程：随插件带着，连不上 GitHub 也能看；复制后可以直接粘给 DSH。 */
    const TUTORIAL_URL = PROJECT_REPO + '/blob/main/docs/MODULE-TUTORIAL.md'
