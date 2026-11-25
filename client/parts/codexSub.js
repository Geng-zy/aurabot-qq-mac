    function CodexSub({ draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const [status, setStatus] = useState(null)
      const [waiting, setWaiting] = useState(null)
      const [input, setInput] = useState('')
      const [busy, setBusy] = useState(false)
      const refresh = () => get('/image/codex/status').then(setStatus).catch(() => setStatus({ loggedIn: false }))
      useEffect(() => { refresh() }, [])
      useEffect(() => {
        if (!waiting) return undefined
        let active = true
        const timer = setInterval(async () => {
          const r = await get('/image/codex/login/status').catch(() => null)
          if (!active || !r) return
          if (r.state === 'done' || r.state === 'error') {
            clearInterval(timer); setWaiting(null); setInput(''); refresh()
            toast(r.state === 'done' ? '登录成功' : r.error || '登录失败')
          }
        }, 2000)
        return () => { active = false; clearInterval(timer) }
      }, [Boolean(waiting)])
      const act = (path, body = {}) => async () => {
        setBusy(true)
        const r = await post(path, body).catch(() => ({ ok: false, message: '请求失败' }))
        setBusy(false)
        if (!r.ok) { toast(r.message || '操作失败'); return }
        setInput('')
        if (path.endsWith('/login')) setWaiting({ url: r.url, needPaste: r.needPaste })
        else { setWaiting(null); refresh(); toast(path.endsWith('/logout') ? '已退出 ChatGPT' : path.endsWith('/cancel') ? '已取消登录' : '登录成功') }
      }
      return h('div', null,
        h('div', { className: 'ab-note', style: { margin: '8px 0' } }, '实验性订阅接法：使用非公开图片端点，可用性和额度由账号、工作区及服务端决定。登录信息仅存本机。'),
        h(Row, { label: 'ChatGPT 账号' },
          h('span', { className: 'ab-small' }, status === null ? '读取登录状态…' : status.loggedIn ? '已登录：' + (status.email || status.accountId) : '尚未登录'),
          h(Btn, { small: true, onClick: act('/image/codex/login'), disabled: busy || Boolean(waiting) }, '登录 ChatGPT'),
          status?.loggedIn ? h(Btn, { small: true, onClick: act('/image/codex/logout'), disabled: busy }, '退出') : null),
        waiting ? h('div', { className: 'ab-note' },
          h('div', null, waiting.needPaste ? '端口 1455 被占用：打开授权链接登录，再粘贴完整回调地址。' : '请在浏览器完成登录。回调成功后自动刷新，也可以手动粘贴完整回调地址。'),
          h('a', { href: waiting.url, target: '_blank', rel: 'noreferrer', style: { display: 'block', wordBreak: 'break-all' } }, '打开 ChatGPT 授权页'),
          h('input', { className: 'ab-input', value: input, type: 'password', autoComplete: 'off', placeholder: '粘贴完整回调地址', onChange: (e) => setInput(e.target.value) }),
          h(Btn, { small: true, onClick: act('/image/codex/complete', { input }), disabled: busy || !input.trim() }, '完成登录'),
          h(Btn, { small: true, onClick: act('/image/codex/cancel'), disabled: busy }, '取消登录')) : null,
        h(Row, { label: '模型', hint: '可用模型由服务端决定' }, f.select('imageGen.codex.model', [
          'gpt-image-2',
          'gpt-image-2.5-flare',
          'gpt-image-2.5-sunburst',
          'gpt-image-2.6-flare',
          'gpt-image-2.6-sunburst',
        ].map((value) => ({ value, label: value })), { width: 260 })),
        h(Row, { label: '质量', hint: '所选模型需支持该选项' }, f.select('imageGen.codex.quality', ['auto', 'low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({ value, label: value })), { width: 180 })),
        h(Row, { label: '背景' }, f.select('imageGen.codex.background', ['auto', 'opaque', 'transparent'].map((value) => ({ value, label: value })), { width: 180 })),
        h('div', { className: 'ab-muted ab-small' }, '订阅接法通过构图提示引导，实际尺寸由服务端选择。'),
      )
    }
