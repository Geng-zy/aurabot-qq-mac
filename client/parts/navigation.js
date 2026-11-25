    const NAV_GROUPS = [
      { id: 'home', label: '概览', icon: 'home', pages: [
        { id: 'overview', label: '概览', search: '首页 状态 接收能力 转发 视频 用量 费用' },
      ] },
      { id: 'mind', label: '心智', icon: 'mind', pages: [
        { id: 'now', label: '她现在', search: '心情 情绪 精力 困 饿 投喂 睡觉 叫醒 身体' },
        { id: 'mood', label: '记忆', search: '梦 遗忘 隐私 私聊 保密 跨会话 分享 向量' },
        { id: 'knowledge', label: '知识库', search: '资料 笔记 Markdown 知识 scope 文件' },
        { id: 'persona', label: '关系', search: '人物 亲近 信任 喜欢 亲密 激情 承诺 老梗 群 关系星图' },
        { id: 'inner', label: '念头与行动', search: '内心 念头 日记 欲望 动力 犯懒 主动找 权限 申请 本地小模型' },
      ] },
      { id: 'identity', label: '自我与设置', icon: 'memory', pages: [
        { id: 'selfmind', label: '人格与自我', search: '人格卡 人设 头像 名字 小名 性格 特质 本来的样子 习惯 版本 退回 自我故事 价值观 爱好 影子模式' },
        { id: 'mindsettings', label: '设置', search: '参数 记性 遗忘 改写 情绪 后台预算 时区 年龄 生日 本地小模型 一键安装' },
      ] },
      { id: 'platforms', label: '平台', icon: 'puzzle', pages: [
        { id: 'platforms', label: '平台连接', search: 'QQ Telegram 飞书 Discord 多平台 适配器 状态 能力' },
      ] },
      { id: 'qq', label: 'QQ 会话', icon: 'chat', pages: [
        { id: 'connect', label: '连接', search: 'QQ 网关 SnowLuma OneBot 登录 工作区 自测 重置' },
        { id: 'access', label: '白名单与权限', search: '管理员 群管 改资料 QQ 命令 好友申请 生图白名单' },
        { id: 'group', label: '回复规则', search: '群聊 私聊 插话 连发 合并 转发' },
        { id: 'model', label: '聊天模型', search: 'AI 大模型 视觉 看图 图片 思考强度' },
        { id: 'asr', label: '语音识别', modules: ['voice'], search: '听语音 转文字 ASR' },
        { id: 'diary', label: 'QQ 空间', modules: ['diary', 'qzone-social'], search: '空间日记 说说 空间互动' },
      ] },
      { id: 'media', label: '表达与创作', icon: 'sparkles', pages: [
        { id: 'voice', label: '语音合成', modules: ['voice'], search: 'TTS 说话 音色 Edge Breeze' },
        { id: 'stickers', label: '表情包', modules: ['stickers'], search: '小黄脸 GIF 商城表情 贴表情' },
        { id: 'imagegen', label: '生图', modules: ['imagegen'], search: '画图 图片 Codex 图库 自拍' },
        { id: 'song', label: '翻唱', modules: ['song'], search: '唱歌 RVC 点歌' },
        { id: 'video', label: '生视频', modules: ['video'], search: 'ComfyUI 本地脚本 视频生成' },
      ] },
      { id: 'system', label: '系统', icon: 'settings', pages: [
        { id: 'logs', label: '日志', search: '诊断 报错' },
        { id: 'backup', label: '备份与恢复', search: '换电脑 迁移 导入 导出 WebDAV Gitee' },
        { id: 'security', label: '安全防护', search: 'SSRF 内网 图片下载 更新' },
        { id: 'browser', label: '浏览器', search: '侧边栏 Ego 共享 独立窗口' },
        { id: 'local', label: '本地接口', search: '脚本 FFmpeg SD SoVITS ComfyUI' },
        { id: 'about', label: '关于', search: '版本 许可 鸣谢 开源' },
      ] },
      { id: 'extensions', label: '扩展', icon: 'puzzle', pages: [
        { id: 'modules', label: '模块管理', search: '扩展 已安装 内置 自己写 模板 安全模式' },
        { id: 'market', label: '模块库', search: '插件 社区 下载 安装 外部模块 空间互动' },
      ] },
    ]
    const TABS = NAV_GROUPS.flatMap((group) => group.pages.map((page) => ({ ...page, group: group.id })))
    const FIND_SECTIONS = {
      platforms: [['platforms-status', '平台状态', 'QQ Telegram 飞书 适配器 能力 连接']],
      overview: [['overview-logs', '最近日志', '近期报错 运行状态']],
      connect: [['qq-workspace', '工作区与会话维护', '归档 重开 重置 搬家 目录 所有会话'], ['qq-endpoint', 'QQ 网关配置', 'WebSocket HTTP 令牌 OneBot 机器人号']],
      access: [
        ['qq-allowlist', '私聊与群白名单', '加好友 接待 谁可以聊天 群号 QQ 号'],
        ['qq-draw-allow', '生图白名单', '画图权限 会话生图 谁能请求画图'],
        ['qq-owner', '管理员与私聊权限', '管理员 QQ号 给她自由 完整 受限 纯聊天 称呼'],
        ['qq-notices', 'DSH 授权与通知', '审批 批准 提问 工作区'],
        ['qq-host-tools', '本机工具与发文件', '群里的本机工具 终端 文件 下载口 长任务 子智能体'],
        ['qq-profile', '改资料与名单', '头像 昵称 签名 好友申请 改白名单 外部模块权限'],
        ['qq-group-admin', '群管权限', '禁言 公告 踢人 群主 头衔'],
        ['qq-commands', 'QQ 命令', '斜杠 命令列表'],
      ],
      group: [
        ['qq-wake', '群聊回应与唤醒词', '群聊必回 群里必回 引用 艾特 @ 别名 叫法 接话'],
        ['qq-secretary', '群聊秘书闸', '便宜模型 判断 接话 主模型'],
        ['qq-merge', '连发合并', '多条消息 等待 攒消息'],
        ['qq-history', '跨群阅读与会话上下文', '跨群 看别的群 历史 接上聊天 扩展线索'],
        ['qq-reply-output', '回复正文与超时', '思考 内心 外泄 回复防漏 严格正文 每段都发 回合时限'],
        ['qq-interject', '群聊插话与限制', '主动接话 插嘴 频率 冷却 群限制'],
        ['qq-brakes', '安全刹车', '限速 互聊 防刷屏'],
        ['qq-group-overrides', '按群单独设置', '单独一个群 主动插话'],
        ['qq-title-filter', '按头衔不理', '机器人互聊 过滤 专属头衔'],
      ],
      model: [['qq-chat-models', '按会话选模型', '默认 私聊模型 群模型 单独切换 思考强度'], ['qq-model-speed', '模型列表与测速', '延迟 测试 可用模型']],
      now: [['mind-feelings', '此刻的感受', '当前情绪 心情 感受']],
      mood: [['knowledge-files', '知识库', '资料 笔记 Markdown 知识'], ['memory-entries', '她记得的事', '经历 搜索记忆 记忆列表'], ['memory-privacy', '私聊隐私', '跨会话 片段 保护 保密 共享'], ['memory-vectors', '向量检索与精排', 'embedding BGE-M3 rerank 向量重算 相似 本地 离线'], ['memory-chat-log', '聊天流水保留', '原话 保存几天 流水'], ['memory-dreams', '最近的梦', '做梦 睡眠 整理']],
      inner: [['mind-journal', '内心日记', '念头记录 深想记录'], ['mind-wants', '她想要的', '愿望 基本需要 帮她放下'], ['mind-actions', '能做的事', '待行动 动力 主动行为'], ['mind-outreach', '主动找你', '主动联系 搭话 勿扰'], ['mind-grants', '权限申请', '批准 收回 授权']],
      selfmind: [['self-persona', '人格卡与头像', '人设 头像 名字 小名 人格卡'], ['self-versions', '人格卡的版本', '回滚 还原 退回 人格历史'], ['self-traits', '性格（19 项）', '大五 气质 基线 影子模式'], ['self-versions-manage', '版本对比与清理', '删除 清理 对比 版本']],
      mindsettings: [['mind-local-model', '本地小模型', '一键安装 本地念头 MLX Python']],
      diary: [['diary-write', '现在写日记', '立即发布 私密日记 写一篇'], ['diary-history', '日记发布历史', '写过的日记 说说 记录'], ['diary-rich', '图文日记与预览', '预览 配图 日记图片'], ['diary-archive', '按日期归档浏览图', '归档 图片目录'], ['diary-social', '空间互动', '说说 点赞 评论 回复 好友空间']],
      voice: [['voice-rvc', '语音条变声', 'RVC 说话音色 翻唱音色 语音克隆']],
      imagegen: [['image-fallbacks', '备用生图服务', '降级 后备'], ['image-appearance', '她的形象', '自拍 参考图 形象描述'], ['image-library', '她的画作', '图库 历史图片']],
      song: [['song-effects', '翻唱效果', '混音 伴唱 人声 特征检索'], ['song-netease', '网易云音乐', 'Cookie MUSIC_U 登录 版权']],
      security: [['security-remote', '远端管理', '反代 可信代理 主机名 外部访问'], ['security-download', 'SSRF 防护', '内网 下载 安全策略']],
      backup: [['backup-cloud', '云备份', 'WebDAV Gitee 自动 定时'], ['backup-restore', '从备份恢复', '导入 换电脑 还原']],
      modules: [['modules-simulate', '模拟测试', '扩展模块 接线 工具调试'], ['modules-create', '新建一个模块', '自定义 模板 插件']],
    }
    const modOn = (st, id) => (st.modules || []).some((m) => m.id === id && m.running)
    const visibleTabs = (st) => TABS.filter((tab) => !tab.modules || tab.modules.some((id) => modOn(st, id)))
    const ICONS = {
      home: 'M3 10.5 12 3l9 7.5M5.5 9v11.5h13V9M10 20.5v-6h4v6',
      mind: 'M12 12.5a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5zM4.5 20.5c.9-3.6 3.9-5.5 7.5-5.5s6.6 1.9 7.5 5.5',
      chat: 'M20.5 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-4.4A8 8 0 1 1 20.5 11.5zM9 11.5h6',
      sparkles: 'M12 2.5 14.4 9.6 21.5 12l-7.1 2.4L12 21.5l-2.4-7.1L2.5 12l7.1-2.4zM19 3v4m-2-2h4',
      settings: 'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M15 5v4M9 10v4M17 15v4',
      puzzle: 'M4 4h6.5v2a1.5 1.5 0 0 0 3 0V4H20v6.5h-2a1.5 1.5 0 0 0 0 3h2V20h-6.5v-2a1.5 1.5 0 0 0-3 0v2H4v-6.5h2a1.5 1.5 0 0 0 0-3H4Z',
      find: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-5-5',
      next: 'M5 12h14m-6-6 6 6-6 6',
      chevron: 'm7 10 5 5 5-5',
      close: 'm6 6 12 12M18 6 6 18',
      image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9h.01',
      mic: 'M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6',
      forward: 'M4 5h16v12H9l-5 3zM8 9h8M8 13h5',
      video: 'M4 5h16v14H4zM10 9l5 3-5 3z',
      lock: 'M5 10h14v10H5zm3 0V7a4 4 0 0 1 8 0v3m-4 4v2',
      memory: 'M5 4h11a3 3 0 0 1 3 3v13H6a2 2 0 0 1 0-4h13M5 18V6a2 2 0 0 1 2-2m2 5h6',
      pulse: 'M3 12h5l2.5-6 3 12 2.5-6H21',
      bolt: 'M13.5 2.5 5 14h6l-.5 7.5L19 10h-6z',
      moon: 'M20.4 15.3A8.8 8.8 0 0 1 8.7 3.6 9 9 0 1 0 20.4 15.3z',
      meal: 'M4 11h16a8 8 0 0 1-16 0zm4 8h8M9 8V4m6 4V3',
    }
    // 有 DSH primitives 时优先用宿主图标；没有对应图标或没有 primitives 时保留自己的 SVG。
    const ICON_COMPONENTS = {
      mind: 'IconThinkOutlineRegular',
      sparkles: 'IconSparkleRegular',
      settings: 'IconSettingsOutlineRegular',
      puzzle: 'IconPluginPinwheelOutlineRegular',
      find: 'IconSearchOutlineRegular',
      next: 'IconChevronRightOutlineRegular',
      chevron: 'IconChevronDownOutlineRegular',
      close: 'IconCloseOutlineRegular',
      mic: 'IconMicrophoneOutlineRegular',
      video: 'IconPlayOutlineRegular',
      lock: 'IconShieldOutlineRegular',
      memory: 'IconDatabaseOutlineRegular',
      pulse: 'IconGaugeOutlineRegular',
      bolt: 'IconEnhanceOutlineRegular',
      moon: 'IconDarkOutlineRegular',
    }
    const navIcon = (name) => {
      const p = primitives()
      const component = ICON_COMPONENTS[name] && p?.[ICON_COMPONENTS[name]]
      if (typeof component === 'function') return h(component, { className: 'ab-icon' })
      return h('svg', { className: 'ab-icon', viewBox: '0 0 24 24', 'aria-hidden': true }, h('path', { d: ICONS[name] || name }))
    }

    const unsavedDot = () => h('i', { className: 'ab-unsaved-dot', title: '有未保存的设置' })
    const pageNavId = (group, rail) => (rail ? 'ab-rail-pages-' : 'ab-stage-pages-') + group.id

