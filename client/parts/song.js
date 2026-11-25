    function Song({ st, draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const [s, setS] = useState(st.song)
      const [q, setQ] = useState('')
      const [found, setFound] = useState(null)
      const [pitch, setPitch] = useState(0)
      const [acct, setAcct] = useState(null)
      const load = () => get('/song/status').then((r) => r.ok && setS(r))
      // 安装中 / 正在唱的时候每 3 秒刷新一次进度
      useEffect(() => {
        load()
        const busy = s && (s.install.running || s.profileJob?.running || s.current || s.queue.length)
        if (!busy) return
        const t = setInterval(load, 3000)
        return () => clearInterval(t)
      }, [s && s.install.running, s?.profileJob?.running, s && Boolean(s.current), s && s.queue.length])
      if (!s) return h(Empty, { icon: '⏳', text: '加载中…' })
      const search = async () => { if (!q.trim()) return; setFound(null); const r = await get('/song/search?q=' + encodeURIComponent(q)); setFound(r.list || []); if (!r.ok) toast(r.message, 'err') }
      const sing = async (song) => { const r = await post('/song/request', { songId: song.id, song: song.name, pitch }); toast(r.message, r.ok ? 'ok' : 'err'); load() }
      const voices = s.voices.map((v) => ({ value: v.id, label: v.id, desc: v.hasIndex ? '带 .index' : '' }))
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '翻唱', right: f.sw('song.enabled'), desc: '让ta用自己的声音唱歌：点歌 → 从网易云下载 → 分离人声和伴奏 → 用 RVC 换成ta的声音 → 混音 → 发语音条。管理员在 QQ 里说「唱首歌」，或者发 /sing 歌名 都行。' },
          h('div', { className: cx('ab-note', s.ready ? '' : 'warn') }, s.message),
          h('div', { className: 'ab-checks', style: { marginTop: 12 } },
            SONG_PARTS.map(([k, label]) => h('div', { key: k, className: cx('ab-check', s.parts[k] && 'done') }, h('i', null, s.parts[k] ? '✓' : '·'), label)),
            h('div', { className: cx('ab-check', s.voices.length && 'done'), title: s.voices.map((v) => v.id).join('、') }, h('i', null, s.voices.length ? '✓' : '·'), s.voices.length ? '音色模型 ×' + s.voices.length : '音色模型（在下面导入）')),
          s.install.running ? null : h('div', { style: { marginTop: 12 } },
            h(Row, { className: 'ab-block', label: '装到哪里', hint: '装完约 5 GB，音色模型也放这里。改了要先保存设置再点安装' }, h(RootPicker, { draft, setDraft, s })),
            h(Row, { label: '下载源', hint: '自动：安装前先测一下，官方源慢就用国内镜像（阿里云 / 南京大学 / npmmirror）' },
              h(Select, { value: draft.song.pypiMirror || 'auto', width: 220, onChange: (v) => setDraft(setPath(draft, 'song.pypiMirror', v)), options: [{ value: 'auto', label: '自动（推荐）' }, { value: 'cn', label: '一直用国内镜像' }, { value: 'off', label: '只用官方源' }] }))),
          h('div', { className: 'ab-flex', style: { marginTop: 12 } },
            h(Btn, { kind: 'primary', small: true, disabled: s.install.running || (draft.song.root || '') !== (st.config.song.root || ''), onClick: async () => { const r = await post('/song/install'); toast(r.message); setTimeout(load, 800) } },
              s.install.running ? h(Fragment, null, h('i', { className: 'ab-spin' }), ' 正在安装…') : Object.values(s.parts).every(Boolean) ? '重新检查 / 修复安装' : '一键安装'),
            h('span', { className: 'ab-muted ab-small' }, (draft.song.root || '') !== (st.config.song.root || '') ? '安装位置改了，先保存设置' : 'Apple 芯片用 MPS 加速（Intel Mac 只能用 CPU，会很慢）' + '；装在 ' + s.root)),
          s.install.running ? h(InstallProgress, { inst: s.install }) : null,
          s.install.ok === true && !s.install.running ? h('div', { className: 'ab-note', style: { marginTop: 8 } }, '✓ ' + s.install.message) : null,
          s.install.log.length ? h('details', { style: { marginTop: 8 } }, h('summary', { className: 'ab-muted ab-small', style: { cursor: 'pointer' } }, '详细日志'),
            h('div', { className: 'ab-logs', style: { maxHeight: 180, marginTop: 6, padding: '8px 12px', whiteSpace: 'pre-wrap' } }, s.install.log.slice(-20).join('\n'))) : null,
          s.install.ok === false && !s.install.running ? h('div', { className: 'ab-note err', style: { marginTop: 8 } },
            h('div', null, s.install.message),
            h('div', { className: 'ab-flex', style: { marginTop: 8 } },
              h(Btn, { small: true, kind: 'primary', onClick: async () => { const r = await post('/song/install'); toast(r.message); setTimeout(load, 800) } }, '再试一次'),
              h(Btn, { small: true, onClick: () => { clipboard(['Aurabot ' + st.version + ' 翻唱安装失败', s.install.message, '', s.install.error || '', '', ...(s.install.log || []).slice(-30)].join('\n')).then(() => toast('报错复制好了，发给作者就行', 'ok'), () => toast('复制失败，展开「详细日志」手动复制吧', 'err')) } }, '复制报错'),
              h('span', { className: 'ab-muted ab-small' }, '已经下好的部分不会重下'))) : null,
        ),
        h(VoiceImport, { s, toast, onChange: load }),
        h(Card, { title: '声音', desc: '用哪个音色唱、默认变调和语音条的长度。' },
          h(Row, { label: '音色' }, voices.length ? h(Select, { value: draft.song.voice || (voices[0] && voices[0].value), options: voices, onChange: (v) => setDraft(setPath(draft, 'song.voice', v)) }) : h('span', { className: 'ab-muted' }, '还没有模型')),
          h(Row, { label: '默认变调', hint: 'ta自己点歌时会按原唱男声 / 女声定，这里是你在面板里试唱时的默认值' }, f.range('song.pitch', -12, 12, 1, (v) => (v > 0 ? '+' : '') + v + ' 半音')),
          h(Row, { label: '先找本地原唱', hint: '点歌时先在本地音乐文件夹里找（文件名「歌名 - 歌手[专辑]」，网易云下载的默认格式），找到就不去网易云下；歌名对上就用' }, f.sw('song.localMusic')),
          draft.song.localMusic !== false ? h(Row, { label: '本地音乐文件夹', hint: '留空 = 用户目录下的「音乐 / Music」，会往下找 3 层' }, f.text('song.localMusicDir', { size: 'wide', placeholder: exPath('Music') })) : null,
          h(Row, { label: '语音条最长', hint: '歌比这个长就截一段' }, f.range('song.maxVoiceSec', 30, 300, 10, (v) => v + ' 秒')),
          h(Row, { label: '截哪一段' }, f.choices('song.clipStart', [{ value: 'auto', label: '副歌附近', desc: '从全曲大约 30% 的地方开始' }, { value: 'head', label: '从头开始' }])),
          h(Row, { label: '人声音量' }, f.range('song.vocalVolume', 0.2, 2, 0.05, (v) => Math.round(v * 100) + '%')),
          h(Row, { label: '伴奏音量' }, f.range('song.instVolume', 0.1, 2, 0.05, (v) => Math.round(v * 100) + '%')),
          h(Row, { label: '只有管理员能点歌' }, f.sw('song.ownerOnly')),
        ),
        h(Card, { fold: 'song-effects', title: '翻唱效果', right: f.sw('song.enhance.enabled'), desc: '换声前后的处理。关掉总开关就是最简单的「整条人声换一遍」。自动定调和音色校正要这个音色有「音色档案」（上面音色列表里生成）。本地接口接管翻唱时，这里的设置不起作用。' },
          draft.song.enhance && draft.song.enhance.enabled !== false ? h(Fragment, null,
            h(Row, { label: '去混响', hint: '分离出的人声先去掉混响、回声再换声；去完反而变噪的段落自动换回原人声' }, f.sw('song.enhance.dereverb')),
            h(Row, { label: '拆主唱和伴唱', hint: '两个人同时唱（和声、合唱）时各自换声再合起来，不容易破音；多花两三分钟' }, f.sw('song.enhance.splitBacking')),
            h(Row, { label: '对唱时分男女声', hint: '点歌说了「对唱」时，先把男声、女声分开各自换，换人处不破音（会先确认真的是男女对唱）' }, f.sw('song.enhance.duetSplit')),
            h(Row, { label: '自动定调、挪八度', hint: '按音色档案里的音域整首挪调（伴奏跟着挪，要装 rubberband），离音域太远的段落（比如对唱里的男声）挪整八度' }, f.sw('song.enhance.autoKey')),
            h(Row, { label: '音色校正', hint: '按音色档案里本人的声音逐首校正频段（换声出来常常发闷）' }, f.sw('song.enhance.toneMatch')),
            h(Row, { label: '伴唱音量跟原来走', hint: '0 = 完全跟原来的音量（背景和声、戏腔原本很轻，换完不会变得和主唱一样响）' }, f.range('song.enhance.backEnvelope', 0, 1, 0.05, (v) => v.toFixed(2)))) : null,
          h(Row, { label: '特征检索比例', hint: '越高越像模型里的音色，太高可能含糊；没有 .index 时不起作用' }, f.range('song.indexRate', 0, 1, 0.05, (v) => v.toFixed(2))),
          h(Row, { label: '音量包络', hint: '0 = 跟原唱的音量起伏，1 = 用换声出来的' }, f.range('song.volumeEnvelope', 0, 1, 0.05, (v) => v.toFixed(2))),
          h(Row, { label: '清辅音保护', hint: '保护「s、sh、呼吸声」不被换得发怪；0.5 = 不保护' }, f.range('song.protect', 0, 0.5, 0.01, (v) => v.toFixed(2))),
        ),
        h(Card, { fold: 'song-netease', title: '网易云音乐', desc: '不登录也能唱免费歌；会员歌、版权歌要填网易云的 Cookie。' },
          h(Row, { label: 'Cookie（MUSIC_U）', hint: '电脑浏览器登录 music.163.com → F12 → 应用 / 存储 → Cookie → 复制 MUSIC_U 的值。只存在本机，不显示' },
            f.text('song.neteaseCookie', { type: 'password', size: 'wide', placeholder: draft.song.neteaseCookieSet ? '已保存（不改就留空）' : '没有就留空' })),
          h('div', { className: 'ab-flex', style: { marginTop: 6 } },
            h(Btn, { small: true, onClick: async () => { const r = await get('/song/account'); setAcct(r) } }, '检查登录'),
            acct ? h('span', { className: 'ab-small', style: { color: acct.ok ? 'var(--ab-ok)' : 'var(--ab-warn)' } }, acct.ok ? '已登录：' + acct.nickname + (acct.vip ? '（会员）' : '（不是会员，只能下免费歌）') : acct.message) : null),
        ),
        h(Card, { title: '试唱', desc: '搜一首歌让ta唱，做好会发到你的 QQ 私聊。' },
          h('div', { className: 'ab-flex' },
            h('input', { className: 'ab-input', style: { flex: '1 1 260px' }, placeholder: '歌名，可以带歌手：小幸运 田馥甄', value: q, onChange: (e) => setQ(e.target.value), onKeyDown: (e) => e.key === 'Enter' && search() }),
            h(Btn, { small: true, onClick: search, disabled: !q.trim() }, '搜索'),
            h('span', { className: 'ab-muted ab-small' }, '变调'),
            h('input', { className: 'ab-input sm', type: 'number', min: -24, max: 24, value: pitch, onChange: (e) => setPitch(Number(e.target.value) || 0) })),
          found === null ? null : found.length === 0 ? h('div', { className: 'ab-muted', style: { marginTop: 8 } }, '没搜到') :
            h('table', { className: 'ab-table', style: { marginTop: 10 } }, h('tbody', null, found.map((x) => h('tr', { key: x.id },
              h('td', null, x.name, x.vip ? h('span', { className: 'ab-badge', style: { marginLeft: 6 } }, '会员') : null),
              h('td', { className: 'ab-muted' }, x.artists),
              h('td', { className: 'ab-muted' }, Math.floor(x.durationSec / 60) + ':' + String(x.durationSec % 60).padStart(2, '0')),
              h('td', null, h(Btn, { small: true, kind: 'primary', disabled: !s.ready || !draft.song.enabled, onClick: () => sing(x) }, '唱给我听')))))),
          !draft.song.enabled ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 8 } }, '先打开上面的「翻唱」开关并保存。') : null,
          s.current ? h('div', { className: 'ab-note', style: { marginTop: 10 } }, h('i', { className: 'ab-spin' }), ' 正在唱「' + s.current.title + '」：' + s.current.stage + (s.queue.length ? '（后面还有 ' + s.queue.length + ' 首）' : '')) : null,
          s.history.length ? h('div', { className: 'ab-list', style: { marginTop: 10 } }, s.history.map((x, i) => h('div', { key: i, className: 'ab-li' },
            h('div', { className: 'meta' }, timeAgo(x.at)),
            h('div', { className: 'body' }, (x.ok ? '✓ ' : '✗ ') + x.title + (x.voice ? ' · ' + x.voice + (x.pitch ? ' ' + (x.pitch > 0 ? '+' : '') + x.pitch : '') : ''), h('div', { className: 'ab-muted ab-small' }, x.message))))) : null,
        ),
      )
    }

/** 本地接口：数据目录 local/ 里的脚本接管语音合成、生图、翻唱换声、语音识别。 */
