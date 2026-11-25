    function Wizard({ st, draft, setDraft, save, toast, reload, onClose }) {
      const [step, setStep] = useState(() => { try { return Number(localStorage.getItem('aurabot.wiz') || 0) } catch (e) { return 0 } })
      const go = (i) => { setStep(i); try { localStorage.setItem('aurabot.wiz', String(i)) } catch (e) {} }
      const f = useField(draft, setDraft)
      const conn = st.onebot.state === 'connected'
      const login = st.onebot.login
      const [live, setLive] = useState('dry')
      const botQQ = draft.platforms?.qq?.botQQ || draft.botQQ
      const ownerQQ = draft.platforms?.qq?.ownerQQ || draft.ownerQQ
      const qqOk = /^\d{5,11}$/.test(botQQ || '') && /^\d{5,11}$/.test(ownerQQ || '') && botQQ !== ownerQQ
      const verified = conn && login && String(login.uin) === String(st.config.botQQ) && !st.onebot.problem
      const canNext = [qqOk, Boolean(draft.platforms?.qq?.wsUrl || st.config.platforms?.qq?.wsUrl || draft.snowluma?.wsUrl || st.config.snowluma?.wsUrl), verified, true][step]
      const next = async () => {
        if ((step === 0 || step === 1) && !(await save({ ...draft, enabled: true }))) return
        go(Math.min(step + 1, WIZ_STEPS.length - 1))
        reload()
      }
      const useExisting = async () => {
        const r = await post('/setup/done', { existingConnection: true })
        toast(r.message, r.ok ? 'ok' : 'err')
        if (r.ok) { try { localStorage.removeItem('aurabot.wiz') } catch (e) {} reload(); onClose && onClose() }
      }
      const body = [
        // 0. QQ 号
        h('div', null,
          h('p', { className: 'ab-desc' }, '大肥鱼需要一个自己的 QQ 号（机器人号），还要知道谁是ta的管理员。'),
          h(Row, { label: '机器人 QQ 号', hint: '强烈建议用小号：非官方 QQ 工具有被限制的风险' }, f.text('platforms.qq.botQQ', { placeholder: '例如 123456789' })),
          h(Row, { label: '你的 QQ 号（管理员）', hint: '群管、操作电脑这些只听管理员的' }, f.text('platforms.qq.ownerQQ', { placeholder: '你的大号' })),
          h(Row, { label: 'ta怎么称呼你' }, f.text('ownerName', { placeholder: '管理员' })),
          h(Row, { label: '工作区文件夹', hint: 'ta在 QQ 会话里读写文件的地方，' + '想放在别处就填完整路径' + '，比如 ' + exPath('Aurabot/qq-chats') + '。填完整路径，留空用默认位置。以后想换，在「连接」页能搬。聊天记录和记忆在用户目录的 .dsh 里，不在这个文件夹' }, f.text('platforms.qq.workspaceDir', { size: 'wide', placeholder: st.config.platforms?.qq?.workspaceDir || st.workspaceDir || '' })),
          (draft.platforms?.qq?.botQQ || draft.botQQ) && (draft.platforms?.qq?.ownerQQ || draft.ownerQQ) && (draft.platforms?.qq?.botQQ || draft.botQQ) === (draft.platforms?.qq?.ownerQQ || draft.ownerQQ) ? h('div', { className: 'ab-note err' }, '机器人号和管理员号不能是同一个。') : null),
        // 1. 接 QQ 网关：你自己跑的 OneBot（macOS 上一般是 OrbStack 里的 SnowLuma）
        h('div', null,
          h('p', { className: 'ab-desc' }, 'SnowLuma 没有 macOS 版：在 OrbStack（或 Docker Desktop）里用它官方的 docker-compose.yml 跑起来，打开它的远程桌面登录机器人号，再把 OneBot 的正向 WebSocket 地址（一般是 ws://127.0.0.1:3001）和令牌填在下面。NapCat、LLOneBot、Lagrange 等任何 OneBot v11 实现也可以。插件只连接，不会启动或注入任何东西。'),
          h(OneBotFields, { draft, f })),
        // 2. 连上机器人号
        h('div', null,
          h('p', { className: 'ab-desc' }, '确认你的 OneBot 服务登录的是机器人号 ' + (st.config.botQQ || '') + '，然后点「连接」。插件连上后会先核对登录的号，不是机器人号就断开。'),
          h('div', { className: 'ab-flex' },
            h(Btn, { kind: 'primary', small: true, onClick: async () => { const r = await post('/onebot/reconnect'); toast(r.message, r.ok ? 'ok' : 'err'); reload() } }, '连接'),
            h(Btn, { small: true, onClick: async () => { const r = await get('/onebot/test'); toast(r.message) } }, '测试连接')),
          conn && login ? h('div', { className: 'ab-note', style: { marginTop: 10 } }, login.uin === st.config.botQQ ? '✓ 连上了：' + login.nickname + '（' + login.uin + '）' : '⚠ 连上的是 ' + login.uin + '，不是机器人号') : h('div', { className: 'ab-muted ab-small', style: { marginTop: 10 } }, '点「连接」后稍等几秒，连上了这里会显示。')),
        // 3. 完成
        h('div', null,
          h('p', { className: 'ab-desc' }, '都准备好了！最后选一下ta怎么上线：'),
          h(Choices, { value: live, onChange: setLive, options: [
            { value: 'dry', label: '先试运行', desc: 'ta会照常思考，但只写进日志、不真的发出去。看几条没问题再在右上角关掉试运行' },
            { value: 'live', label: '直接上线', desc: '马上开始真的回 QQ 消息' },
          ] }),
          h('div', { className: 'ab-flex', style: { marginTop: 12 } },
            h(Btn, { small: true, onClick: async () => { await save({ ...draft, enabled: true, dryRun: false }); const r = await post('/test-send'); toast(r.message); await save({ ...draft, enabled: true, dryRun: live === 'dry' }) } }, '给我发一条自测消息'))),
      ][step]
      return h('div', { className: 'ab-card', style: { padding: '20px 22px' } },
        h('div', { className: 'ab-flex', style: { marginBottom: 6 } }, h('h3', { style: { margin: 0, fontSize: 16 } }, '设置向导'), h('span', { className: 'ab-muted ab-small' }, '第 ' + (step + 1) + ' / ' + WIZ_STEPS.length + ' 步 · ' + WIZ_STEPS[step]), h('div', { className: 'ab-spacer' }),
          st.config.setupDone && onClose ? h(Btn, { small: true, kind: 'ghost', onClick: onClose }, '关闭向导') : null),
        !st.config.setupDone ? h('details', { style: { marginTop: 10 } }, h('summary', { className: 'ab-small' }, '换电脑了？从备份恢复'), h('div', { style: { marginTop: 10 } }, h(Backup, { toast }))) : null,
        h('div', { className: 'ab-wiz-bar' }, WIZ_STEPS.map((s, i) => h('button', { key: s, type: 'button', className: cx('seg', i < step && 'done', i === step && 'on'), onClick: () => i <= step && go(i), title: s }, h('span', null, s)))),
        verified && !st.config.setupDone ? h('div', { className: 'ab-note', style: { marginTop: 12 } }, '机器人号已经连接并核对通过。', ' ', h(Btn, { small: true, onClick: useExisting }, '使用现有连接，进入面板')) : null,
        h('div', { style: { minHeight: 220, marginTop: 14 } }, body),
        h('div', { className: 'ab-flex', style: { marginTop: 16, borderTop: '1px solid var(--ab-line)', paddingTop: 12 } },
          step > 0 ? h(Btn, { kind: 'ghost', onClick: () => go(step - 1) }, '上一步') : null,
          h('div', { className: 'ab-spacer' }),
          step < WIZ_STEPS.length - 1
            ? h(Btn, { kind: 'primary', disabled: !canNext, onClick: next }, '下一步')
            : h(Btn, { kind: 'primary', onClick: async () => {
              if (!(await save({ ...draft, enabled: true, dryRun: live === 'dry' }))) return
              const r = await post('/setup/done'); toast(r.message, r.ok ? 'ok' : 'err')
              if (r.ok) { try { localStorage.removeItem('aurabot.wiz') } catch (e) {} reload(); onClose && onClose() }
            } }, '完成，让大肥鱼上线')))
    }

    // ---------------- 面板主体 ----------------
    const TAB_CONTENT = {
      overview: Overview, now: MindNow, mood: Mood, knowledge: Knowledge, persona: MindPeople, inner: MindInner, selfmind: Identity, mindsettings: MindSettings, platforms: Platforms,
      connect: Connect, group: Group, model: Model, asr: Asr, access: Access, diary: Diary,
      voice: Voice, stickers: Stickers, imagegen: ImageGen, song: Song, video: LocalApi,
      logs: Logs, backup: Backup, security: Security, browser: Browser, local: LocalApi, about: About,
      modules: Modules, market: Market,
    }
    const moduleSearchText = (m) => [m.description, ...(m.settings || []).flatMap((s) => [s.label, s.key, s.hint])].filter(Boolean).join(' ')
    const TAB_KEYS = {
      connect: ['platforms', 'snowluma', 'botQQ', 'workspaceDir'], platforms: ['platforms'], access: ['platforms', 'ownerQQ', 'ownerName', 'ownerLevel', 'freedom', 'approvalNotify', 'notice', 'approvalViaQQ', 'qqApi', 'longTasks', 'profilePerms', 'allow', 'drawAllow', 'subagentBackground', 'files', 'group.ownerTools', 'group.ownerToolsGroups'],
      group: ['group.wakeWords', 'group.mustMaxPerHour', 'group.ignoreAtOthers', 'group.crossRead', 'group.engagedMax', 'group.burstMax', 'group.burstWindowSec', 'group.cooldownSec', 'group.minRecentMessages', 'group.activeWindowSec', 'group.overrides', 'merge', 'titleFilter', 'chat'],
      model: ['model', 'chatModels'], voice: ['voice'], asr: ['voice.asr', 'voice.asrApi'], stickers: ['stickers'],
      imagegen: ['imageGen', 'local'], diary: ['diary', 'qzoneSocial'], mood: ['mind', 'memory'], song: ['song'],
      local: ['local'], video: ['local'], browser: ['browser'], security: ['security'], modules: ['modules', 'safeMode'],
    }
