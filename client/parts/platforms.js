    function Platforms({ st, go, draft, setDraft }) {
      const list = st.channels || []
      const f = useField(draft, setDraft)
      const label = (s) => ({ connected: '已连接', connecting: '连接中', stopped: '未启动', error: '异常' }[s] || s || '未知')
      const capLabel = { faces: '小黄脸', stickers: '表情包', voice: '语音', files: '文件', recall: '撤回', poke: '戳一戳', react: '贴表情', typing: '输入状态', history: '历史消息', forward: '合并转发', card: '名片', friendRequests: '好友申请', groupRequests: '入群申请', profile: '改资料', groupAdmin: '群管', text: '文字', reply: '回复', images: '图片' }
      const scrollTo = (id) => document.getElementById('ab-section-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const tg = list.find((p) => p.platform === 'telegram')
      const items = list.length
        ? h('div', { className: 'ab-list' }, list.map((p) => h('div', { key: p.platform, className: 'ab-li ab-platform-row' },
          h('div', { className: 'meta' },
            h('i', { className: cx('ab-dot', p.state === 'connected' ? 'ok' : p.state === 'connecting' ? 'warn' : 'err') }),
            p.label || p.platform,
            h('span', { className: 'ab-muted ab-small' }, ' · ' + label(p.state) + (p.ready ? ' · 已就绪' : ' · 未就绪'))),
          h('div', { className: 'ab-platform-caps' }, Object.entries(p.caps || {}).filter(([, v]) => v).map(([k]) => h('span', { key: k, className: 'ab-platform-chip' }, capLabel[k] || k))),
          h('div', { className: 'ab-platform-actions' },
            p.platform === 'qq' ? h(Btn, { small: true, onClick: () => go('connect') }, '配置 QQ') : null,
            p.platform === 'telegram' ? h(Btn, { small: true, onClick: () => scrollTo('telegram') }, '配置 Telegram') : null))))
        : h(Empty, { text: '还没有平台适配器' })
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '平台连接', desc: '所有平台的适配器和能力。QQ 的详细参数在「QQ 会话 → 连接」里配置；Telegram 直接在下方填写。' }, items),
        h(Card, { section: 'telegram', title: 'Telegram', desc: '长轮询 Bot API，不需要公网端口。先在 @BotFather 创建 Bot，把 Token 填在这里。', right: h('span', { className: cx('ab-badge', tg?.state === 'connected' && 'ok') }, tg ? label(tg.state) : '未启用') },
          h(Row, { label: '启用 Telegram' }, f.sw('platforms.telegram.enabled')),
          h(Row, { label: 'Bot API 地址', hint: '默认 https://api.telegram.org；服务器访问不了 Telegram 时填可用反代' }, f.text('platforms.telegram.apiBase', { placeholder: 'https://api.telegram.org' })),
          h(Row, { label: 'Bot Token', hint: '只保存在本机配置里' }, f.text('platforms.telegram.token', { type: 'password', placeholder: draft.platforms?.telegram?.tokenSet ? '已保存' : '123456:ABC...' })),
          h(Row, { label: '管理员 Telegram ID', hint: '你的 Telegram 用户 ID，可先用 @userinfobot 查' }, f.text('platforms.telegram.ownerQQ')),
          h(Row, { label: '私聊白名单', hint: '允许私聊的 Telegram 用户 ID，一行一个' }, f.list('platforms.telegram.allow.private', { placeholder: '每行一个用户 ID' })),
          h(Row, { label: '群白名单', hint: '允许的 Telegram 群 ID，一行一个（群 ID 通常是负数）' }, f.list('platforms.telegram.allow.groups', { placeholder: '每行一个群 ID' })))
      )
    }
