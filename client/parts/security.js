    function Security({ st, draft, setDraft }) {
      const f = useField(draft, setDraft)
      const mode = (draft.security && draft.security.ssrfMode) || 'strict'
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '危险命令确认', right: f.sw('security.dangerConfirm'), desc: '打开后，ta在私聊里要执行终端危险命令（删根目录、格式化、关机、下载后直接执行等）之前，会先发 QQ 私聊问你；你回复「确认」才执行，回复「取消」或 60 秒没回就拦下。默认关。只拦真正致命的命令，普通删除/构建/改文件不受影响。' }),
        h(Card, { fold: 'security-download', title: 'SSRF 防护', desc: '限制 ta 下载图片、语音时能访问哪些地址 —— 防止有人用一条链接诱导 ta 去访问你电脑或内网里的服务（路由器管理页、云服务器的 169.254.169.254、本机端口之类）。' },
          h(Row, { label: '防护强度', hint: '部署在服务器上、或者群里有陌生人时，用「严格」' },
            h(Seg, {
              value: mode,
              onChange: (v) => setDraft(setPath(draft, 'security.ssrfMode', v)),
              options: [{ value: 'strict', label: '严格' }, { value: 'loose', label: '宽松' }],
            })),
          mode === 'strict'
            ? h('div', { className: 'ab-note' }, '严格：解析结果里只要有一个地址落在内网段（10./127./169.254./172.16-31/192.168./100.64-127/fd00::/8 等）就拒绝。最安全；但如果你的代理 DNS 会给公网域名塞一条 IPv6 假地址，正常图片也会被拦下来。')
            : h('div', { className: 'ab-note warn' }, '宽松：只有解析结果全部是内网才拒绝。适合本机开着 fake-ip 代理、DNS 会给公网域名同时返回公网地址和 IPv6 ULA（fd00::/8）的情况。代价是「公网 + 内网混合返回」的域名会被放行 —— 别在服务器上开。'),
          h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, '严格模式下图片老是下不来时，先查一下这个域名是不是解析出了内网地址：nslookup -type=AAAA multimedia.nt.qq.com.cn'),
        ),
        h(Card, { fold: 'security-remote', title: '远端管理（反代部署）', desc: '默认只有本机能打开面板、调管理接口——能改配置、装模块、取联动密钥、取联动密钥，所以默认不外放。要做远端管理必须在这里显式打开，并且务必在反向代理层再加一道认证（Basic Auth / OAuth）。' },
          h(Row, { label: '允许远端访问管理接口', hint: '⚠ 打开后任何能连到插件端口的人都能改你的配置。只在反代已加认证时才开' },
            h(Switch, {
              on: (draft.security && draft.security.panelRemoteAccess) === true,
              onChange: (v) => setDraft(setPath(draft, 'security.panelRemoteAccess', v)),
            })),
          (draft.security && draft.security.panelRemoteAccess) === true
            ? h('div', { className: 'ab-note warn' }, '已允许远端管理。请确认反向代理上已经加了认证，否则等于把管理权交给任何扫到你端口的人。')
            : h('div', { className: 'ab-note' }, '只允许本机访问。直接连公网或经反代进来都会被 403 挡下。'),
          h(Row, { label: '可信反向代理地址', hint: '放在反代后面才需要填。填反代自己的地址（127.0.0.1 = 本机 nginx，172.17.0.1 = 容器网关），多个用逗号分隔' },
            h('input', {
              className: 'ab-input',
              value: (draft.security && draft.security.trustedProxy) || '',
              placeholder: '127.0.0.1',
              onChange: (e) => setDraft(setPath(draft, 'security.trustedProxy', e.target.value)),
            })),
          h(Row, { label: '面板对外域名（反代部署）', hint: '面板经反代对外时填域名（如 panel.example.com）。跨站防护把这个域名发来的请求也算「同源」，不然从远端打开面板一保存就会被 403' },
            h('input', {
              className: 'ab-input',
              value: (draft.security && draft.security.publicHostname) || '',
              placeholder: 'panel.example.com',
              onChange: (e) => setDraft(setPath(draft, 'security.publicHostname', e.target.value)),
            })),
          h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } },
            '插件判断「请求从哪来」只看 TCP 连接的对端地址——X-Forwarded-For 是客户端自己就能写的头，不能信。'
            + '放在反代后面时连接对端永远是反代自己，所以要把反代地址填进上面，插件才会采信 X-Forwarded-For 的最后一跳。'
            + '留空 = 从不相信任何转发头（最安全，适合直连暴露或纯同机）。'),
        ),
        h(Card, { fold: 'security-basics', title: '其它内置防护', desc: '这些是固定行为，暂时没有开关。' },
          h('div', { className: 'ab-muted ab-small', style: { whiteSpace: 'pre-wrap' } },
            ['· 只下载 http / https，并限制单张图片大小', '· 只从白名单里的会话收表情', '· 群管操作只认管理员，对象不能是管理员自己', '· 联动（bridge）默认关闭，开放时必须带密钥', '· 表情的改名 / 删除只对管理员开放'].join('\n')),
        ),
      )
    }
