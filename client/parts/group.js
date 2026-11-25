    function Group({ draft, setDraft, go }) {
      const f = useField(draft, setDraft)
      const overrides = draft.group.overrides || {}
      const [newGid, setNewGid] = useState('')
      const [secChat, setSecChat] = useState('')
      const [secLog, setSecLog] = useState(null)
      const [secGroupId, setSecGroupId] = useState('')
      const [secGroupProvider, setSecGroupProvider] = useState('')
      const [secGroupModel, setSecGroupModel] = useState('')
      const [secStats, setSecStats] = useState({})
      const loadSecretary = async () => {
        if (!secChat.trim()) { setSecLog([]); setSecStats({}); return }
        const r = await get('/chat/secretary?chatId=' + encodeURIComponent(secChat.trim()))
        setSecLog(r.list || []); setSecStats(r.stats || {})
      }
      return h('div', { className: 'ab-grid' },
        h(Card, { section: 'qq-wake', title: '群聊回应与唤醒词', desc: '被 @、有人引用回复ta的消息、或者提到下面这些名字时，ta一定会回。',
          right: go ? h(Btn, { small: true, kind: 'ghost', onClick: () => go('access', { section: 'qq-host-tools' }) }, '本机工具与发文件 →') : null },
          h(Row, { label: '@ 了别人不算叫ta', hint: '有人 @ 别人时顺口提到ta的名字，不算在叫ta；ta还是可以按平时的频率插话。默认关' }, f.sw('group.ignoreAtOthers')),
          h(Row, { label: '别的叫法', hint: '她的名字和小名自动算（她改名后跟着变）；这里加别的叫法，一行一个' },f.list('group.wakeWords', { placeholder: '一行一个' })),
          h(Row, { label: '每小时必回上限', hint: '一个群里一小时内因被 @、引用、叫名字而必回的次数最多这么多，超过就不回（管理员说话不受限，也不计入）；小时一过自动恢复。0 = 不限' }, f.range('group.mustMaxPerHour', 0, 100, 5, (v) => (v === 0 ? '不限' : v + ' 次'))),
        ),
        h(Card, { fold: 'qq-secretary', title: '群聊秘书闸', right: f.sw('chat.secretary.enabled'), desc: '可选：先用便宜的模型判断这段群聊值不值得叫主模型。默认关；@、引用、叫名字的必回不经过这里。' },
          h(Row, { label: '秘书模型', hint: '填 provider/model；留空用当前聊天模型。建议用便宜的小模型' },
            f.text('chat.secretary.provider', { placeholder: 'provider，如 openai' }),
            f.text('chat.secretary.model', { placeholder: 'model，如 gpt-4o-mini' })),
          h(Row, { label: '最多看几条', hint: '最近这么多条群消息 + 本轮合并内容' }, f.num('chat.secretary.maxRecent', { min: 1, max: 100, step: 1 })),
        ),
        h(Card, { fold: 'qq-secretary-groups', title: '按群秘书覆盖', desc: '只对某个群改秘书模型；没写的群继承上面的全局设置。' },
          Object.keys(draft.chat?.secretary?.groups || {}).length === 0 ? h('div', { className: 'ab-muted ab-small' }, '还没有单独设置。') :
            Object.entries(draft.chat.secretary.groups).map(([gid, v]) => h(Row, { key: gid, label: '群 ' + gid },
              h('span', { className: 'ab-muted' }, `${v.enabled === false ? '关' : '开'} · ${v.provider || '默认'}/${v.model || '默认'}`),
              h(Btn, { small: true, kind: 'ghost', onClick: () => {
                const groups = { ...draft.chat.secretary.groups, [gid]: { ...v, enabled: v.enabled === false } }
                setDraft(setPath(draft, 'chat.secretary.groups', groups))
              } }, v.enabled === false ? '开启' : '关闭'),
              h(Btn, { small: true, kind: 'ghost', onClick: () => {
                const next = { ...draft.chat.secretary.groups }; delete next[gid]
                setDraft(setPath(draft, 'chat.secretary.groups', next))
              } }, '移除'))),
          h('div', { className: 'ab-flex', style: { gap: 6, marginTop: 8 } },
            h('input', { className: 'ab-input sm', placeholder: '群号', value: secGroupId, onChange: (e) => setSecGroupId(e.target.value.replace(/\D/g, '')) }),
            h('input', { className: 'ab-input sm', placeholder: 'provider', value: secGroupProvider, onChange: (e) => setSecGroupProvider(e.target.value) }),
            h('input', { className: 'ab-input sm', placeholder: 'model', value: secGroupModel, onChange: (e) => setSecGroupModel(e.target.value) }),
            h(Btn, { small: true, disabled: !secGroupId, onClick: () => {
              const id = secGroupId.startsWith('qq:') ? secGroupId : 'qq:group:' + secGroupId
              const groups = { ...(draft.chat?.secretary?.groups || {}), [id]: { enabled: true, provider: secGroupProvider, model: secGroupModel } }
              setDraft(setPath(draft, 'chat.secretary.groups', groups))
              setSecGroupId(''); setSecGroupProvider(''); setSecGroupModel('')
            } }, '添加')),
        ),
        h(Card, { fold: 'qq-secretary-log', title: '最近秘书判断', desc: '按会话查看最近 20 次秘书闸结果，排查“为什么没回”。',
          right: h('span', { className: 'ab-flex', style: { gap: 6 } },
            h(Btn, { small: true, kind: 'ghost', onClick: loadSecretary }, '刷新'),
            h(Btn, { small: true, kind: 'ghost', onClick: async () => {
              const r = await get('/chat/secretary/export')
              const blob = new Blob([JSON.stringify(r.stats || {}, null, 2)], { type: 'application/json' })
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'secretary-stats.json'; a.click(); URL.revokeObjectURL(a.href)
            } }, '导出')) },
          h(Row, { label: '会话 ID', hint: '如 qq:group:123456 或 telegram:group:-100…' },
            h('input', { className: 'ab-input wide', value: secChat, placeholder: '渠道:group:群号', onChange: (e) => setSecChat(e.target.value) })),
          secLog === null ? h('div', { className: 'ab-muted ab-small' }, '填会话 ID 后点刷新')
            : secLog.length === 0 ? h('div', { className: 'ab-muted ab-small' }, '还没有记录')
              : h('div', null,
                h('div', { className: 'ab-muted ab-small', style: { marginBottom: 6 } },
                  `累计：放行 ${secStats.allowed || 0}，不接 ${secStats.blocked || 0}；本页最近 ${secLog.length} 次`),
                h('table', { className: 'ab-table' }, h('tbody', null, secLog.slice().reverse().map((x, i) => h('tr', { key: i },
                  h('td', null, new Date(x.at).toLocaleString()), h('td', null, x.allowed ? '放行' : '不接'), h('td', { className: 'ab-muted' }, x.reason))))),
                secStats.days && Object.keys(secStats.days).length ? h('div', { style: { marginTop: 10 } },
                  h('div', { className: 'ab-muted ab-small' }, '按天'),
                  h('table', { className: 'ab-table' }, h('tbody', null, Object.entries(secStats.days).slice(0, 7).map(([day, n]) => h('tr', { key: day },
                    h('td', null, day), h('td', null, `放行 ${n.allowed || 0}`), h('td', null, `不接 ${n.blocked || 0}`)))))) : null,
              ),
        ),
        h(Card, { fold: 'qq-merge', title: '连发合并', right: f.sw('merge.enabled'), desc: '人常常一口气发好几句。打开后ta会等对方说完再一起回，而不是一句一回。' },
          h(Row, { label: '对方停顿多久算说完' }, f.range('merge.waitSec', 0.5, 10, 0.5, (v) => v + ' 秒')),
          h(Row, { label: '最多等多久', hint: '对方一直在发也最多等这么久' }, f.range('merge.maxSec', 2, 30, 1, (v) => v + ' 秒')),
          h(Row, { label: '群里停顿多久算一段', hint: '群里大家你一句我一句，多等一会儿把一段话攒齐再回；ta回上一段的时候，新消息也会先攒着' }, f.range('merge.groupWaitSec', 1, 20, 1, (v) => v + ' 秒')),
          h(Row, { label: '群里最多等多久' }, f.range('merge.groupMaxSec', 3, 60, 1, (v) => v + ' 秒')),
        ),
        h(Card, { fold: 'qq-history', title: '跨群阅读与会话上下文' },
          h(Row, { label: '能不能看别的群', hint: '只读白名单里的群，一次最多 50 条，管理员随时能看。开到「群里也行」后，ta在 A 群的回答全群都看得到，里面可能有不在 B 群的人；读到的内容也会留在这个会话里。' }, f.choices('group.crossRead', [{ value: 'off', label: '关', desc: '只看当前聊天' }, { value: 'private', label: '私聊可以', desc: '管理员，以及私聊里问的人本身在那个群（默认）' }, { value: 'group', label: '群里也行', desc: '再加上群里问的人都在那个群' }])),
          h(Row, { label: '新会话先补看聊天记录', hint: '会话第一次开口时先读最近几条，接得上话。默认关' }, f.sw('chat.seedHistory')),
          h(Row, { label: '给扩展提供近期私聊线索', hint: '默认关闭。开启后，已安装扩展的提示词钩子可收到当前管理员私聊的近期原话，用于授权的历史资料检索。' }, f.sw('chat.shareRecentWithModules')),
        ),
        h(Card, { fold: 'qq-reply-output', title: '回复正文与超时' },
          h(Row, { label: '每段都发', hint: '一轮里她分几段说，就发几条。私聊多半是闲聊，连着说的几句常常各说各的，关着只发最后一段，看起来就像只回了一个话题；干活时前面多是「我先去查」这类过程话，开着会啰嗦。默认关' }, f.sw('chat.everyStep')),
          h(Row, { label: '回复防漏', hint: '过滤明显混进回复的思考和草稿，保留围栏中的代码' }, f.sw('chat.thinkingGuard')),
          h(Row, { label: '严格正文标记', hint: '只发送完整标记内的正文。缺失时尝试重写一次' }, f.sw('chat.replyMarker')),
          h(Row, { label: '话写在思考里也捞出来', hint: '她偶尔把要说的话全写在思考里，正文是空的，这一轮就什么都发不出去。打开后从思考里找她自己定稿的那段，找不到就不发。默认关' }, f.sw('chat.rescueFromThinking')),
          h(Row, { label: '不要说的台词', hint: '一行一条。她整条回复都是这些台词时会改成「嗯」或「啊？」；正常句子里出现不会乱删。' }, f.list('chat.clicheFilters', { placeholder: '一行一条，例如：这句话稳' })),
          h(Row, { label: '一轮最多等多久（分钟）', hint: '模型或工具卡住时，超过这么多分钟就强制放开，后面的消息正常开新一轮；不然会一直哑着。填 0 不兜底。默认 30' }, f.num('chat.turnTimeoutMinutes', { min: 0, max: 180 })),
        ),
        h(TitleFilter, { draft, setDraft }),
        h(Card, { fold: 'qq-brakes', title: '安全刹车', desc: '只防失控（比如和别的机器人聊停不下来）：ta在一个群里短时间说太多就歇一会儿；别人 @ ta、引用 ta、喊 ta 名字或追问 ta 不算主动接话，不会被刹车拦。平时碰不到。' },
          h(Row, { label: '连着接话几次', hint: '她会自己判断该不该停，这里只是兜底：没人叫她时最多连着接几次。0 = 不接话' }, f.range('group.engagedMax', 0, 10, 1, (v) => v + ' 次')),
          h(Row, { label: '最多说几次' }, f.range('group.burstMax', 1, 20, 1, (v) => v + ' 次'), h('span', { className: 'ab-muted' }, '/'), f.range('group.burstWindowSec', 30, 600, 30, (v) => Math.round(v / 6) / 10 + ' 分钟')),
        ),
        h(Card, { fold: 'qq-interject', title: '群聊插话与限制', desc: '没人叫她的时候插不插话由她自己：看她的性格（爱社交那一项）、此刻的心情和精力、群里在聊的和她记得的事、她的爱好有多相关、在场的人和她多亲近；看完群里在聊什么，她也可以决定不说话。睡没睡由她的身体管，不用设静默时段。整体多爱接话、每小时最多几次在「设置 → 社会认知与关系」里调。' },
          h(Row, { label: '冷却', hint: '两次主动插话至少隔多久' }, f.range('group.cooldownSec', 0, 600, 10, (v) => v + ' 秒')),
          h(Row, { label: '群冷清时不插话', hint: '最近几分钟内消息少于这个数就不插' }, f.num('group.minRecentMessages', { min: 0 }), h('span', { className: 'ab-muted' }, '条 / '), f.num('group.activeWindowSec', { min: 30 }), h('span', { className: 'ab-muted' }, '秒')),
          h('div', { className: 'ab-note', style: { marginTop: 8 } }, 'ta被叫到或插上话以后算「加入了话题」：话题还和ta相关、ta 3 分钟内说过话，就会接着聊下去（每次看完群里新说的一段再回），不受冷却限制；话题跑偏或者ta选择不说话就退出。'),
        ),
        h(Card, { fold: 'qq-group-overrides', title: '按群单独设置', desc: '填 0：这个群里她不主动插话（被叫到还是会回）；填 100：这个群每条消息都给她看一眼（说不说还是她自己定，花钱多）。其他数值不起作用——插不插由她自己定。' },
          Object.keys(overrides).length === 0 ? h('div', { className: 'ab-muted', style: { marginBottom: 10 } }, '还没有单独设置的群。') :
            Object.entries(overrides).map(([gid, o]) => h(Row, { key: gid, label: '群 ' + gid },
              h('input', { className: 'ab-input sm', type: 'number', min: 0, max: 100, value: pct(o.interjectChance ?? draft.group.interjectChance), onChange: (e) => setDraft(setPath(draft, 'group.overrides', { ...overrides, [gid]: { ...o, interjectChance: Number(e.target.value) / 100 } })) }),
              h('span', { className: 'ab-muted' }, '% 插话'),
              h(Btn, { small: true, kind: 'ghost', onClick: () => { const n = { ...overrides }; delete n[gid]; setDraft(setPath(draft, 'group.overrides', n)) } }, '移除'))),
          h('div', { className: 'ab-flex' }, h('input', { className: 'ab-input', placeholder: '群号', value: newGid, onChange: (e) => setNewGid(e.target.value.replace(/\D/g, '')) }),
            h(Btn, { small: true, disabled: !newGid, onClick: () => { setDraft(setPath(draft, 'group.overrides', { ...overrides, [newGid]: { interjectChance: draft.group.interjectChance } })); setNewGid('') } }, '添加')),
        ),
      )
    }

    /** 按聊天选模型：私聊默认 / 群聊默认两个下拉，单个 QQ / 群的例外放在默认收起的小列表里。 */
