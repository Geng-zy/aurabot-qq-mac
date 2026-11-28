<div align="center">

<img src="assets/platform-banner.svg" alt="AuraBot for macOS: multi-platform, memory, voice and creation" width="100%">

# AuraBot for macOS

**把大肥鱼接入 QQ 和 Telegram，让她在不同会话里延续同一份记忆、心情和关系。**

DeepSeek Harness 插件 · Apple 芯片 Mac · 多平台适配器 · OneBot v11

[![Release](https://img.shields.io/github/v/release/Geng-zy/aurabot-qq-mac?style=flat-square&label=release)](https://github.com/Geng-zy/aurabot-qq-mac/releases/latest)
[![Tests](https://img.shields.io/badge/tests-1572%20passing-brightgreen?style=flat-square)](#开发与测试)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-339933?style=flat-square&logo=node.js&logoColor=white)](package.json)
[![License](https://img.shields.io/badge/license-MIT-2e7763?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-QQ%20%7C%20Telegram-588b78?style=flat-square)](#平台)

[下载最新版](https://github.com/Geng-zy/aurabot-qq-mac/releases/latest) · [快速安装](#快速安装) · [核心能力](#核心能力) · [使用手册](docs/USER-MANUAL.md) · [English](README_EN.md)

</div>

<img src="assets/platform-architecture.svg" alt="AuraBot 平台架构：DSH、ChannelManager、QQ/Telegram 适配器与共享层" width="100%">

> 上图是平台架构示意；界面截图见 [docs/screenshots](docs/screenshots)。

## 这是什么

AuraBot 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 macOS 插件。它把聊天平台、人格与记忆、模型调用、语音与创作能力接在一个工作台里，并且让所有平台共用同一套心智。

这一版的重点不是再堆一个功能，而是把“她”做成一套可持续运行的系统：

```text
DSH 宿主
   ↓
AuraBot Host
   ↓
ChannelManager
   ├── QQ Adapter        OneBot v11 / 正向 WebSocket
   ├── Telegram Adapter  长轮询 Bot API
   └── 后续平台 Adapter
   ↓
共享层：聊天中枢 / 心智 / 记忆 / 知识库 / 表情 / 语音 / 生图 / 模块
```

平台只负责连接、消息转换和发送；QQ 专属能力收在 `src/channels/qq/features/`，不会污染通用模块。

## 1.7.8 更新

### 中途换预设真的会被记录（B19）

- 宿主的 `agent-preset/selected` 事件现在会被接住并写入「当前预设」——而且放在聊天映射兜底之前，否则换预设早于任何聊天事件时会被丢掉。
- 修掉一处键不一致：hub 的 `sessionKey` 会剥掉 `session-` 前缀，此前「记录用剥过的、查询用原始的」，换过预设的会话会退回读创建时的 header（过期值）。现在三处共用同一归一化。
- 会话卸载时清掉记录，表不再只增不减。

### 前几批

1.6.59 挂载决策纯函数；1.6.58 rc.3 宿主取证；1.6.55 发布事务独立；1.6.54 路径安全层独立；1.6.53 恢复路径补直测；1.6.52 云备份后端分家；1.6.51 hub 纯函数下沉；1.6.50 终验；1.6.49 清单闸门；1.6.48 当前预设；1.6.47 宿主工具发现加固；1.6.46 本地脚本信任链；1.6.45 表单小工具；1.6.44 面板样式；1.6.43 适配层门面化；1.6.42 心智越界归位；1.6.41 backup 拆 ZIP；1.6.40 core 反向依赖 10→0；1.6.39 config 拆分；1.6.38 修线上潜伏 bug；1.6.37 zip 去重；1.6.36 会话事件；1.6.35 单一注意力；1.6.34 渠道契约；1.6.33 写操作闸；1.6.32 组合根；1.6.31 语音条 + 清单。

逐版变更见 [CHANGELOG](CHANGELOG.md)。

## 能力细节

### 同一只鱼

- 记忆、情绪、人格和关系继续跨会话共享。
- 出站隐私、分享、提醒和面板仍按会话边界过滤，不会把另一个私聊的内容直接带出去。
- 修复了跨分片 UTF-8 解码、Host 白名单、POSIX 会话目录、头像上传上限、QQ WebSocket 超时等运行问题。

### 群聊秘书闸

- 可选：先用便宜模型判断一段群聊值不值得叫主模型。
- 所有平台群聊通用；`@`、引用、叫名字的必回消息不经过闸。
- 支持全局配置、按群覆盖、按群开关、最近判断日志、持久化统计和按天汇总。
- 面板路径：`QQ 会话 → 回复规则 → 群聊秘书闸 / 最近秘书判断`。

### 知识库

- `data/knowledge/raw` 与 `data/knowledge/notes`，支持 Markdown / txt。
- 按 `all / private / group / 具体会话` 控制可见范围。
- 面板支持浏览、全文搜索、高亮、分页、预览、写笔记、导入单文件、导入文件夹并保留目录、改名和删除。
- 模型工具：`knowledge_search`、`knowledge_read`、`knowledge_note_create`。

### 表情库

- 保留 QQ 小黄脸、QQ 收藏表情和 QQ 商城 `mface`。
- 通用表情库支持 MD5 精确去重和 dHash 近似去重。
- 可选统一转 WebP；同一名字支持多变体和主图。
- 跨平台发送时按平台能力降级，QQ 商城表情不会硬塞给其他平台。

### 生图

支持以下 provider：

```text
openai
seedream（豆包）
xai
gemini
sensenova
comfyui
custom
codex
local
```

- ComfyUI 直连支持 API workflow、提示词节点、LoadImage 参考图、输出节点和轮询。
- 面板可做真实连通性测试，失败原因持久化，成功后自动清除。
- 自定义接口支持 URL 占位符、参考图和响应路径。

### 平台与稳定性

- QQ：私聊、群聊、引用、合并转发、语音收发、文件、贴表情、群管、好友/加群申请、改资料、QQ 空间。
- Telegram：长轮询、文字、回复、图片上传（base64 图走 multipart）。
  能力位只声明规范项；超时/网络/5xx 标 `uncertain`（可能已发出，不重复发），4xx 视为确定失败。
- 其他平台通过 `PlatformAdapter` / `ChannelManager` 继续接入。
- 所有 JSON 数据（配置、会话映射、任务、用量）都走同一处原子写：先写唯一临时文件再 rename，
  失败会清掉临时文件；`配置` 这类丢了很疼的文件额外 fsync 落盘，热点路径默认不 fsync 保速度。
- 统一使用 `caps`：能力位只写 `CAPS` 里的规范项，声明 `true` 就必须真有对应方法（注册时校验）。没有原生能力时降级或跳过，不破坏平台边界。

## 平台

| 平台 | 当前能力 | 配置位置 |
| --- | --- | --- |
| **QQ** | 私聊、群聊、引用、合并转发、语音收发、文件、贴表情、群管、好友/加群申请、改资料、QQ 空间 | `QQ 会话` |
| **Telegram** | 长轮询、文字、回复、图片（base64 图片走 multipart 上传） | `平台 → Telegram` |
| **其他平台** | 通过 `PlatformAdapter` / `ChannelManager` 继续接入 | 后续按平台扩展 |

## 核心能力

| 功能 | 你可以怎么用 |
| --- | --- |
| **私聊与群聊** | 按白名单开放会话，设置群聊回应、主动插话和连发合并；支持引用、合并转发和语音识别。 |
| **记忆、情绪与关系** | 把聊天整理成经历，按日期、关键词或语义回想；查看记忆来源、关系变化和私聊可见范围。 |
| **群聊秘书闸** | 用轻量模型先在群里判断是否接话，减少无意义的主模型调用。 |
| **知识库** | 把设定、资料和笔记放进可检索的资料库，并按会话控制可见性。 |
| **念头与行动** | 查看内心日记、愿望和行动状态；结合近况、精力与动机决定是否主动联系你。 |
| **语音与创作** | 发语音、使用表情包、翻唱、画图、生视频；按需接入本地或在线服务。 |
| **QQ 空间** | 写说说、预览配图、按可见范围发布，归档公开浏览图并处理空间互动。 |
| **扩展与维护** | 在 DSH 内管理模块、日志、用量和备份；模块库只安装本分支兼容模块。 |

## 快速安装

**需要：** Apple 芯片 Mac、[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 桌面版、DSH Desktop `0.2.2-rc.3`（当前唯一兼容目标）。QQ 还需要一套 OneBot v11 网关（如 [SnowLuma](https://github.com/SnowLuma/SnowLuma.Docker.Framework)）和单独的机器人 QQ 号。

1. 打开 DSH 完成初始化，并配置聊天模型。
2. 从 [Releases](https://github.com/Geng-zy/aurabot-qq-mac/releases/latest) 下载 `dsh-aurabot-qq-1.7.8.tgz`。
3. 完全退出 DSH，在终端安装：

   ```bash
   dsh="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
   "$dsh" plugin --profile desktop -- add "file:$HOME/Downloads/dsh-aurabot-qq-1.7.8.tgz" --offline
   ```

4. 重开 DSH，从左栏进入 **Aurabot**。
5. QQ：在 `QQ 会话 → 连接` 填 OneBot WebSocket 地址和令牌，再填机器人号与管理员号。
6. Telegram：在 `平台 → Telegram` 填 Bot Token、管理员 ID 和白名单。
7. 先用「试运行」验证回复，确认连接和白名单后再切「正式模式」。

更新时下载新版本的 `.tgz`，用同一命令安装并重启 DSH。插件代码与个人数据分开保存。

[完整设置与排障](docs/USER-MANUAL.md) · [版本更新记录](CHANGELOG.md)

## 界面导览

右上角用 **⌥ K** 搜索功能和设置。再次点击当前分组可收起子页；内心日记、愿望、记忆和知识库等长列表默认收起。界面动效遵循系统的「减少动态效果」设置。

设置多的页面（白名单、回复规则、语音、生图……）在标题上方有一条**分区锚点条**：点一下就展开对应分区并滚过去，当前分区标在条上，不用在长页里滚着找。窄窗口时侧栏变顶部横条、页签与分区条都能横向滑动。动作结果（保存、试听、安装进度）由窗口层统一提示，切页或关面板也不会丢。

每个页面在三种情况下都有明确交代：**载入中**显示骨架屏（超过 300ms 才出现，不闪）、**读不到**在页面里就地给出错误块（可重试、可复制诊断，Toast 不会被用来顶替它）、**还没有内容**给教学式空态（说清为什么空，并给一个下一步动作）。改设置时底部出现保存条：有改动 → 保存中 → 已保存，**⌘S** 随时保存；只有开关类设置即时生效。

心智设置这类逐项保存的页面，**数字超出范围会当场标红并且不提交**（错误写在这一行上，不是弹一下就消失的提示），改回范围里立刻生效；每项都能展开看默认值和依据，也能单独恢复默认。

| 想做什么 | 从哪里进入 |
| --- | --- |
| 查刚刚发生的事或调整隐私 | 心智 → 记忆（读不到时页面里直接给重试，不用刷新） |
| 看人物关系或内心日记 | 心智 → 关系 / 念头与行动 |
| 看资料、写笔记或控制知识可见范围 | 心智 → 知识库 |
| 修改人设、性格设置和后台预算 | 自我与设置 |
| 配置 QQ 连接、白名单或空间日记 | QQ 会话（连接页可一键诊断；白名单里的号码当场校验） |
| 配置 Telegram | 平台 → Telegram（平台连接页列出所有适配器与能力） |
| 配置语音、生图、表情或翻唱 | 表达与创作（模块关着时页面会直接说明并给「去模块管理」） |
| 看日志、备份或接入自定义脚本 | 系统（导入备份会在原地二次确认，不会弹一个挡住全屏的对话框） |

<details>
<summary>查看关系页和功能搜索截图</summary>

<p><strong>人物关系</strong> · 在人物卡查看称呼、印象、亲近与信任，或切换到星图。</p>
<img src="docs/screenshots/aurabot-relationships.png" alt="关系页" width="100%">

<p><strong>设置搜索</strong> · 输入「向量」，可直接到记忆页并展开「向量检索与精排」。</p>
<img src="docs/screenshots/aurabot-search.png" alt="功能搜索" width="100%">

<p><strong>工作台</strong> · 左侧按用途分组，面包屑标出当前页，顶部是功能查找与运行模式。</p>
<img src="docs/screenshots/aurabot-workbench-overview.png" alt="工作台概览" width="100%">

<p><strong>分区锚点条</strong> · 长页面顶部的分区胶囊，点一下展开并滚过去，当前分区高亮。</p>
<img src="docs/screenshots/aurabot-section-nav.png" alt="分区锚点条" width="100%">

<p><strong>她现在</strong> · 身体、心情、此刻感受一屏看完；读不到时页面里给重试。</p>
<img src="docs/screenshots/aurabot-mind-now.png" alt="她现在" width="100%">

<p><strong>心智组的空态</strong> · 还没认识谁时不是一句「暂无」，而是说明原因并给出下一步。</p>
<img src="docs/screenshots/aurabot-mind-empty.png" alt="关系页空态" width="100%">

<p><strong>心智设置</strong> · 按分类看参数，每行写着默认值与依据，可以单独恢复默认。</p>
<img src="docs/screenshots/aurabot-mind-settings.png" alt="心智设置" width="100%">

<p><strong>连接</strong> · 一键诊断逐项给出结果；没填网关地址时先给一条可点的空态。</p>
<img src="docs/screenshots/aurabot-connect.png" alt="连接与诊断" width="100%">

<p><strong>白名单</strong> · 不是有效号码的项当场标出、留在框里待改，不会被悄悄存进去。</p>
<img src="docs/screenshots/aurabot-whitelist.png" alt="白名单" width="100%">

<p><strong>表情包</strong> · 真实表情库，可以改名字标签，也可以让能看图的模型批量起名。</p>
<img src="docs/screenshots/aurabot-stickers.png" alt="表情包" width="100%">

<p><strong>翻唱</strong> · 六项组件体检 + 一键安装进度；缺什么一眼能看到。</p>
<img src="docs/screenshots/aurabot-song.png" alt="翻唱" width="100%">

<p><strong>备份与恢复</strong> · 状态卡说明现在能不能导、导入后会发生什么；危险动作（导入、覆盖、删除、推送、重开）都在页内原地确认，不弹遮住全屏的对话框。</p>
<img src="docs/screenshots/aurabot-backup.png" alt="备份与恢复" width="100%">

<p><strong>模块管理</strong> · 内置与自装模块开关、报错可展开；模块面板崩了只坏它自己。</p>
<img src="docs/screenshots/aurabot-modules.png" alt="模块管理" width="100%">

<p><strong>读不到时</strong> · 错误留在页面上，带「重试」和「复制诊断」，不靠 Toast 顶替。</p>
<img src="docs/screenshots/aurabot-error-state.png" alt="错误态" width="100%">

<p><strong>还没有内容时</strong> · 空态说清原因，并给一个能立刻做的动作。</p>
<img src="docs/screenshots/aurabot-empty-state.png" alt="空态" width="100%">

</details>

## 按需配置本地模型

- **记忆检索**：在线默认使用硅基流动 `BAAI/bge-m3`，可开启 `BAAI/bge-reranker-v2-m3` 精排；也可切换到随包离线中文向量模型或关键词检索。
- **本地小模型**：在「自我与设置 → 设置 → 本地模型」按需安装 Qwen3.5-9B 和 MLX 运行环境。
- **本地生图**：Apple 芯片 + macOS 26 或更新版本可一键部署 MFLUX 与 Qwen Image 2.1；也支持自定义脚本和兼容的在线接口。
- **语音与翻唱**：在「表达与创作」里按需安装或接入本地/在线服务。

## 项目结构

```text
src/
  channels/
    adapter-facade.js      统一 PlatformAdapter 外形
    registry.js            平台注册表
    manager.js             ChannelManager
    qq/                    QQ 适配器
      transport.js         OneBot 连接
      convert.js           消息转换
      features/            QQ 群管、资料、空间、语音、表情等
    telegram/              Telegram 适配器
  chat/                    聊天中枢、规则、输出、秘书闸
  mind/                    心智核心
  mind-adapter/            DSH 对接层
  modules/                 跨平台业务模块
  features/                通用能力
    knowledge.js           知识库
    sticker-hash.js        dHash / WebP
    imagegen.js            生图 provider
  core/                    配置、模块、存储、安全
client/                    面板 UI
test/                      离线测试与回归
docs/                      设计、手册、迁移与审计
```

## 开发与测试

需要 Node.js ≥ 24.0.0。

```bash
npm test          # node --test，离线：fake DSH + mock OneBot + 临时目录
npm run check     # 全仓语法检查
npm run lint      # oxlint src client
npm run build:client   # 改过 client/parts 后重新生成 client/client.js
```

当前回归（实测）：

```text
558 个文件语法检查通过
1572 个测试通过，0 失败，0 跳过
oxlint 0 error / 165 warning
```

仓库不自带 Node 与 oxlint 的二进制时，用宿主自带的那份：

```bash
export PATH="$PWD/.dsh/tools/bin:$PATH"
dsh-node --test --test-concurrency=1 --test-timeout=120000 "test/**/*.test.js"
oxlint src client
```

也提供离线心智回放：

```bash
npm run mind:replay
npm run mind:privacy
```

## 数据与安全

| 位置 | 内容 |
| --- | --- |
| `~/.dsh/plugins-data/aurabot/` | 设置、人格、记忆、知识库、日志与模块数据 |
| `~/Aurabot/` | 默认 QQ 工作区和本地念头、语音、翻唱环境 |

- 平台 token、API key、WebDAV 密码等不会回传到面板。
- 工具按平台 `caps` 降级，不支持的平台不会收到平台专属格式。
- 群聊本机工具默认关闭，只允许管理员发言的轮次使用。
- 安装模块前请核对来源；模块和插件在同一进程运行，能力声明不是沙箱。

## 来源与许可

本仓库由 [Geng-zy](https://github.com/Geng-zy) 维护，fork 自 [aureth-labs/dsh-aurabot-qq](https://github.com/aureth-labs/dsh-aurabot-qq) v1.2.0。QQ 聊天、语音、表情、翻唱、QQ 空间和模块系统承自上游及其贡献者。

许可证：[MIT](LICENSE) · 第三方素材与署名：[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)

[使用手册](docs/USER-MANUAL.md) · [功能、设计与实现](docs/FEATURES-AND-IMPLEMENTATION.md) · [维护交接](docs/HANDOFF.md) · [外部验收清单](docs/EXTERNAL-ACCEPTANCE.md) · [模块开发教程](docs/MODULE-TUTORIAL.md) · [模块 API](src/modules/API.md) · [macOS 模块库](https://github.com/Geng-zy/aurabot-qq-mac-mods)
