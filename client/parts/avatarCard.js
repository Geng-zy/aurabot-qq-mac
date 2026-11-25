    function AvatarCard({ st, toast, reload }) {
      const custom = st.avatar && st.avatar.custom
      return h('div', { className: 'ab-card', style: { marginTop: 12, padding: 14 } },
        h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 12 } },
          h('img', { src: avatarSrc(st), alt: '头像', style: { width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', objectPosition: '50% 18%', border: '2px solid var(--ab-line)' } }),
          h('div', null, h('b', null, '头像'), h('div', { className: 'ab-muted ab-small' }, custom ? '用的是你上传的图片' : '默认的大肥鱼'))),
        h('div', { className: 'ab-flex', style: { marginTop: 10, flexWrap: 'wrap' } },
          h(Btn, { small: true, kind: 'primary', onClick: () => pickAvatar(toast, reload) }, '换一张'),
          custom ? h(Btn, { small: true, kind: 'ghost', onClick: async () => { const r = await post('/avatar/reset'); toast(r.message, 'ok'); reload() } }, '恢复默认') : null,
          h(Btn, { small: true, kind: 'ghost', onClick: async () => { if (!confirm('把这张图设成机器人号的 QQ 头像？')) return; const r = await post('/avatar/sync-qq'); toast(r.message, r.ok ? 'ok' : 'err') } }, '同步成 QQ 头像')),
        h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, '这是面板里显示的头像；点「同步成 QQ 头像」才会改机器人号在 QQ 上的头像。'))
    }

    // 人格按【标题】分节：面板里拆开逐节编辑，保存时按原来的写法拼回一整段（文件格式不变）
    const PSEC_HEAD = /^【([^】\n]{1,30})】\s*$/
    const PSEC_SUGGEST = ['你的样子', '性格', '打字习惯', '情绪是活的', '你的生活', '和管理员的关系', '绝对禁止']
    // 每节一个颜色（跟着这一节走，挪位置颜色不变）。低饱和的雾色系，相邻的冷暖交替，深浅两种主题下都不刺眼：
    // 青瓷、雾紫、琥珀、雾蓝、藕粉、苔绿、黛蓝、赭石、橄榄、紫藤
    const PSEC_COLORS = ['#4f9a8c', '#8a7bc0', '#c08a4a', '#5f8fc7', '#c47a90', '#6f9f68', '#5c6fae', '#b9775a', '#8d9450', '#a173b5']
    let psecSeq = 0
    const psec = (title, text) => ({ k: ++psecSeq, title, text })
    const splitPersona = (body) => {
      const out = [psec(null, '')]
      let cur = out[0]
      let buf = []
      const flush = () => { cur.text = buf.join('\n').replace(/^\n+/, '').replace(/\s+$/, ''); buf = [] }
      for (const line of String(body || '').replace(/\r\n/g, '\n').split('\n')) {
        // 复制粘贴来的人设常带看不见的零宽字符（行首一个 U+200B），认标题时不算它
        const m = PSEC_HEAD.exec(line.replace(/[​-‍﻿]/g, '').trim())
        if (m) { flush(); cur = psec(m[1].trim(), ''); out.push(cur) } else buf.push(line)
      }
      flush()
      return out
    }
    const joinPersona = (secs) => secs
      .map((s) => (s.title === null ? s.text.trim() : '【' + (s.title.trim() || '未命名') + '】\n' + s.text.replace(/\s+$/, '')))
      .filter(Boolean).join('\n\n')
    const autoRows = (text) => Math.min(22, Math.max(3, String(text || '').split('\n').length + 1))

    /** 一节设定：标题、正文、上下移、删除、AI 润色。润色后原版和润色版只显示一个，按钮来回切，选定一个另一个就丢掉。 */
