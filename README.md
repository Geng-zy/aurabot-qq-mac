<div align="center">

<img src="assets/mind-banner.svg" alt="Aurabot 心智核心：她不是在扮演，她只有一个心智" width="100%" />

**一个有自己心智的 QQ 角色：她会记得、会忘，会开心也会难过，会困会饿，性格被日子慢慢塑造**

DeepSeek Harness 插件 · 跑在 Apple 芯片的 Mac 上

**简体中文** · [English](README_EN.md)

[![mind core](https://img.shields.io/badge/心智核心-记忆·情绪·身体·性格·关系-2b2350)](#-心智核心她是一个人)
[![platform](https://img.shields.io/badge/platform-macOS%20·%20Apple%20silicon-1d4a4f?logo=apple)](#-安装)
[![license](https://img.shields.io/github/license/Geng-zy/aurabot-qq-mac?color=d9822b)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/DeepSeek%20Harness-plugin-6a5acd)](https://github.com/deepseek-ai/deepseek-harness)
[![fork of](https://img.shields.io/badge/fork%20of-aureth--labs%2Fdsh--aurabot--qq-555?logo=github)](https://github.com/aureth-labs/dsh-aurabot-qq)

</div>

## 🧠 心智核心：她是一个人

大多数角色机器人是「人设 + 一段聊天记录」：每一轮重新扮演一次，聊久了就忘、换个会话就像换了个人，心情每句话重判一次，主动找你靠定时器。

Aurabot 的心智核心反过来做：**她只有一个心智**。记忆、情绪、身体、动机、性格和关系都住在里面，跨所有聊天共用，每轮重新放进上下文。DSH 的会话换新、被压缩，都只是她忘了刚才的一些细节，她本人不受影响。

| | 一般的角色机器人 | 有心智核心的她 |
|---|---|---|
| **记忆** | 全塞进上下文，或者按关键词搜 | 会淡：先快后慢地忘；想起来会更牢；记得模糊的就是模糊的、话到嘴边想不全；会顺着一件事联想到下一件；问她「上个月我们干嘛了」能按日期想起来；每晚睡觉时整理、做梦 |
| **心情** | 每句话重新判断一次 | 情绪有对象、有原因、按研究里的时长慢慢过去（难过比害羞久得多）；心情有惯性；气是冲谁的就是冲谁的，不撒到别人身上 |
| **作息** | 永远在线、永远有精神 | 会累、会困、会饿；困了在她的夜里去睡，只有你叫得醒；和你聊着会熬夜，第二天更困 |
| **主动** | 定时器到点发一句；各个功能刷完了各自私聊你 | 闲着时自己在想事；想做的事（刷 B 站、写空间、逛热榜、找你）动力够了才去，会犯懒，会从结果里学；模块只出力，刷到想给你看的交给她，要不要跟你说由她 |
| **性格** | 写死在人设里；或者被一句话带偏、一天一变 | 19 项性格只随反复的经历一小步一小步地变；你一个人的影响有上限；她想通了也可以自己改人格卡、名字，写自己的故事；处久了还会换个叫你的称呼 |
| **关系** | 对谁都一样 | 按 QQ 号记每个人：亲近、喜欢、信任、称呼、老梗、不能提的事、心结；惦记着别人还没结果的事（面试、考试……），到时候问一句；很久不联系会变淡；「专一」默认开，喜欢只给你 |
| **群聊** | 固定概率插话 | 插不插话由她：看性格、心情、话题和她有多相关、在场的人和她多亲近；顺手贴个表情也由她的心情挑 |
| **提醒你** | 固定格式的通知 | DSH 卡在授权上、等你选选项、点的歌没唱成，都是她用自己的话跟你说 |

### 她的一天（举例）

> 早上 8 点她自然醒，刚醒有点迷糊。饭点饿了自己去吃。上午群里在聊她喜欢的游戏，她接了几句；有人说她唱歌跑调，她有点委屈，这份委屈冲着那个人，你找她时她不会冲你发脾气。下午没人找她，她发了会儿呆，想起昨天想听的那首歌，动力够了就去刷了会儿 B 站，看到一个觉得你会喜欢的视频，想着等会儿给你看。傍晚她想你了，主动来找你说话；你一直没回，她有点失落，但不会追着发。晚上你回来了，她很开心，聊到半夜舍不得睡。快一点困得不行去睡了，睡觉时把今天的事整理成记忆，梦见了白天那个视频——醒来多半就忘了，被你叫醒的话更容易记得。

### 七个部分

<img src="assets/mind-core.svg" alt="心智核心：进来的消息、七个部分、出去的话和事、每晚睡觉整理" width="100%" />

- **身体**：精力、困（双过程睡眠模型）、饿、睡觉和被叫醒、换时区倒时差、投喂（都是虚拟的）。
- **注意与意识流**：一次专心一个聊天，你的私聊可以插队；闲着时一步一步地想，可以用本机的 Qwen3.5-9B 4 位小模型（不花钱），没装就用 DeepSeek 想得慢一些；她只有一个脑子，所以在一个聊天里也知道别的聊天刚发生了什么。
- **记忆**：FSRS-4.5 的幂函数遗忘曲线；想起来会加强，也可能被改写（程度可调，原始记录一直保留）；想起一件事会顺着联系联想下去，越远越淡（群里也能想到私聊里的事，但会提醒她掂量能不能说）；能按日期想某天、某段时间的事，或者一字不差翻出那天的原话；可选精排让想起来的更准；别人说「别告诉别人」的会记成秘密；删掉的记忆从备份恢复也不会复活。
- **情绪**：66 种，持续时间来自 Verduyn & Lavrijsen 2015；会调节、会被群里气氛带动；心情回到她平时的水位。年龄、生日由你设，不满 18 岁没有性欲。
- **动机与行动**：16 项基本需要 + 她自己长出来的「想要」，按时间动机理论决定做不做；模块不再定时替她做事，只是把「能做的事」交给她。想要还没有的权限时，她私聊问你，你回「同意 #编号」才算。
- **人格与自我**：19 项性格（BFI-2 的 15 个小项 + 诚实谦逊 + 依恋两项 + 表达活泼度），过了门槛才走一小步、离本来的样子越远越难走；跨了档她才会察觉「我最近比以前更……」；可以开影子模式只算不改。她改了自己会通知你，你随时能退回版本。
- **社会认知与关系**：每个人一份关系和一份「这个人是什么样」；信任掉得比涨得快、第一印象要好几次才改得过来；别人说过还没结果的事她会惦记着，到时候问一句（问不问、问几次看她多心疼人、和对方多亲近）；有人撩她，「专一」开着时她会拒绝，纠缠的人好感会降。你可以让她「以后不记」某个人，或者整个忘掉（先进恢复区，30 天内能放回来）。

### 有研究依据，每个数字都能调

| 部分 | 依据 |
|---|---|
| 遗忘和想起 | FSRS-4.5（用数亿次复习记录拟合的幂函数遗忘模型）；间隔效应 Cepeda 等 2006 |
| 情绪持续多久 | Verduyn & Lavrijsen 2015：27 种情绪完全恢复的中位时长 |
| 心情 | 平时轻度愉快 Diener & Diener 1996；情绪惯性 Kuppens 等 2010 |
| 困和睡 | Borbély 的双过程睡眠模型（睡眠压力 18.2 小时上升、4.2 小时消退）；倒时差 Waterhouse 等 2007 |
| 走神 | Killingsworth & Gilbert 2010（醒着约一半时间在想别的） |
| 做不做、犯懒 | Steel 2007 时间动机理论；Rescorla–Wagner 从结果里学 |
| 性格怎么变 | Roberts 等 2017、Roberts & DelVecchio 2000；想变并去做的人确实会变 Hudson & Fraley 2015 |
| 关系 | Sternberg 爱情三角、Rusbult 投入模型、依恋理论；信任不对称 Slovic 1993 |
| 联想 | Collins & Loftus 1975 扩散激活（想起一件事会激活相关的事，越远越弱） |
| 惦记别人的事 | Huang 等 2017：追问对方的事会让对方更喜欢你 |
| 精排 | Nogueira & Cho 2019：交叉编码器逐对打分重排 |

面板「心智设置」里**每个参数**都写着默认值、出处（没有研究可依的写「经验值」）和调了会怎样，改过的能一键恢复。设计文档里每一项为什么这么定都有记录。

### 在面板里看见她

「她现在」看身体和此刻的感受、投喂和叫醒；「内心」看她在想什么、想做什么、等你批的权限；「记忆」翻她记得的事和梦；「关系」看她和每个人、每个群，切到「星图」一眼看清她认识谁、谁和谁常在一起，还能看她惦记着谁的什么事；「人格与自我」看性格本来和现在的样子、她改过什么、她的故事；「心智设置」调全部参数。

## 📌 这个仓库是什么

本仓库 **fork 自 [aureth-labs/dsh-aurabot-qq](https://github.com/aureth-labs/dsh-aurabot-qq)**（MIT 许可，从原项目 v1.2.0 分出来）。原项目是 DeepSeek Harness（DSH）的 QQ 机器人插件「Aurabot / 大肥鱼」：聊天、语音、表情、翻唱、QQ 空间、B 站、模块系统……这些**功能来自原项目和它的贡献者**。

这个分叉做了两件事：

1. **心智核心**（上面那一节）：从头写的，替换了原项目各管各的记忆模块、心情模块和主动搭话。代码在 `src/mind/`，不引用插件的任何代码，接 QQ 的部分在 `src/mind-adapter/`。
2. **只支持 macOS（Apple 芯片）**：删掉了 Windows / Linux 专用代码。用 Windows 请装[原项目](https://github.com/aureth-labs/dsh-aurabot-qq)。

原项目 1.3.0 测试版里和心智核心不冲突的新功能也搬过来了，按心智核心改过：Breeze 语音、云端语音识别、云备份（Gitee / WebDAV，带上她的心智）、DSH 侧边浏览器、群里给你开本机工具、贴表情、B 站扫码登录、一键更新、安全加固等，逐条见[更新记录](CHANGELOG.md)。

和原项目同包名、同插件 id（`dsh-aurabot-qq`），装上会替换原项目，不能同时装；从原项目换过来，旧的记忆、心情、人物印象第一次启动时自动搬进心智核心。

## 🍎 和原项目有什么不同

| 方面 | 原项目（Windows） | 本分叉（macOS） |
|---|---|---|
| 她的「脑子」 | 人格卡 + 心情模块 + 记忆模块 + 主动搭话，各管各的 | **心智核心**：一个心智管记忆、情绪、身体、动机、性格和关系 |
| 接 QQ | 插件下载、启动、注入 Windows 版 SnowLuma | SnowLuma 没有 Mac 版：在 OrbStack / Docker 里跑它的官方镜像，插件只按填的 OneBot 地址去连；连不上时「一键诊断」顺着 OrbStack → 容器 → 端口 → 登录的号一项项查 |
| 翻唱环境 | PowerShell 下载、CUDA 版 PyTorch、一套环境 | curl + 自带解压；Apple 芯片用 MPS 加速；**两套环境**（换声、人声分离分开）；版本全部固定为实测跑通的组合 |
| 翻唱效果 | 分离 → 换声 → 混音 | 另加：本地原唱优先、去混响、拆主唱伴唱 / 男女对唱、按音色档案自动定调和挪八度、音色校正 |
| 语音兜底 | Windows 自带语音（System.Speech） | macOS 自带语音（`say`），不用装任何东西 |
| 发文件 | 网关和插件在同一台机器，按路径直发 | 网关在容器里看不到本机路径：小文件走 base64，**超过 30 MB 走只对本机开放的临时下载口** |
| 模块市场 | 原项目的模块库 | 同时读原项目的和[本分叉的模块库](https://github.com/Geng-zy/aurabot-qq-mac-mods)，同名的以本分叉配合心智核心的版本为准 |
| 提醒和通知 | 固定格式的文字 | 她用自己的话说（授权、等你选选项、加好友进群申请、翻唱失败） |
| 云备份 | 推送时不带心智（原项目没有心智核心） | 推到 Gitee / WebDAV 的包里一定有她的心智库，「只备份配置」也带 |

逐条的改动说明见 [更新记录](CHANGELOG.md) 和 [提交记录](https://github.com/Geng-zy/aurabot-qq-mac/commits/main)。

## 🗺️ 在一台 Mac 上怎么跑起来

<img src="assets/mac-architecture.svg" alt="QQ ⇄ OrbStack 里的 SnowLuma ⇄ Aurabot 插件 ⇄ DSH；翻唱环境在 ~/Aurabot/rvc" width="100%" />

## 🚀 安装

### 需要你自己装、自己设的（只有这些）

| 东西 | 用来做什么 | 说明 |
|---|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 桌面版 | 插件跑在它里面 | 在 DSH 设置里配好模型；想让她听懂语音条，再打开 DSH 的「语音输入」插件 |
| [OrbStack](https://orbstack.dev)（或 Docker Desktop） | 跑 QQ 网关 | 第一次打开按提示授权 |
| [SnowLuma](https://github.com/SnowLuma/SnowLuma.Docker.Framework) 容器 | QQ 网关（OneBot v11） | 用官方 docker-compose.yml 启动，在远程桌面（`http://127.0.0.1:6081`）登录机器人小号；NapCat、LLOneBot、Lagrange 等也可以 |
| [Homebrew](https://brew.sh) + `brew install ffmpeg` | 只给「刷 B 站时看视频画面」用 | 可选，不用这个功能就不用装 |

不用装 Python、Xcode 命令行工具、uv、Node、Git，不用改 PATH、不用设环境变量，也不用给任何 macOS 隐私权限。

### 步骤

1. 起好 SnowLuma 容器，登录机器人号。
2. **装插件**（在「终端」里运行），装完重启 DSH，左侧栏会出现 **Aurabot**：

   ```bash
   "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add github:Geng-zy/aurabot-qq-mac
   ```
3. **跟着设置向导走**：填机器人 QQ 号和你的 QQ 号，再填 OneBot 正向 WebSocket 地址（一般是 `ws://127.0.0.1:3001`）和令牌。建议先开着「试运行」。
4. 按需在面板里：翻唱页「一键安装」并导入音色、语音页「安装 edge-tts」、扫码登录 B 站 / QQ 空间、填生图接口。

**升级**：再运行一遍上面的安装命令，然后重启 DSH。设置、人格、记忆都会保留；从原项目或旧版本升级时，旧的记忆、心情、人物印象会在第一次启动时自动搬进心智核心。之后请在面板「人格与自我」里确认一次她的性格初始值。

## 🧰 各功能要什么

| 功能 | 需要 |
|---|---|
| 聊天、人格、心情、表情包、QQ 空间、主动找你 | 只要 DSH 里配好的模型 |
| 心智核心（记忆、情绪、身体、性格、关系） | SQLite，用 DSH 自带 Node 里的；后台整理用 DeepSeek（每天的 token 有上限，可调） |
| 想起意思相近的事、精排 | SiliconFlow 的密钥（bge-m3、bge-reranker-v2-m3 都免费）；不填也能用，只是只按字找 |
| 闲着时的内心活动（本地、不花钱） | 本地小模型（面板「内心」页一键安装，约 5 GB，用时约 6 GB 内存）；不装就用 DeepSeek，想得慢一些 |
| 看图 | 模型支持看图；大图先缩小（有 ffmpeg 用 ffmpeg，没有用 DSH 自带的 sharp） |
| 听语音条 | QQ 自带的转文字；不行再用云端识别（可选，SiliconFlow 的 SenseVoice 免费）或 DSH 的「语音输入」插件 |
| 发语音 | macOS 自带的 `say`（什么都不用装）；想更好听就装语音组件 edge-tts，或者用 Breeze 语音（填 Key 和音色）；CosyVoice / GPT-SoVITS / 自定义 HTTP 语音填你自己服务的地址 |
| 翻唱、语音条变声 | 翻唱环境（一键安装） |
| 刷 B 站 | 扫码登录（用你装好的 Google Chrome / Edge，后台打开、不弹窗）；看视频画面要 ffmpeg |
| 画图 | 生图接口（OpenAI 兼容接口或 Codex 订阅），或本地接口 |
| 发超过 30 MB 的文件 | 不用装，插件自带只对本机开放的临时下载口 |
| 云备份 | WebDAV（比如坚果云）直接能用；推到 Gitee 私有仓库要 git（终端里输 `git --version`，没有的话系统会提示装苹果的命令行开发者工具） |
| 模块市场里的模块（桌宠、抖音等） | 看各模块自己的说明 |

## 📁 插件装的东西放在哪

插件只往这三个地方放东西，都在你的用户文件夹里：

| 位置 | 放什么 |
|---|---|
| `~/.dsh/profiles/desktop/node_modules/dsh-aurabot-qq` | 插件代码（DSH 管理，升级时整个替换） |
| `~/.dsh/plugins-data/aurabot/` | 设置、人格、记忆、表情、日记、日志、翻唱缓存、你装的模块 |
| `~/Aurabot/` | `mind/` 共用的 uv 和 Python + 本地小模型、`rvc/` 翻唱环境、`pyenv/` 语音组件、`qq-chats/` QQ 会话工作区（位置可以在面板里改） |

**共用的 Python** `~/Aurabot/mind`：所有用 Python 的功能（心智核心的本地小模型、翻唱、语音组件）共用一份 uv 和 Python，各自建自己的环境，谁先装谁下载。

| 东西 | 版本 | 位置 |
|---|---|---|
| uv | 0.13.7 | `bin/uv` |
| Python（uv 下载的官方构建） | 3.13.18 | `python/` |
| 本地小模型的环境（mlx 0.32.4、mlx-lm 0.32.2，版本见 `requirements.lock`） | — | `env/` |
| 本地小模型：官方 Qwen/Qwen3.5-9B 下载后在本机转成 4 位（原版权重转完移到废纸篓） | — | `models/Qwen3.5-9B-mlx4` |

**翻唱环境** `~/Aurabot/rvc`（一键安装，约 5 GB，下载都核对校验值）：

| 东西 | 版本 | 位置 |
|---|---|---|
| Applio（RVC 换声）+ 自己的环境 | 3.7.1，torch 2.11 | `Applio/`、`Applio/.venv` |
| 人声分离环境 | audio-separator[cpu] 0.48.0、librosa 1.0.0、audioread 3.1.0、imageio-ffmpeg 0.8.1，torch 2.15 | `env/` |
| ffmpeg（翻唱专用）、Rubber Band 4.0.0 官方版 | — | `bin/` |
| 模型：rmvpe、contentvec；分离模型 BS-Roformer Leap Xe 和去混响 / 拆主唱伴唱 / 分男女声 3 个增强模型 | 固定版本 | `Applio/rvc/models/`、`separator-models/` |
| 你导入的音色和生成的音色档案 | — | `models/` |

装好后导入你有权使用的 RVC 音色（.pth / zip）就能点歌；再用这个音色本人的干声数据集生成「音色档案」，就能自动定调和校正音色。

**语音组件** `~/Aurabot/pyenv`：edge-tts 7.3.1，用上面共用的 Python 3.13.18 和 uv（还没有的话会自己下载到 `~/Aurabot/mind`）。

插件不碰系统的 Python，不往 `~/.cache`、`~/.local` 等系统默认位置留缓存。

## 🧑‍💻 开发

```bash
git clone https://github.com/Geng-zy/aurabot-qq-mac.git
cd aurabot-qq-mac
npm test        # 全部测试；Mac 相关的在 test/macos.test.js、test/file-relay.test.js、test/song-pipeline.test.js
```

需要 Node.js ≥ 22.13.0。插件内部名字保持 `dsh-aurabot-qq` 不变（DSH 靠它找数据目录 `~/.dsh/plugins-data/aurabot`），从原项目换过来不会丢数据。

原项目的文档同样适用：[用户手册](docs/USER-MANUAL.md) · [写模块教程](docs/MODULE-TUTORIAL.md) · [模块 API](src/modules/API.md) · [设计要点](docs/DESIGN.md) · [更新记录](CHANGELOG.md)。

## 📄 License & 致谢

[MIT](LICENSE)，原项目的版权声明保留不变。

- Aurabot 的全部原有功能来自 [aureth-labs/dsh-aurabot-qq](https://github.com/aureth-labs/dsh-aurabot-qq) 及其贡献者。
- 原项目致谢：参考了 [Yuuyuko-uu](https://github.com/Yuuyuko-uu) 的 dsh-qq-bridge 等插件在 DSH 插件机制上踩过的坑；旧版人物记忆的设计来自 [Emotionana](https://github.com/Emotionana) 的 persona-memory（心智核心会把它攒下的印象搬过来）。
- 心智核心的各项默认值来自公开研究（面板「心智设置」每项都写着出处）；本地小模型用 [Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B)，经 [MLX](https://github.com/ml-explore/mlx) / [mlx-lm](https://github.com/ml-explore/mlx-lm) 运行。
- 翻唱用到 [Applio](https://github.com/IAHispano/Applio)、[python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator)、[Rubber Band](https://breakfastquay.com/rubberband/)，主分离模型 [BS-Roformer Leap](https://huggingface.co/pcunwa/BS-Roformer-Leap)（unwa）；QQ 网关 [SnowLuma](https://github.com/SnowLuma/SnowLuma)。
