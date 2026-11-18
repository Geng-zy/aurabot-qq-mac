// 插件配置：默认值 + 归一化 + 读写。配置文件 ~/.dsh/plugins-data/aurabot/config.json

import { randomUUID } from 'node:crypto'
import { dataDir, readJson, writeJson } from './store.js'
import { DEFAULT_GROUP_POLICY } from '../chat/group-policy.js'
import { LEVELS, PROFILE_PERM_KEYS, PROFILE_PERM_LEVELS, profilePermDefault } from '../chat/access.js'
import { normalizeChatModels } from '../chat/chat-model.js'
import { DIARY_AUDIENCES } from '../features/qzone-audience.js'

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
  model: { provider: '', model: '', reasoningEffort: 'low', vision: 'auto' }, // 留空 = 跟随 DSH 默认；vision: auto/on/off
  // 按聊天选模型（管理员在面板「模型」页设）：私聊 QQ 号 > 群号 > 所有私聊 / 所有群默认 > 上面的全局模型；没写的一级退到下一级
  chatModels: { privateDefault: { provider: '', model: '', reasoningEffort: '' }, groupDefault: { provider: '', model: '', reasoningEffort: '' }, privates: {}, groups: {} },
  merge: { enabled: true, waitSec: 2.5, maxSec: 8, groupWaitSec: 5, groupMaxSec: 15 }, // 连发合并：对方停顿 waitSec 秒再一起回，最多等 maxSec 秒；群里等得久一点，把一段话攒齐
  imageGen: {
    enabled: false,
    provider: 'openai', // openai / custom / codex / local
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
  local: { tts: false, image: false, song: false, asr: false, video: false, videoTimeoutMin: 20, ffmpegPath: '' },
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
  chat: { seedHistory: false, seedHistoryCount: 20, everyStep: false, rescueFromThinking: false, thinkingGuard: true, replyMarker: false, shareRecentWithModules: false, turnTimeoutMinutes: 30 },
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
      keep: 7, // 远端保留最近几份
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

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)

function deepMerge(base, over) {
  if (!isObj(over)) return structuredClone(base)
  const out = structuredClone(base)
  for (const [k, v] of Object.entries(over)) {
    if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v)
    else if (v !== undefined) out[k] = v
  }
  return out
}

const BIG = 1e6 // 没有天然上限的数值：只防手滑填出离谱值，不当真限制
const num = (v, d, lo, hi) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}
const bool = (v, d) => (typeof v === 'boolean' ? v : d)
const qq = (v) => String(v ?? '').replace(/\D/g, '')
const qqList = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\s,，;；]+/)).map(qq).filter(Boolean))]
const hhmm = (v, d) => (/^\d{1,2}:\d{2}$/.test(String(v)) ? String(v) : d)
// 严格校验 'YYYY-MM-DD'（面板手填/配置文件手改都可能乱），非法日期当没填。
const dateKey = (v) => {
  const s = String(v ?? '').trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? s : ''
}
// 请求头：正常是字符串（一行一个）；手写成对象 / 数组时展开成同样的多行文本，
// 免得下游按行解析时认不出来，静默把头全丢掉。
const headerLines = (v) => {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((x) => String(x ?? '')).join('\n')
  if (isObj(v)) return Object.entries(v).map(([k, x]) => `${k}: ${x ?? ''}`).join('\n')
  return v == null ? '' : String(v)
}
// 请求体：正常是字符串；手写成对象 / 数组时序列化回去（占位符 {text} / {reqid} 照样能替换）
const bodyText = (v) => {
  if (typeof v === 'string') return v
  if (isObj(v) || Array.isArray(v)) return JSON.stringify(v, null, 2)
  return v == null ? '' : String(v)
}

// 上报开关：总开关 + 按工作区的覆盖。覆盖项只认布尔值，别的一律当「没写」，跟随总开关。
function normalizeNotice(v, legacyNotify) {
  const o = isObj(v) ? v : {}
  const out = { enabled: bool(o.enabled, true), approval: typeof o.approval === 'boolean' ? o.approval : legacyNotify !== false, question: bool(o.question, true), workspaces: {} }
  for (const [key, val] of Object.entries(isObj(o.workspaces) ? o.workspaces : {})) {
    const path = String(key || '').trim()
    if (!path) continue
    const w = isObj(val) ? val : {}
    const item = {}
    if (typeof w.approval === 'boolean') item.approval = w.approval
    if (typeof w.question === 'boolean') item.question = w.question
    out.workspaces[path] = item
  }
  return out
}

export function normalize(raw) {
  const c = deepMerge(DEFAULTS, raw)
  // 桌宠 / 抖音 / 小黑盒已外置：旧配置里残留的键不再进入核心配置。
  delete c.pet
  delete c.douyin
  delete c.heybox
  c.enabled = bool(c.enabled, false)
  c.dryRun = bool(c.dryRun, true)
  c.debug = bool(c.debug, false)
  // 调试比试运行更严：它本身就包含「不真发」，所以内部一律当成 dryRun（下面所有 dryRun 判断都自动生效）。
  // 面板上两个开关互斥，「试运行」显示的是 dryRun && !debug。
  if (c.debug) c.dryRun = true
  c.botQQ = qq(c.botQQ)
  c.ownerQQ = qq(c.ownerQQ)
  c.approvalNotify = bool(c.approvalNotify, true)
  c.freedom = bool(c.freedom, true)
  // 老配置只有 approvalNotify：没写过 notice 时用它当审批上报的默认值
  c.notice = normalizeNotice(isObj(raw?.notice) ? raw.notice : null, raw?.approvalNotify)
  c.approvalViaQQ = bool(c.approvalViaQQ, true)
  c.qqApi.enabled = bool(c.qqApi.enabled, true)
  c.gateway = 'onebot'
  // 只认绝对路径（/ 开头），别的当没填
  c.workspaceDir = String(c.workspaceDir || '').trim()
  if (c.workspaceDir && !c.workspaceDir.startsWith('/')) c.workspaceDir = ''
  // 视觉能力：auto = 问 DSH 的模型元数据；on / off = 管理员手动声明（覆盖元数据）
  c.model.vision = c.model.vision === 'on' || c.model.vision === 'off' ? c.model.vision : 'auto'
  c.setupDone = bool(c.setupDone, false)
  c.ownerName = String(c.ownerName || '').trim() || '管理员'
  // 旧默认称呼迁移：老配置里的旧默认值统一改成“管理员”；自定义称呼保持原样。
  if (c.ownerName === '\u4e3b\u4eba') c.ownerName = '管理员'
  c.ownerLevel = LEVELS.includes(c.ownerLevel) ? c.ownerLevel : 'full'
  c.purge = { identityLock: c.purge?.identityLock !== false }
  c.longTasks = bool(c.longTasks, true)
  c.subagentBackground = bool(c.subagentBackground, false)
  c.chatModels = normalizeChatModels(c.chatModels)
  c.profilePerms = Object.fromEntries(PROFILE_PERM_KEYS.map((k) => [k, PROFILE_PERM_LEVELS.includes(c.profilePerms?.[k]) ? c.profilePerms[k] : profilePermDefault(k)]))
  c.allow = { private: qqList(c.allow.private), groups: qqList(c.allow.groups) }
  const drawablePrivate = new Set(qqList(c.drawAllow?.private))
  const drawableGroups = new Set(qqList(c.drawAllow?.groups))
  c.drawAllow = {
    private: c.allow.private.filter((id) => id !== c.ownerQQ && id !== c.botQQ && drawablePrivate.has(id)),
    groups: c.allow.groups.filter((id) => drawableGroups.has(id)),
  }
  // 旧授权规则不自动给会话开放普通生图。
  delete c.adultChat
  // 发文件：开关、大小上限、额外允许的目录（只认绝对路径；空行忽略）
  if (!isObj(c.files)) c.files = {}
  if (!isObj(c.security)) c.security = {}
  c.security.dangerConfirm = bool(c.security.dangerConfirm, false)
  c.security.ssrfMode = c.security.ssrfMode === 'loose' ? 'loose' : 'strict'
  // 远端管理开关与可信反代：放 security 段（顶层对象，不会被下面「ext 只留对象」的规则删掉）
  c.security.panelRemoteAccess = bool(c.security.panelRemoteAccess, false)
  c.security.trustedProxy = String(c.security.trustedProxy || '').trim()
  c.security.publicHostname = String(c.security.publicHostname || '').trim().toLowerCase()
  // 浏览器后端开关（老配置没有 browser 段也要补出默认值）
  if (!isObj(c.browser)) c.browser = {}
  c.browser.useDshSidebar = bool(c.browser.useDshSidebar, false)
  // DeepSeek 峰谷省钱模式：默认关；节假日列表去重、只留合法的 'YYYY-MM-DD'（北京时间日期）
  if (!isObj(c.cost)) c.cost = {}
  c.cost.offPeak = bool(c.cost.offPeak, false)
  const rawHolidays = Array.isArray(c.cost.offPeakHolidays) ? c.cost.offPeakHolidays : String(c.cost.offPeakHolidays || '').split(/[\n,，;；\s]+/)
  c.cost.offPeakHolidays = [...new Set(rawHolidays.map(dateKey).filter(Boolean))].sort().slice(0, 60)
  c.files.enabled = bool(c.files.enabled, true)
  c.files.maxMB = num(c.files.maxMB, 50, 1, BIG)
  c.files.imageByPath = bool(c.files.imageByPath, DEFAULTS.files.imageByPath)
  c.files.relay = bool(c.files.relay, true)
  // 只收主机名 / IP，别的字符一律当没填（防止拼出奇怪的地址）
  c.files.relayHost = /^[A-Za-z0-9.-]{1,253}$/.test(String(c.files.relayHost || '').trim()) ? String(c.files.relayHost).trim() : 'host.docker.internal'
  c.files.dirs = (Array.isArray(c.files.dirs) ? c.files.dirs : String(c.files.dirs || '').split(/[\n,，;；]+/))
    .map((s) => String(s).trim()).filter((s) => s.startsWith('/')).slice(0, 20)
  const g = c.group
  g.wakeWords = (Array.isArray(g.wakeWords) ? g.wakeWords : String(g.wakeWords || '').split(/[\s,，]+/)).map((s) => String(s).trim()).filter(Boolean)
  g.interjectChance = num(g.interjectChance, 0.15, 0, 1)
  g.cooldownSec = num(g.cooldownSec, 90, 0, BIG)
  g.maxPerHour = num(g.maxPerHour, 6, 0, BIG)
  g.mustMaxPerHour = num(g.mustMaxPerHour, 100, 0, BIG)
  g.minRecentMessages = num(g.minRecentMessages, 3, 0, BIG)
  g.activeWindowSec = num(g.activeWindowSec, 300, 1, BIG)
  if (!Array.isArray(g.quietHours) || g.quietHours.length !== 2) g.quietHours = DEFAULT_GROUP_POLICY.quietHours
  g.quietHours = g.quietHours.map((h) => num(h, 0, 0, 23))
  if (!isObj(g.overrides)) g.overrides = {}
  delete g.ownerBrief // 「管理员私聊：群聊摘要」换成了心智核心的「别的聊天里刚发生了什么」
  // 群里的本机工具：默认关；只有明确写了 owner 才开（原项目删掉了「谁问都行」一档，74eece2）
  g.ownerTools = g.ownerTools === 'owner' ? 'owner' : 'off'
  g.ownerToolsGroups = qqList(g.ownerToolsGroups)
  c.voice.autoChance = num(c.voice.autoChance, 0.15, 0, 1)
  c.voice.autoMaxChars = num(c.voice.autoMaxChars, 80, 1, BIG)
  c.voice.emojiSeparate = c.voice.emojiSeparate !== false
  // 通用 HTTP 引擎（接火山 / 阿里 / 讯飞这类云 TTS）：method 只认 GET / POST，其余当 GET；
  // 地址、请求头、请求体一律转成字符串——手改 config.json 写成对象、数组或数字时，也按原意
  // 拼得出去，不会变成 "[object Object]" 或者带着填错的空格。
  if (!isObj(c.voice.http)) c.voice.http = structuredClone(DEFAULTS.voice.http)
  c.voice.http.urlTemplate = String(c.voice.http.urlTemplate ?? '').trim()
  c.voice.http.method = String(c.voice.http.method ?? '').trim().toUpperCase() === 'POST' ? 'POST' : 'GET'
  c.voice.http.headers = headerLines(c.voice.http.headers)
  c.voice.http.body = bodyText(c.voice.http.body)
  c.voice.http.sampleRate = num(c.voice.http.sampleRate, 24000, 8000, 48000)
  // Breeze 语音：地址 / 音色 id / 语气说明；Key 不回显（publicConfig 里换成 keySet）
  if (!isObj(c.voice.breeze)) c.voice.breeze = structuredClone(DEFAULTS.voice.breeze)
  const bz = c.voice.breeze
  bz.mode = ['cloud', 'local'].includes(String(bz.mode)) ? String(bz.mode) : 'cloud'
  bz.url = String(bz.url ?? '').trim().slice(0, 400) || DEFAULTS.voice.breeze.url
  bz.key = String(bz.key ?? '').trim().slice(0, 400)
  bz.voiceId = String(bz.voiceId ?? '').trim().slice(0, 200)
  bz.siteUrl = String(bz.siteUrl ?? '').trim().slice(0, 400) || DEFAULTS.voice.breeze.siteUrl
  bz.email = String(bz.email ?? '').trim().slice(0, 200)
  bz.password = String(bz.password ?? '').slice(0, 400)
  bz.autoClaim = bz.autoClaim !== false
  bz.model = String(bz.model ?? '').trim().slice(0, 100) || DEFAULTS.voice.breeze.model
  bz.languageCode = String(bz.languageCode ?? '').trim().slice(0, 20) || DEFAULTS.voice.breeze.languageCode
  bz.instructions = String(bz.instructions ?? '').trim().slice(0, 500)
  bz.outputFormat = String(bz.outputFormat ?? '').trim().slice(0, 60) || DEFAULTS.voice.breeze.outputFormat
  bz.guidanceScale = num(bz.guidanceScale, 0, 0, 20)
  bz.timeoutMs = num(bz.timeoutMs, 60000, 5000, 600000)
  // 云端语音识别：provider 只认内置两项和 custom；地址/模型留空时由 asr.js 用预置默认值
  if (!isObj(c.voice.asrApi)) c.voice.asrApi = structuredClone(DEFAULTS.voice.asrApi)
  const asrApi = c.voice.asrApi
  asrApi.provider = ['', 'siliconflow', 'openai', 'custom'].includes(asrApi.provider) ? asrApi.provider : ''
  for (const k of ['baseUrl', 'model', 'apiKey', 'language']) asrApi[k] = String(asrApi[k] ?? '').trim()
  asrApi.baseUrl = asrApi.baseUrl.replace(/\/+$/, '')
  asrApi.prefer = ['qq', 'cloud'].includes(asrApi.prefer) ? asrApi.prefer : 'qq'
  c.stickers.autoChance = num(c.stickers.autoChance, 0.35, 0, 1)
  // 主动贴表情：自己的概率（默认 0.15），不从 autoChance 取值；老配置里存成 null 的按默认算
  c.stickers.reactChance = num(c.stickers.reactChance ?? 0.15, 0.15, 0, 1)
  c.stickers.reactMaxPerHour = num(c.stickers.reactMaxPerHour, 10, 0, BIG)
  c.stickers.react = bool(c.stickers.react, false)
  c.stickers.faces = c.stickers.faces !== false
  c.stickers.collectMode = ['ask', 'auto', 'owner'].includes(c.stickers.collectMode) ? c.stickers.collectMode : 'auto'
  c.stickers.maxPerHour = num(c.stickers.maxPerHour, 20, 0, BIG)
  c.stickers.maxLibrary = num(c.stickers.maxLibrary, 300, 1, BIG)
  // 起名单独挑的模型：两半都填了才认；填一半 / 脏数据都当没填（回落到聊天模型）
  c.stickers.captionModel = (() => {
    const m = isObj(c.stickers.captionModel) ? c.stickers.captionModel : {}
    const provider = String(m.provider || '').trim()
    const model = String(m.model || '').trim()
    return provider && model ? { provider, model } : { provider: '', model: '' }
  })()
  c.diary.timesPerDay = num(c.diary.timesPerDay, 2, 0, 48)
  c.diary.windowStart = hhmm(c.diary.windowStart, '10:00')
  c.diary.windowEnd = hhmm(c.diary.windowEnd, '23:30')
  c.diary.minGapMinutes = num(c.diary.minGapMinutes, 180, 0, BIG)
  c.diary.attachImage = bool(c.diary.attachImage, true)
  if (!isObj(c.diary.rich)) c.diary.rich = { ...DEFAULTS.diary.rich }
  for (const key of ['enabled', 'stickers', 'browsing', 'local']) c.diary.rich[key] = bool(c.diary.rich[key], DEFAULTS.diary.rich[key])
  c.diary.rich.folder = typeof c.diary.rich.folder === 'string' ? c.diary.rich.folder.trim() : ''
  if (c.diary.rich.folder && !/^([a-zA-Z]:[\\/]|\/)/.test(c.diary.rich.folder)) c.diary.rich.folder = ''
  delete c.diary.rich.cards
  c.diary.rich.maxImages = Math.round(num(c.diary.rich.maxImages, 2, 1, 9))
  if (!isObj(c.diary.archive)) c.diary.archive = { ...DEFAULTS.diary.archive }
  c.diary.archive.enabled = bool(c.diary.archive.enabled, false)
  c.diary.archive.folder = typeof c.diary.archive.folder === 'string' ? c.diary.archive.folder.trim() : ''
  if (c.diary.archive.folder && !/^([a-zA-Z]:[\\/]|\/)/.test(c.diary.archive.folder)) c.diary.archive.folder = ''
  c.diary.minChars = num(c.diary.minChars, 60, 1, BIG)
  c.diary.maxChars = num(c.diary.maxChars, 140, 1, BIG)
  c.diary.visibility = DIARY_AUDIENCES.includes(c.diary.visibility) ? c.diary.visibility : 'all'
  c.diary.audienceQQs = qqList(c.diary.audienceQQs).slice(0, 200).join('\n')
  const q = c.qzoneSocial
  q.enabled = bool(q.enabled, true)
  q.replyOwn = bool(q.replyOwn, true)
  q.commentFriends = bool(q.commentFriends, true)
  q.like = bool(q.like, true)
  q.friendChance = num(q.friendChance, 0.3, 0, 1)
  q.ownerChance = num(q.ownerChance, 0.7, 0, 1)
  q.maxPerDay = num(q.maxPerDay, 8, 0, BIG)
  delete q.intervalMin // 什么时候逛空间由她自己决定（心智核心的动机）
  for (const k of ['tts', 'image', 'song', 'asr', 'video']) c.local[k] = bool(c.local[k], false)
  c.local.videoTimeoutMin = num(c.local.videoTimeoutMin, 20, 1, BIG)
  // 旧版把共享的 ffmpeg 路径放在 B 站设置里。只迁移路径，保留显式清空。
  c.local.ffmpegPath = String(raw?.local?.ffmpegPath ?? raw?.bili?.ffmpegPath ?? '').trim()
  delete c.bili
  // 心智核心接手以后不用的旧设置：主动搭话、心情、旧记忆模块（向量密钥先搬到 mind.embedKey）
  const oldVectorKey = String(raw?.memory?.vector?.apiKey || '').trim()
  delete c.speakUp
  delete c.mood
  delete c.purpose
  for (const id of ['speakup', 'mood', 'purpose', 'memory']) if (isObj(c.modules)) delete c.modules[id]
  // 老配置里插件自己管 SnowLuma 用的设置（只有原版的 Windows 才有），这里用不到
  for (const k of ['dir', 'autoStart', 'webuiPort', 'webuiPassword', 'passwordAuto', 'autoAttach']) delete c.snowluma[k]
  c.chat = c.chat || {}
  c.chat.seedHistory = bool(c.chat.seedHistory, false)
  c.chat.seedHistoryCount = num(c.chat.seedHistoryCount, 20, 1, BIG)
  c.chat.everyStep = bool(c.chat.everyStep, false)
  c.chat.rescueFromThinking = bool(c.chat.rescueFromThinking, false)
  c.chat.thinkingGuard = bool(c.chat.thinkingGuard?.enabled ?? c.chat.thinkingGuard, true)
  c.chat.shareRecentWithModules = bool(c.chat.shareRecentWithModules, false)
  c.chat.replyMarker = bool(c.chat.replyMarker?.enabled ?? c.chat.replyMarker, false)
  c.chat.turnTimeoutMinutes = num(c.chat.turnTimeoutMinutes, 30, 0, 180)
  // 老版本的 0 是当时的默认值，不是谁选的：升级后改成留 7 天，以后面板里再选 0 才算数
  const keepUnset = raw?.memory?.keepChatlogDays === 0 && !raw.memory.keepChatlogSet
  c.memory.keepChatlogDays = keepUnset ? 7 : num(c.memory.keepChatlogDays, 7, -1, 3650)
  c.memory.keepChatlogSet = true
  c.memory = { keepChatlogDays: c.memory.keepChatlogDays, keepChatlogSet: true }
  if (!isObj(c.mind)) c.mind = { ...DEFAULTS.mind }
  c.mind.embedBackend = c.mind.embedBackend === 'local' ? 'local' : 'remote'
  c.mind.embedKey = String(c.mind.embedKey || '').trim() || oldVectorKey
  g.interests = (Array.isArray(g.interests) ? g.interests : String(g.interests || '').split(/[\s,，]+/)).map((s) => String(s).trim()).filter(Boolean)
  g.minRelevance = num(g.minRelevance, 0.25, 0, 1)
  // @ 了别人时不算叫她（只挡必回，仍然可以插话）；默认关，保持原行为
  g.ignoreAtOthers = bool(g.ignoreAtOthers, false)
  // 看白名单里别的群：off 关 / private 管理员和私聊里的群成员（默认）/ group 群里的成员也行
  g.crossRead = ['off', 'group'].includes(g.crossRead) ? g.crossRead : 'private'
  c.merge.enabled = bool(c.merge.enabled, true)
  c.merge.waitSec = num(c.merge.waitSec, 2.5, 0, BIG)
  c.merge.maxSec = Math.max(c.merge.waitSec, num(c.merge.maxSec, 8, 0, BIG))
  c.merge.groupWaitSec = num(c.merge.groupWaitSec, 5, 0, BIG)
  c.merge.groupMaxSec = Math.max(c.merge.groupWaitSec, num(c.merge.groupMaxSec, 15, 0, BIG))
  c.titleFilter.enabled = bool(c.titleFilter.enabled, true)
  c.titleFilter.groups = qqList(c.titleFilter.groups) // 和群白名单同一套规则
  c.titleFilter.title = String(c.titleFilter.title ?? '').replace(/[​-‍﻿]/g, '').trim().slice(0, 30) || '大肥鱼'
  g.burstMax = num(g.burstMax, 8, 1, BIG)
  g.engagedMax = num(g.engagedMax, 6, 0, BIG)
  g.burstWindowSec = num(g.burstWindowSec, 120, 1, BIG)
  if (c.voice.engine === 'windows') c.voice.engine = 'system' // 老配置里系统自带语音叫 windows
  if (!['auto', 'edge', 'system', 'cosyvoice', 'gptsovits', 'http', 'breeze'].includes(c.voice.engine)) c.voice.engine = 'auto'
  c.voice.songVoice = String(c.voice.songVoice || '').slice(0, 120)
  c.voice.songPitch = Math.max(-24, Math.min(24, Math.round(Number(c.voice.songPitch) || 0)))
  c.voice.cosyvoice.sampleRate = num(c.voice.cosyvoice.sampleRate, 22050, 8000, 48000)
  if (!['sft', 'instruct'].includes(c.voice.cosyvoice.mode)) c.voice.cosyvoice.mode = 'sft'
  // edge-tts 的语速 / 音调：只认 ±N% 和 ±NHz，写着玩的回落默认值，超范围的夹回来。
  // ⚠ 0 也必须带符号：面板的选项是 '+0%' / '+0Hz'，少了正号既对不上下拉框，
  //   又会让 `rate !== '+0%'` 成立、把 --rate=0% 传给 edge-tts（它会直接报错）。
  const signed = (n, unit) => (n < 0 ? '-' : '+') + Math.abs(n) + unit
  const pct = /^([+-]?\d{1,3})\s*%$/.exec(String(c.voice.rate || '').trim())
  c.voice.rate = signed(pct ? Math.max(-50, Math.min(50, Number(pct[1]))) : 0, '%')
  const hz = /^([+-]?\d{1,3})\s*Hz$/i.exec(String(c.voice.pitch || '').trim())
  c.voice.pitch = signed(hz ? Math.max(-80, Math.min(80, Number(hz[1]))) : 0, 'Hz')
  c.imageGen.fallbackEnabled = bool(c.imageGen.fallbackEnabled, false)
  const fallbackIds = new Set()
  c.imageGen.fallbacks = (Array.isArray(c.imageGen.fallbacks) ? c.imageGen.fallbacks : []).flatMap((item) => {
    const id = String(item?.id || '').slice(0, 80)
    if (!/^[a-z0-9_-]+$/i.test(id) || fallbackIds.has(id)) return []
    fallbackIds.add(id)
    return [{
      id, provider: item.provider === 'codex' ? 'codex' : 'openai',
      baseUrl: String(item.baseUrl || '').trim().replace(/\/+$/, '').slice(0, 500),
      apiKey: String(item.apiKey || '').trim(), model: String(item.model || '').trim().slice(0, 200),
    }]
  }).slice(0, 5)
  c.imageGen.enabled = bool(c.imageGen.enabled, false)
  delete c.imageGen.ownerOnly
  delete c.imageGen.localDraw
  c.imageGen.seeOwn = bool(c.imageGen.seeOwn, true)
  c.imageGen.img2img = bool(c.imageGen.img2img, true)
  if (!/^\d{3,4}x\d{3,4}$/.test(String(c.imageGen.size))) c.imageGen.size = '1024x1024'
  c.imageGen.galleryShown = Math.min(50, Math.max(1, Math.round(Number(c.imageGen.galleryShown) || 20)))
  c.imageGen.shape = ['her', 'square', 'portrait', 'landscape', 'wide'].includes(c.imageGen.shape) ? c.imageGen.shape : 'her'

  c.imageGen.provider = ['custom', 'codex', 'local'].includes(c.imageGen.provider) ? c.imageGen.provider : 'openai'
  c.imageGen.localSteps = Math.max(4, Math.min(50, Math.round(Number(c.imageGen.localSteps) || 20)))
  if (!isObj(c.imageGen.codex)) c.imageGen.codex = { ...DEFAULTS.imageGen.codex }
  const igx = c.imageGen.codex
  const codexImageModels = [
    DEFAULTS.imageGen.codex.model,
    'gpt-image-2.5-flare',
    'gpt-image-2.5-sunburst',
    'gpt-image-2.6-flare',
    'gpt-image-2.6-sunburst',
  ]
  if (!codexImageModels.includes(igx.model)) igx.model = DEFAULTS.imageGen.codex.model
  igx.quality = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(igx.quality) ? igx.quality : 'auto'
  igx.background = ['auto', 'transparent', 'opaque'].includes(igx.background) ? igx.background : 'auto'
  if (!c.imageGen.custom || typeof c.imageGen.custom !== 'object') c.imageGen.custom = { ...DEFAULTS.imageGen.custom }
  const igc = c.imageGen.custom
  igc.method = String(igc.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET'
  igc.bodyType = igc.bodyType === 'form' ? 'form' : 'json'
  igc.url = String(igc.url || '').trim().slice(0, 2000)
  igc.responsePath = String(igc.responsePath || '').trim().slice(0, 200)
  igc.params = (Array.isArray(igc.params) ? igc.params : [])
    .map((p) => ({ key: String((p && p.key) || '').trim().slice(0, 60), value: String(p && p.value != null ? p.value : '').slice(0, 500) }))
    .filter((p) => p.key)
    .slice(0, 30)

  c.song.enabled = bool(c.song.enabled, false)
  c.song.ownerOnly = bool(c.song.ownerOnly, true)
  c.song.pitch = num(c.song.pitch, 0, -24, 24)
  c.song.maxVoiceSec = num(c.song.maxVoiceSec, 120, 1, BIG)
  c.song.vocalVolume = num(c.song.vocalVolume, 1, 0, 10)
  c.song.instVolume = num(c.song.instVolume, 0.8, 0, 10)
  if (!['auto', 'head'].includes(c.song.clipStart)) c.song.clipStart = 'auto'
  // 老配置：'' 是以前的默认（没开），改成自动；tuna 是以前的「用镜像」
  c.song.pypiMirror = { '': 'auto', tuna: 'cn' }[c.song.pypiMirror] ?? c.song.pypiMirror
  if (!['auto', 'cn', 'off'].includes(c.song.pypiMirror)) c.song.pypiMirror = 'auto'
  c.song.root = String(c.song.root || '').trim()
  c.song.localMusic = bool(c.song.localMusic, true)
  c.song.localMusicDir = String(c.song.localMusicDir || '').trim()
  c.song.indexRate = num(c.song.indexRate, 0.3, 0, 1)
  c.song.volumeEnvelope = num(c.song.volumeEnvelope, 0.5, 0, 1)
  c.song.protect = num(c.song.protect, 0.33, 0, 0.5)
  if (!isObj(c.song.enhance)) c.song.enhance = {}
  for (const k of ['enabled', 'dereverb', 'splitBacking', 'duetSplit', 'autoKey', 'toneMatch']) c.song.enhance[k] = bool(c.song.enhance[k], true)
  c.song.enhance.backEnvelope = num(c.song.enhance.backEnvelope, 0, 0, 1)
  // 云备份：owner/repo 去空格，令牌按密钥处理（SECRETS 里有登记）。
  // owner/repo 只留 URL 白名单字符（@ : / ? # 空格等能改语义的直接去掉，push 时还有白名单硬校验兜底）；
  // branch 拒 .. 与 - 开头，防 refspec/选项注入。
  c.backup = c.backup || {}
  if (!isObj(c.backup.remote)) c.backup.remote = { ...DEFAULTS.backup.remote }
  const br = c.backup.remote
  br.enabled = bool(br.enabled, false)
  br.owner = String(br.owner || '').trim().replace(/^https?:\/\//i, '').replace(/^gitee\.com\//i, '').split(/[/?]/)[0].replace(/\.git$/, '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 100)
  br.repo = String(br.repo || '').trim().replace(/\.git$/, '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 100)
  br.token = String(br.token || '').trim()
  br.branch = String(br.branch || '').trim().replace(/^refs\/heads\//, '').replace(/[^A-Za-z0-9._/-]/g, '').replace(/^[.\-]+/, '').replace(/\.\.+/g, '.').slice(0, 100) || 'master'
  br.time = hhmm(br.time, '03:30')
  br.keep = Math.round(num(br.keep, 7, 1, 365))
  br.autoCreate = bool(br.autoCreate, true)
  br.forceOverwrite = bool(br.forceOverwrite, false)
  if (!isObj(c.modules)) c.modules = {}
  for (const [id, m] of Object.entries(c.modules)) {
    if (!isObj(m)) { delete c.modules[id]; continue }
    m.enabled = bool(m.enabled, true)
    m.useBuiltin = bool(m.useBuiltin, false)
  }
  if (!isObj(c.ext)) c.ext = {}
  for (const k of Object.keys(c.ext)) if (!isObj(c.ext[k])) delete c.ext[k] // 传 null = 删掉这个模块的设置
  c.safeMode = bool(c.safeMode, false)
  // 花费估算的价格表：手动填了就用手填的（手填的部分覆盖内置价），没填就用内置 DeepSeek 价
  if (!isObj(c.usage)) c.usage = { pricing: {} }
  if (!isObj(c.usage.pricing)) c.usage.pricing = {}
  c.bridge.dshTools = bool(c.bridge.dshTools, false)
  c.bridge.http = bool(c.bridge.http, false)
  c.bridge.token = String(c.bridge.token || '')
  if (!['whitelist', 'owner'].includes(c.bridge.allowTargets)) c.bridge.allowTargets = 'whitelist'
  return c
}

// 面板里不回传原文的字段：路径（几层都行）
const SECRETS = [['snowluma', 'httpToken'], ['snowluma', 'wsToken'], ['imageGen', 'apiKey'], ['mind', 'embedKey'], ['song', 'neteaseCookie'], ['bridge', 'token'], ['voice', 'asrApi', 'apiKey'], ['voice', 'breeze', 'key'], ['voice', 'breeze', 'password'], ['backup', 'remote', 'token'], ['backup', 'remote', 'webdav', 'password']]
// 扩展模块设置里的密码类字段（模块加载时登记）：['ext', 模块id, 字段]
const extraSecrets = new Map()
export function registerSecretField(path) { extraSecrets.set(path.join('\u0000'), path) }
const allSecrets = () => [...SECRETS, ...extraSecrets.values()]
const parentOf = (obj, path, create) => {
  let cur = obj
  for (const k of path.slice(0, -1)) {
    if (!isObj(cur[k])) { if (!create) return null; cur[k] = {} }
    cur = cur[k]
  }
  return cur
}
const getAt = (obj, path) => { const p = parentOf(obj, path, false); return p ? p[path.at(-1)] : undefined }
const FILE = () => dataDir('config.json')

/** 在某次更新里新增、会替她公开发东西的功能。以后再加这类功能，把配置键名加到这里。 */
export const OPT_IN_ON_UPDATE = ['qzoneSocial']

export function loadConfig() {
  const raw = readJson(FILE(), {})
  // 老配置（向导上线前就填好了两个号）直接算向导已完成
  if (raw && raw.setupDone === undefined && raw.botQQ && raw.ownerQQ) raw.setupDone = true
  // 更新插件后新增的、会公开发东西的功能：老用户先关着，等他们自己在面板里打开（新安装照常默认开）
  if (raw && raw.setupDone) for (const k of OPT_IN_ON_UPDATE) if (raw[k] === undefined) raw[k] = { enabled: false }
  return normalize(raw)
}

export function ownerAuthorizationRevision(cfg) {
  const binding = cfg.ownerAuthorization
  return cfg.ownerQQ && binding?.owner === cfg.ownerQQ && typeof binding.revision === 'string'
    && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(binding.revision) ? binding.revision : ''
}

export function saveConfig(cfg, previous = loadConfig()) {
  const c = normalize(cfg)
  // Only the previous authoritative configuration can carry an authorization forward.
  if (c.ownerQQ) {
    const revision = c.ownerQQ === previous.ownerQQ ? ownerAuthorizationRevision(previous) : ''
    c.ownerAuthorization = { owner: c.ownerQQ, revision: revision || randomUUID() }
  } else delete c.ownerAuthorization
  writeJson(FILE(), c)
  return c
}

/** 给面板看的版本：密码 / token 不回传原文，只告诉有没有填。 */
export function publicConfig(cfg) {
  const c = structuredClone(cfg)
  delete c.ownerAuthorization
  delete c.bili
  for (const item of c.imageGen?.fallbacks || []) {
    item.apiKeySet = Boolean(item.apiKey)
    item.apiKey = ''
  }
  // 面板上的「试运行」只表示「试运行但不调试」：调试开着时它显示为关，两个开关天然互斥
  c.dryRun = Boolean(c.dryRun && !c.debug)
  for (const path of allSecrets()) {
    const p = parentOf(c, path, false)
    if (!p) continue
    const k = path.at(-1)
    p[`${k}Set`] = Boolean(p[k])
    p[k] = ''
  }
  return c
}

/** 面板保存时：没改的密码字段（空串）保留原值。 */
export function mergeFromPanel(current, incoming) {
  const next = deepMerge(current, incoming || {})
  for (const path of allSecrets()) {
    const v = getAt(incoming || {}, path)
    const p = parentOf(next, path, v !== undefined)
    if (!p) continue
    const k = path.at(-1)
    if (v === null) p[k] = '' // 明确传 null = 清空
    else if (v === undefined || v === '') p[k] = getAt(current, path) ?? ''
    delete p[`${k}Set`]
    delete p[`${k}Hint`]
  }
  if (Array.isArray(incoming?.imageGen?.fallbacks)) {
    const saved = new Map((current.imageGen?.fallbacks || []).map((item) => [item.id, item]))
    next.imageGen.fallbacks = incoming.imageGen.fallbacks.filter(isObj).map((item) => {
      const old = saved.get(item.id)
      const sameEndpoint = old && old.baseUrl === String(item.baseUrl || '').trim().replace(/\/+$/, '') && (item.provider === 'codex' ? 'codex' : 'openai') === old.provider
      return { ...item, apiKey: item.apiKey === null ? '' : item.apiKey || (sameEndpoint ? old.apiKey : '') }
    })
  }
  // 联动密钥只由插件生成，面板不能改
  next.bridge.token = current.bridge?.token || ''
  if (incoming?.group?.overrides) next.group.overrides = incoming.group.overrides
  // 按聊天选模型：两张表整张替换（deepMerge 会让删掉的条目又回来）
  if (incoming?.chatModels?.privates) next.chatModels.privates = incoming.chatModels.privates
  if (incoming?.chatModels?.groups) next.chatModels.groups = incoming.chatModels.groups
  if (incoming?.allow) next.allow = { ...current.allow, ...incoming.allow }
  return normalize(next)
}
