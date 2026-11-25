    function HostToolPermissions({ draft, setDraft }) {
      const f = useField(draft, setDraft)
      return h(Card, { fold: 'qq-host-tools', title: '本机工具与发文件' },
        h('div', { className: 'ab-grid' },
        h(Card, { title: '发文件', right: f.sw('files.enabled'), desc: '打开后，你可以让ta把本机文件发到 QQ：图片会直接显示成图，其它当文件发。私聊里随时能发，群里只在你自己开口那一轮能发；也能按你说的发给白名单里的人或群。ta只能发 QQ 工作区和下面目录里的文件；单个文件有大小上限；发过什么会记在日志里。' },
          h(Row, { label: '单个文件最大' }, f.num('files.maxMB', { min: 1, max: 2048 }), h('span', { className: 'ab-muted' }, ' MB')),
          h(Row, { label: '额外允许的目录', hint: '一行一个完整路径。QQ 工作区里的文件一直允许，不用写；留空 = 只能发工作区里的' }, f.list('files.dirs', { placeholder: exPath('Desktop') })),
          h(Row, { label: '图片和文件按路径直发', hint: '网关和插件在同一台机器或共享挂载时，直接把路径交给网关，省掉读盘和 base64 膨胀。Mac 上网关在 Docker / OrbStack 里读不到本机路径，默认关，建议保持关；关着时图片和文件都直接走 base64 / 下载口。' }, f.sw('files.imageByPath')),
          h(Row, { label: '大文件下载口', hint: '网关跑在 Docker / 虚拟机里看不到本机文件时，超过 30 MB 的文件会临时开一个只对本机开放的下载地址让网关来取（随机口令，15 分钟作废）。关掉后这种情况下大文件发不出去' }, f.sw('files.relay')),
          draft.files.relay !== false ? h(Row, { label: '网关访问本机用的地址', hint: 'OrbStack、Docker Desktop 都是 host.docker.internal；网关在别的电脑上时这招不管用' }, f.text('files.relayHost', { placeholder: 'host.docker.internal' })) : null,
        ),
        h(Card, { title: '群里的本机工具', right: f.choices('group.ownerTools', [{ value: 'off', label: '谁都不行' }, { value: 'owner', label: '只有管理员' }]),
          desc: '默认关：群里ta只能聊天，没有任何电脑操作能力。「只有管理员」＝管理员在群里说话的那一轮ta才拿得到命令和文件工具，别人说话时照旧收走。没有「谁问都行」这一档：群里任何人都能远程驱动这台机器，权限面太大。',
          ...(draft.group.ownerTools && draft.group.ownerTools !== 'off' ? [
            h(Row, { label: '只在这些群生效', hint: '一行一个群号；留空 = 白名单里所有群都生效' }, f.list('group.ownerToolsGroups', { placeholder: '100200300' })),
          ] : []),
        }),
        h(Card, { title: '工具与任务' },
          h(Row, { label: 'QQ 接口', hint: '让她用 QQ 的其他能力：别人只能查当前群的公告、精华这些；撤回、设精华、改群名片等只听你的。取 Cookie、发原始包、删好友、退群这些不开放。' }, f.sw('qqApi.enabled')),
          h(Row, { label: '长任务模式', hint: '只在「完整」权限下生效。打开后ta能把命令放到后台跑、跑完自动回来告诉你，也能设定时任务；工具多一点，回话会稍慢。切换后同样换新会话。' },
            h(Choices, { value: draft.longTasks ? 'on' : 'off', onChange: (v) => setDraft(setPath(draft, 'longTasks', v === 'on')), options: [
              { value: 'off', label: '关', desc: '工具少一点，回话快一点' },
              { value: 'on', label: '开', desc: '干长活时能接着聊（默认）' },
            ] })),
          h(Row, { label: '后台子智能体', hint: '默认关。关着时只有你本人最近 5 分钟内说过话，模块才被允许派子智能体（拿本机命令/文件能力干活动）；打开后，定时任务这类没人应答的后台流程也能派——等于把这份能力也交给后台。' },
            h(Choices, { value: draft.subagentBackground ? 'on' : 'off', onChange: (v) => setDraft(setPath(draft, 'subagentBackground', v === 'on')), options: [
              { value: 'off', label: '关', desc: '后台任务不派子智能体（默认）' },
              { value: 'on', label: '开', desc: '后台任务也可以派子智能体' },
            ] })),
        )))
    }

    /** 内置 QQ 资料和名单操作仍须由管理员亲口发起。 */
