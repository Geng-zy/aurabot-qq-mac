    function ModuleTutorial({ toast }) {
      const [text, setText] = useState('')
      const [err, setErr] = useState('')
      const open = (e) => {
        if (!e.target.open || text) return
        get('/modules/tutorial').then((r) => (r.ok ? setText(r.text) : setErr(r.message)))
      }
      return h('details', { className: 'ab-card', onToggle: open },
        h('summary', { style: { cursor: 'pointer', fontWeight: 620 } }, '想自己写一个模块？'),
        h('p', { className: 'ab-desc', style: { marginTop: 8 } }, '从零写一个模块，或者改现有模块。不会写代码也行：复制教程给 DSH，告诉它你想要什么。'),
        h('div', { className: 'ab-flex', style: { marginBottom: 10 } },
          h(Btn, { small: true, kind: 'primary', disabled: !text, onClick: () => copy(text, toast, '写模块教程复制好了') }, '复制教程'),
          h('a', { className: 'ab-small', href: TUTORIAL_URL, target: '_blank', rel: 'noreferrer' }, '在 GitHub 上看')),
        err ? h('div', { className: 'ab-note warn' }, err) : null,
        text ? h('pre', { className: 'ab-small', style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 420, overflow: 'auto', margin: 0 } }, text) : (err ? null : h('div', { className: 'ab-small ab-muted' }, '加载中…')))
    }

    /** 模块库：逛、搜、装、更新、卸载社区模块。安装前给用户看来源和能力，能力声明不是沙箱。 */
    const CAP_LABEL = { network: '联网', filesystem: '读写本机文件', process: '启动其他程序', 'dynamic-code': '动态执行代码', 'plugin-config': '读写插件配置（含账号 Cookie）', 'plugin-internals': '使用插件内部接口' }
    const CATEGORY_LABEL = { platform: '逛平台', social: '聊天互动', creative: '创作', desktop: '桌面', manage: '管理', tool: '工具' }
    const capText = (m) => (m.capabilities || []).map((c) => CAP_LABEL[c] || c)
