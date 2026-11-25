    function Connect({ st, draft, setDraft, toast, reload, openWizard }) {
      const f = useField(draft, setDraft)
      const [moveTo, setMoveTo] = useState('')
      const conn = st.onebot.state === 'connected'
      const login = st.onebot.login
      const [diag, setDiag] = useState(null)
      const runDiag = async () => { setDiag({ busy: true }); try { setDiag(await get('/onebot/diagnose')) } catch (e) { setDiag(null); toast(e.message, 'err') } }
      const diagView = diag ? (diag.busy ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 8 } }, '正在一项项检查…') : h('div', { style: { marginTop: 10 } },
        diag.problem ? h('div', { className: 'ab-note warn' }, diag.problem) : h('div', { className: 'ab-note' }, '每一项都正常。'),
        h('table', { className: 'ab-table', style: { marginTop: 6 } }, h('tbody', null, (diag.items || []).map((it, i) => h('tr', { key: i },
          h('td', { style: { width: 24 } }, it.ok === true ? '✓' : it.ok === false ? '✗' : '·'),
          h('td', null, it.label),
          h('td', null, it.detail, it.ok === false && it.hint ? h('div', { className: 'ab-small ab-muted' }, it.hint) : null))))))) : null
      const testBtns = h('div', { className: 'ab-flex', style: { marginTop: 10, gap: 12 } },
        h(Btn, { small: true, kind: 'primary', onClick: runDiag }, '一键诊断'),
        h(Btn, { small: true, onClick: async () => { const r = await get('/onebot/test'); toast(r.message) } }, '测试连接'),
        h(Btn, { small: true, onClick: async () => { const r = await post('/onebot/reconnect'); toast(r.message, r.ok ? 'ok' : 'err'); reload() } }, '重新连接'))
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '连接状态' },
          h('div', { className: 'ab-kv' },
            h('span', null, 'QQ 网关'), h('span', null, h('span', { className: 'ab-flex' }, h('i', { className: cx('ab-dot', conn ? 'ok' : st.onebot.state === 'connecting' ? 'warn' : 'err') }), { connected: '已连上', connecting: '连接中', disconnected: '断开了，正在重连', stopped: '没启动（总开关关着）', unconfigured: '还没配置' }[st.onebot.state] || st.onebot.state)),
            h('span', null, '登录的号'), h('span', null, login ? login.nickname + '（' + login.uin + '）' + (login.uin !== (draft.platforms?.qq?.botQQ || draft.botQQ) ? ' ⚠ 不是机器人号！' : '') : '—'),
            h('span', null, 'HTTP'), h('span', null, st.onebot.endpoint.httpUrl || '—'),
            h('span', null, 'WebSocket'), h('span', null, st.onebot.endpoint.wsUrl || '—'),
          ),
          !conn && st.onebot.problem ? h('div', { className: 'ab-note warn', style: { marginTop: 10 } }, st.onebot.problem) : null,
          testBtns, diagView,
          h('div', { style: { marginTop: 12 } }, h(Btn, { small: true, onClick: async () => { const r = await post('/test-send'); toast(r.message) } }, '发一条 QQ 自测')),
        ),
        h(Card, { fold: conn ? 'qq-endpoint' : undefined, section: conn ? undefined : 'qq-endpoint', title: 'QQ 网关配置', right: openWizard ? h(Btn, { small: true, kind: 'ghost', onClick: openWizard }, '重新走一遍设置向导') : null,
          desc: 'SnowLuma 没有 macOS 版：在 OrbStack（或 Docker Desktop）里跑它的官方镜像，用远程桌面登录机器人号 ' + (draft.platforms?.qq?.botQQ || draft.botQQ || '') + '，再把它的 OneBot 正向 WebSocket 地址和令牌填在这里，保存后插件就会去连。NapCat、LLOneBot、Lagrange 等任何 OneBot v11 实现也可以。插件只连接，不启动、不注入任何东西。' },
          h(OneBotFields, { draft, f }),
          h(Row, { label: '机器人 QQ 号' }, f.text('platforms.qq.botQQ')),
        ),
        h(Card, { fold: 'qq-workspace', title: '工作区与会话维护', desc: '每个 QQ 私聊 / 群都是 DSH 里「Aurabot · QQ」工作区下的一个会话，ta在会话里读写文件也在这个文件夹。改了以后新开的会话放到新位置；已有的会话还在原来的地方，想全部换成新会话，可在下方点「重新开始所有 QQ 会话」。' },
          h(Row, { label: '工作区文件夹', hint: '填完整路径（比如 ' + exPath('Aurabot/qq-chats') + '）；留空 = 使用全局/默认位置' }, f.text('platforms.qq.workspaceDir', { size: 'wide', placeholder: st.config.platforms?.qq?.workspaceDir || st.workspaceDir || '' })),
          h('div', { className: 'ab-muted ab-small' }, '现在用的：' + (st.workspaceDir || '—') + (st.workspaceReal && st.workspaceReal !== st.workspaceDir ? '（文件实际在 ' + st.workspaceReal + '）' : '')),
          h(Row, { label: '把现有文件搬过去', hint: '填一个空文件夹的完整路径。已有会话照常接着聊，原路径留一个联接指过去；聊天记录和记忆在用户目录的 .dsh 里，不跟着搬。她正在跑命令时搬不了' },
            h('div', { className: 'ab-flex' },
              h('input', { className: 'ab-input', value: moveTo, placeholder: exPath('Aurabot/qq-chats'), onChange: (e) => setMoveTo(e.target.value) }),
              h(Btn, { small: true, disabled: !moveTo.trim(), onClick: async () => {
                const r = await post('/workspace/move', { to: moveTo.trim() })
                toast(r.message, r.ok ? 'ok' : 'err')
                if (r.ok) { setMoveTo(''); reload() }
              } }, '搬过去'))),
            h(Btn, { small: true, kind: 'ghost', onClick: async () => {
              if (!confirm('重新开始所有 QQ 会话？普通旧会话会归档，有工作树的旧会话会留在侧栏。')) return
              const r = await post('/sessions/reset')
              toast(r.message)
              if (r.ok) reload()
            } }, '重新开始所有 QQ 会话'),
        ),
      )
    }

    /** 选一张图片当头像（最多 5MB）。 */
