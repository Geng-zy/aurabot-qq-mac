// 插件配置的默认值表（纯数据，不读写文件）。
//
// 从 config.js 搬出来的原因：它是 252 行常量、被 normalize 和面板默认值共用；
// 和「读盘/归一化/写盘」放一个文件时，改默认值要在一千行里找，评审也看不出改了哪一段。
//
// 改这里的值 = 改所有新安装的行为；老配置缺的键会按这里补（见 config-normalize.js）。

import { DEFAULT_GROUP_POLICY } from '../chat/group-policy.js'

export const DEFAULTS = {
  enabled: false, // 总开关：关着一句都不发
  dryRun: true, // 试运行：只记日志不真发（记忆照写）
  debug: false, // 调试：不真发 + 什么都不写进记忆/流水，只在日志里看（和试运行互斥）
  setupDone: false, // 首次使用向导走完了没有
  communityMigrated: {}, // 旧版模块搬家记录（目前没有搬家模块，保留兼容）
  botQQ: '', // 机器人 QQ 号（向导里填）
  ownerQQ: '', // 管理员 QQ 号（向导里填）
  ownerName: '管理员',
  ownerLevel: 'full', // full | social | chat
  approvalNotify: true, // DSH 要授权时把请求发到管理员私聊
  // 给她自由：她自己的事由她决定，不用管理员开口、也不用申请（见 chat/access.js 的 freeWill）
  freedom: true,
  // 什么情况往管理员 QQ 上报（她用自己的话说）：enabled 是总开关，approval = 工具要授权，question = 要人选选项。
  // workspaces 按工作区单独覆盖：{ "<工作区路径>": { approval?: bool, question?: bool } }，没写的项跟随总开关（移植自原项目 354160e）
  notice: { enabled: true, approval: true, question: true, workspaces: {} },
  qqApi: { enabled: true }, // 她能用 qq_api_call 调 QQ 接口：别人只能查当前群，写操作只听管理员
  approvalViaQQ: true, // 管理员私聊会话要授权时，在 QQ 回复「确认」直接批准这一次
  profilePerms: { qqNickname: 'owner', qqSignature: 'owner', qqAvatar: 'owner', qqFriendRequest: 'owner', whitelist: 'owner' }, // 改资料/好友申请/白名单的权限：off 关 / owner 仅管理员私聊 / all 所有人
  // 宿主维护插件（dsh-purge 等）追加提示词时，在 QQ 会话里给大肥鱼人设加身份锁定。
  // 关掉后维护段原样进入提示词，身份与语气由模型自己权衡。
  purge: { identityLock: true },
  longTasks: true, // 长任务模式：管理员私聊（完整权限）额外挂 dsh-tool-jobs + dsh-tool-schedule，会多一点工具定义、稍慢
  // 后台子智能体委派（默认关）：模块用 hub.runSubagentTurn 派子智能体时，正常要求「管理员开口」的来源；
  // 定时任务这类没人应答的场合，只有打开这个开关才允许派活。关着 = 一律拒绝（一审 #177 的审批策略）。
  subagentBackground: false,
  allow: { private: [], groups: [] }, // 管理员永远能私聊，不用写进白名单
  drawAllow: { private: [], groups: [] }, // 额外开放生图的 QQ 会话
  // 接 QQ：macOS 上没有 SnowLuma 原生版，网关是你自己跑的 OneBot v11（比如 OrbStack 里的 SnowLuma），
  // 插件只按下面 snowluma.httpUrl / wsUrl / token 去连，不启动、不注入任何东西
  gateway: 'onebot',
  workspaceDir: '', // QQ 会话放在哪个文件夹（DSH 里的「Aurabot · QQ」工作区）；留空 = 默认（~/Aurabot/qq-chats）
  // 发文件（#52）：默认开但限制很多——她只能把 QQ 工作区（workspaceDir）和 dirs 里列的目录中的文件当文件发出去；
  // 单个文件有大小上限；管理员私聊里能触发，群里只在管理员开口那一轮能触发（可以发给白名单里的人和群）。日志里会记下发了什么。
  // imageByPath（#169）：本地图片先按路径直发，被网关明确拒绝才改用 base64；网关和 NapCat 没共享挂载时会自动回退。
  // 默认关：macOS 上网关跑在 Docker / OrbStack 里，读不到本机路径，按路径发必定失败（慢一拍，结果不确定时还会丢图）。
  // 关着时发文件也不先按路径试（hub.js sendFile）。
  // relay：网关看不到本机路径（Docker / 虚拟机）且文件超过 base64 能塞的大小时，临时开一个只对本机开放的下载口让网关来取；
  // relayHost 是网关那边访问宿主机用的地址（OrbStack / Docker Desktop 都是 host.docker.internal）
  files: { enabled: true, maxMB: 50, imageByPath: false, dirs: [], relay: true, relayHost: 'host.docker.internal' },
  // 危险命令确认（可选保护，默认关）：她在私聊里执行删根目录/格式化/关机/下载后直接执行等
  // 终端命令前，先发 QQ 私聊问管理员，回复「确认」才执行；超时或「取消」就拦下。
  // panelRemoteAccess：允许远端（非回环）访问管理接口；默认 false = 只有本机能管。
  // trustedProxy：可信反向代理地址（逗号分隔）；只有请求确实从这些地址进来，才采信
  //   X-Forwarded-For 的最后一跳作为真实来源。留空 = 从不相信任何转发头（最安全）。
  // publicHostname：面板经反代对外时的域名（如 panel.example.com）；CSRF 同源校验把
  //   这个域名的 Origin 也算同源。留空 = 只有回环 Origin 算同源。
  security: { dangerConfirm: false, ssrfMode: 'strict', panelRemoteAccess: false, trustedProxy: '', publicHostname: '' },
  // 浏览器（全局）：useDshSidebar = 需要浏览器的外部模块（网页、平台验证等）
  // 连 DSH 侧边浏览器的共享实例（ego，画面在 DSH 右侧实时可见），不为每个模块各开一个独立窗口。
  browser: { useDshSidebar: false },
  // DeepSeek 峰谷省钱模式（默认关，现有行为不变）：打开后只把「不着急的后台模型调用」尽量挪到谷时，
  // 聊天回复/工具/审批/定时任务本身不变。offPeakHolidays 是中国法定节假日（北京时间日期 'YYYY-MM-DD'）。
  cost: { offPeak: false, offPeakHolidays: [] },
  snowluma: {
    // 你的 OneBot v11 网关（名字沿用 snowluma，老配置直接能用）
    httpUrl: '', // 可选；不填就都走 WebSocket
    wsUrl: '', // 必填：正向 WebSocket，收消息靠它
    httpToken: '',
    wsToken: '',
  },
  // 多平台配置的起点。QQ 的旧字段仍保留在 snowluma，normalize 时两边会同步。
  platforms: { qq: { label: 'QQ', enabled: true, httpUrl: '', wsUrl: '', httpToken: '', wsToken: '', drawAllow: { private: [], groups: [] } }, telegram: { label: 'Telegram', enabled: false, token: '', apiBase: 'https://api.telegram.org', ownerQQ: '', allow: { private: [], groups: [] } } },
  model: { provider: '', model: '', reasoningEffort: 'low', vision: 'auto' }, // 留空 = 跟随 DSH 默认；vision: auto/on/off
  // 按聊天选模型（管理员在面板「模型」页设）：私聊 QQ 号 > 群号 > 所有私聊 / 所有群默认 > 上面的全局模型；没写的一级退到下一级
  chatModels: { privateDefault: { provider: '', model: '', reasoningEffort: '' }, groupDefault: { provider: '', model: '', reasoningEffort: '' }, privates: {}, groups: {} },
  merge: { enabled: true, waitSec: 2.5, maxSec: 8, groupWaitSec: 5, groupMaxSec: 15 }, // 连发合并：对方停顿 waitSec 秒再一起回，最多等 maxSec 秒；群里等得久一点，把一段话攒齐
  imageGen: {
    enabled: false,
    provider: 'openai', // openai / seedream / xai / gemini / custom / codex / local
    localSteps: 20,
    baseUrl: '',
    apiKey: '',
    model: '',
    fallbackEnabled: false,
    fallbacks: [],
    size: '1024x1024',
    shape: 'her', // 工具可选构图；her 时未指定就沿用 size
    stylePrompt: '', // 每次生图自动加在前面的风格描述
    seeOwn: true, // 「让她画完自己看一眼」：开着才把画好的图交给她看
    img2img: true, // 允许参考聊天图片 / 自己的画作来改画
    galleryShown: 20, // 面板「她的画作」显示最近几张（1~50；只影响显示，不删文件）
    // 自定义接法：url 里可以用 {prompt} {model} {size} {width} {height} {image}（参考图 base64）；params 是参数名/值（值里也能用这些占位符）
    custom: { method: 'GET', url: '', bodyType: 'json', responsePath: '', params: [] },
    // 实验性订阅接法；登录令牌独立保存在数据目录，不进入配置。
    codex: { model: 'gpt-image-2', quality: 'auto', background: 'auto' },
    // ComfyUI 直连：workflow 是 API 格式的 JSON；用 __PROMPT__/__IMAGE__ 占位，或指定节点。
    comfy: { baseUrl: 'http://127.0.0.1:8188', workflow: '', promptNode: '', imageNode: '', outputNode: '', pollMs: 1000 },
  },
  persona: { current: 'dafeiyu' },
  // 管理员私聊里问起群里的事：把最近 24 小时的群聊流水补进这一轮（默认关，开启前先把群加进白名单）
  group: { ...DEFAULT_GROUP_POLICY, overrides: {}, ownerTools: 'off', ownerToolsGroups: [] },
  // 按群头衔不回：勾选的群里，专属头衔正好是 title 的成员（一般是别的机器人）说话、戳她都不理。没勾群就不起作用
  titleFilter: { enabled: true, groups: [], title: '大肥鱼' },
  voice: {
    enabled: true,
    // auto = 先 edge-tts，不行用 macOS 自带语音；edge / system / cosyvoice / gptsovits / http / breeze = 指定引擎（失败都会退回 macOS 自带语音）
    engine: 'auto',
    cosyvoice: { url: 'http://127.0.0.1:50000', mode: 'sft', spkId: '中文女', instruct: '', sampleRate: 22050 },
    gptsovits: { url: 'http://127.0.0.1:9880', refAudio: '', promptText: '', promptLang: 'zh', textLang: 'zh' },
    // 通用 HTTP 引擎：GET 时地址里带 {text}；POST 时填接口地址，请求头一行一个，请求体里 {text} 自动替换（已做 JSON 转义）
    http: { urlTemplate: '', method: 'GET', headers: '', body: '', sampleRate: 24000 },
    // Breeze 语音：cloud 走 BreezeBlue（`POST {url}/v1/text-to-speech/{音色id}` + xi-api-key），
    // local 走本机自建 breeze_infer（`POST {url}/v1/audio/speech` 的 multipart 表单）；语气写在 instructions 里（中文）。
    breeze: {
      mode: 'cloud',
      url: 'https://api.breeze.blue',
      // 站点：登录 / 领每日额度走这里（跟合成接口不是同一个域名）
      siteUrl: 'https://breezeblue.ai',
      key: '',
      // 云端额度：填了邮箱密码 + 打开自动领取，就每小时醒一次去领（一天最多一次）
      email: '',
      password: '',
      autoClaim: true,
      voiceId: '',
      model: 'breeze-tts-2',
      languageCode: 'zh',
      instructions: '',
      outputFormat: 'mp3_24000_128',
      guidanceScale: 0,
      timeoutMs: 60000,
    },
    voice: 'zh-CN-XiaoyiNeural',
    rate: '+0%',
    pitch: '+0Hz',
    autoChance: 0.15, // 短回复自动变语音的概率
    autoMaxChars: 80,
    asr: true, // 听语音
    asrApi: { provider: '', baseUrl: '', model: '', apiKey: '', language: '', prefer: 'qq' },
    emojiSeparate: true, // 语音条里的表情/emoji 不念出来，单独补一条文字发出去
    // 语音条变声：用翻唱里导入的 RVC 音色模型（先 TTS 念，再变声）。留空 = 不变声
    songVoice: '',
    songPitch: 0, // 变调半音：男声模型转女声一般 +12
  },
  stickers: {
    enabled: true,
    faces: true, // 回复里能夹 QQ 自带的小黄脸（<face:名字>）
    autoChance: 0.35, // 文字回复自动配一张表情的概率
    // 主动给对方的原消息贴 QQ 表情：这是新行为，默认关；开了之后按自己的概率算，
    // 不从 autoChance 取值（两者是不同动作，隐式联动会让升级后的人莫名其妙被贴表情，#216 review）
    react: false, // 主动贴表情总开关，默认关
    reactChance: 0.15, // 主动贴表情的概率，独立默认值
    reactMaxPerHour: 10, // 每个会话每小时最多主动贴几次
    collect: true, // 偷表情
    // 怎么偷：auto = 看到就收（默认，保持原行为）；ask = 她挑（先记着，喜欢才凭编号收）；owner = 只听管理员的（只有管理员语境下才提示/允许收）
    collectMode: 'auto',
    fromGroups: true,
    fromPrivate: true,
    maxPerHour: 20,
    maxLibrary: 300, // 表情库最多存多少张（QQ 收藏表情有上限），超了就清掉最少用的
    caption: true, // 用视觉模型起备注
    webp: false, // 表情入库时统一转 WebP（GIF 保留原格式，需要 sharp）
    // 起名单独挑的模型：{ provider, model }；留空 = 跟随聊天用的模型
    captionModel: { provider: '', model: '' },
  },
  diary: {
    enabled: true,
    timesPerDay: 2,
    windowStart: '10:00',
    windowEnd: '23:30',
    minGapMinutes: 180,
    attachImage: true, // 写日记时配一张图（优先今天她画的，其次今天收的表情包）
    // 可选图文日记：关着时沿用原来的聊天摘录和配图流程；本地目录必须由管理员填写。
    rich: { enabled: false, stickers: false, browsing: false, local: false, folder: '', maxImages: 2 },
    archive: { enabled: false, folder: '' }, // 已有公开浏览图按浏览日期归档；必须由管理员指定输出目录
    minChars: 60,
    maxChars: 140,
    visibility: 'all', // all | friends | selected | self | excluded，和 QQ 空间自身的可见范围一致
    audienceQQs: '', // selected / excluded 时可见（或不可见）的好友 QQ 号，换行或逗号分隔
  },
  // 本地接口：数据目录 local/ 里的脚本接管这几项（文件要在、开关要开）
  local: { tts: false, image: false, song: false, asr: false, video: false, videoTimeoutMin: 20, ffmpegPath: '', hashes: {} },
  qzoneSocial: {
    enabled: true,
    replyOwn: true, // 回复自己说说下别人的新评论
    commentFriends: true, // 逛好友动态，偶尔评论
    friendChance: 0.3, // 看到一条好友说说时互动（点赞 + 可能评论）的概率
    ownerChance: 0.7, // 管理员的说说互动概率
    like: true, // 互动时顺手点赞
    maxPerDay: 8, // 每天最多评论几条（点赞不算）
    intervalMin: 30, // 多久逛一次空间
  },
  // seedHistory：新会话第一次说话时先补最近几条历史（默认关）
  // everyStep：一轮里她分几段说就发几条（默认关 = 只发最后一段）
  // rescueFromThinking：整轮一段正文都没写时，从思考里捞出她自己定稿的那段（默认关，捞不到就不发）
  // turnTimeoutMinutes：一轮跑超过这么多分钟就强制放开（模型 / 工具卡死时私聊会一直不理人）；0 = 不兜底
  chat: { seedHistory: false, seedHistoryCount: 20, everyStep: false, rescueFromThinking: false, thinkingGuard: true, replyMarker: false, shareRecentWithModules: false, turnTimeoutMinutes: 30, clicheFilters: [], secretary: { enabled: false, provider: '', model: '', maxRecent: 20, groups: {} } },
  // 聊天流水 chatlog/ 留多久（记忆本身在心智核心里）
  memory: { keepChatlogDays: 7, keepChatlogSet: false },
  song: {
    enabled: false,
    root: '', // 翻唱环境目录，留空 = ~/Aurabot/rvc
    voice: '', // 用哪个音色（models 目录里的 .pth 文件名），留空 = 第一个
    pitch: 0, // 默认变调（半音）；她点歌时会按原唱是男声还是女声自己定
    neteaseCookie: '', // 网易云 Cookie（MUSIC_U），下会员歌用
    separatorModel: 'bs_leap_xe_voc.ckpt', // 人声分离模型（默认 Leap Xe，Apple 芯片上实测跑通的组合）
    maxVoiceSec: 120, // 语音条最长多少秒，歌更长就截一段
    clipStart: 'auto', // auto = 从副歌附近截；head = 从头截
    vocalVolume: 1,
    instVolume: 0.8,
    ownerOnly: true, // 只有管理员能点歌
    keepWork: false, // 留着中间文件（调试用）
    pypiMirror: 'auto', // 安装时用的下载源：auto = 先测一下，官方源慢就用国内镜像；cn = 一直用国内镜像；off = 只用官方源
    localMusic: true, // 点歌先在本地音乐文件夹里找原唱（文件名「歌名 - 歌手[专辑]」），找不到再去网易云
    localMusicDir: '', // 本地音乐文件夹，留空 = 用户目录下的「音乐 / Music」
    // 换声参数（Applio）：特征检索比例、音量包络（主唱）、清辅音保护
    indexRate: 0.3,
    volumeEnvelope: 0.5,
    protect: 0.33,
    // 翻唱增强流程（src/song/pipeline.js）：去混响、拆主唱伴唱 / 男女声、自动定调和挪八度、音色校正。后两项要音色档案
    enhance: { enabled: true, dereverb: true, splitBacking: true, duetSplit: true, autoKey: true, toneMatch: true, backEnvelope: 0 },
  },
  // 云备份：每天到点自动打包并把最新备份推到 Gitee 私有仓库（走本机 git）或 WebDAV
  backup: {
    remote: {
      enabled: false, // 到点自动「打包 + 推送」；关了就只剩面板手动推
      provider: 'gitee', // gitee | webdav
      // WebDAV：填服务器地址（自动建 aurabot-backups），密码按密钥处理
      webdav: { url: '', username: '', password: '', configOnly: false },
      owner: '', // Gitee 用户名
      repo: '', // 仓库名（没有的话推送时按 autoCreate 自动建私有的）
      token: '', // 私人令牌（要 projects + repo 权限），存配置时按密钥处理
      branch: 'master', // 推到哪个分支
      time: '03:30', // 每天几点自动备份并推送
      keep: 10, // 远端保留最近几份
      autoCreate: true, // 远端没有这个仓库时自动建一个私有的
      forceOverwrite: false, // 允许覆盖「已有内容但不是本工具推的」仓库（清空远端历史重推）：面板显式勾选才开
    },
  },
  tabs: {}, // 面板记住的小偏好
  // 模块：内置的和数据目录 modules/ 里自己写的。{ 模块id: { enabled, useBuiltin } }，没写的算开着
  // useBuiltin：自己写了同名模块，但想先用回内置的
  modules: {},
  safeMode: false, // 安全模式：自己写的模块一个都不加载（排查问题用）
  ext: {}, // 自己写的模块的设置：{ 模块id: {...} }
  // token 用量与花费：面板「概览」里看。pricing 留空就用内置价目表（DeepSeek 官方价 + 其它厂商按 LiteLLM 价 ×7.2）；
  // 要覆盖就写 { models: { "我的模型": { match: "^my-llm-", in: 2, out: 8, cached: 0.5 } } }（元/百万 tokens）
  usage: { pricing: {} },
  // 联动：让别的程序、DSH 里别的会话和插件也能用她
  bridge: {
    dshTools: false, // DSH 里别的会话（比如你平时写代码的会话）能用工具让她发 QQ、查记忆
    http: false, // 开放 HTTP 接口（要带密钥）
    token: '', // 第一次打开时自动生成
    allowTargets: 'whitelist', // 外部能发给谁：whitelist = 白名单里的人和群；owner = 只能发给管理员
  },
  // 心智核心在 Aurabot 这边要的东西（其余设置都在心智核心自己的库里）
  mind: {
    embedBackend: 'remote', // remote | local
    embedKey: '', // 向量接口的密钥（默认 SiliconFlow）；第一次从旧记忆模块的设置里带过来
  },
}

