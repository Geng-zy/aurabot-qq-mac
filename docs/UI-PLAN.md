# Aurabot 工作台 · UI 盘点与设计规划（Operate）

> 本轮只做盘点与设计记录，不改任何 UI 代码。基准：DSH Desktop **0.2.2-rc.3**、Aurabot **1.6.99**。
> 项目暂无 `PRODUCT.md` / 视觉世界（`docs/DESIGN.md` 是实现文档），因此本文把「产品上下文」写成显式假设（§0），
> 并建议后续用 `/impeccable init` 补一份真正的 PRODUCT.md；本轮不阻塞于它。
>
> 模式：**Operate** —— 用户在工作台里完成任务（配置机器人、看她此刻的状态、点歌/生图/装模块），
> 成功标准是「快速找到并改对一项设置」，不是表达。因此：熟悉度优先、控件统一、状态齐全、动效只表意。

---

## 0. 产品上下文（显式假设，待 PRODUCT.md 覆盖）

| 项 | 假设 | 依据 |
|---|---|---|
| 用户 | 一个人（管理员）在自己电脑上养一个 QQ 机器人「大肥鱼」 | README、docs/USER-MANUAL.md |
| 核心任务 | 接上网关 → 调性格/记忆/回复 → 开模块（语音/表情/生图/翻唱）→ 看日志与备份 | 28 页导航分组 |
| 使用场景 | 长时间停留、边聊边调、改完立刻看效果；偶尔排障 | 保存条 + 5 秒轮询 + 日志页 |
| 语言 | 简体中文；技术名词保留英文（RVC / ComfyUI / WebSocket） | 全量文案 |
| 平台 | macOS 桌面（DSH Desktop 内嵌）；小屏为侧栏折叠 | `.ab-workspace` 断点 |

---

## 1. 方法与证据

| 证据类型 | 怎么取的 | 产物 |
|---|---|---|
| 源码事实 | `client/`（104 个 part、`client.template.js` 280 行装配）、`src/modules/*` | §2 |
| **实际渲染（组件树级）** | 用客户端自身的组件 + 真机 state 快照渲染：28 页中 23 页可完整展开 | `/tmp/panel-inventory.json`；§2.2 表 |
| 真机数据 | Mini：`GET /state`（12 个内置模块、49 人、19 特质、51 个配置键）、`/song/status`、`/mind/state` | §2.4、§2.5 |
| 宿主能力 | rc.3 包内 `*/src/client/contract/slots.ts`、`dsh-client-ui-theme`、primitives 依赖声明 | §3 |
| **宿主壳实际渲染** | Air 上 `dsh web --port 58001` + Playwright（Chrome channel）截图 | `/tmp/pw/home.png`、`/tmp/pw/plugins.png` |

> 说明：Air 上已能用 Playwright 驱动 DSH Web（已取宿主壳、插件列表两图）。但 **Aurabot 工作台本体**在 web profile 里
> 需要「插件开关 → 重启」两步才出现，本轮开关未能持久化，因此工作台本体没有像素级截图 ——
> 这是 §6 的 B0 第一条要解决的事（脚本化启用 + 截图基线）。

---

## 2. 现状盘点

### 2.1 信息架构（9 组 / 28 页）

| 组 | 页数 | 页面 |
|---|---|---|
| 概览 | 1 | 概览 |
| 心智 | 5 | 她现在 · 记忆 · 知识库 · 关系 · 念头与行动 |
| 自我与设置 | 2 | 人格与自我 · 设置 |
| 平台 | 1 | 平台连接 |
| QQ 会话 | 6 | 连接 · 白名单与权限 · 回复规则 · 聊天模型 · 语音识别* · QQ 空间* |
| 表达与创作 | 5 | 语音合成* · 表情包* · 生图* · 翻唱* · 生视频* |
| 系统 | 6 | 日志 · 备份与恢复 · 安全防护 · 浏览器 · 本地接口 · 关于 |
| 扩展 | 2 | 模块管理 · 模块库 |

`*` = 需模块在跑（`voice`/`diary`/`stickers`/`imagegen`/`song`/`video`）。18 页另有**页内分区索引**（`FIND_SECTIONS`），
供顶部「功能查找」直接跳到某个折叠分区。

### 2.2 每页的区块与控件（实际渲染统计）

| 组 | 页面 | 卡片 | 表单行 | 卡片标题 |
|---|---|---|---|---|
| home | 概览 `[overview]` | 0 | 0 | — |
| mind | 她现在 `[now]` | 1 | 0 | 她现在 |
| mind | 记忆 `[mood]` | 2 | 5 | 向量检索与精排、聊天流水保留 |
| mind | 知识库 `[knowledge]` | 3 | 3 | 知识库文件、全文搜索、写一篇笔记 |
| mind | 关系 `[persona]` | 0 | 0 | — |
| mind | 念头与行动 `[inner]` | 1 | 0 | 内心 |
| identity | 人格与自我 `[selfmind]` | 1 | 0 | 人格与自我 |
| identity | 设置 `[mindsettings]` | 1 | 0 | 设置 |
| platforms | 平台连接 `[platforms]` | 2 | 6 | 平台连接、Telegram |
| qq | 连接 `[connect]` | 0 | 0 | — |
| qq | 白名单与权限 `[access]` | 3 | 10 | 私聊与群白名单、管理员与私聊权限、DSH 授权与通知 |
| qq | 回复规则 `[group]` | 0 | 0 | — |
| qq | 聊天模型 `[model]` | 2 | 3 | 聊天用的模型、模型列表与测速 |
| qq | 语音识别 `[asr]` | 1 | 7 | 听语音（语音转文字） |
| qq | QQ 空间 `[diary]` | 3 | 4 | 空间日记、现在写日记、发布历史 |
| media | 语音合成 `[voice]` | 1 | 8 | 说话（文字转语音） |
| media | 表情包 `[stickers]` | 0 | 0 | — |
| media | 生图 `[imagegen]` | 1 | 11 | 让ta画图 |
| media | 翻唱 `[song]` | 0 | 0 | — |
| media | 生视频 `[video]` | 1 | 1 | 本地接口 |
| system | 日志 `[logs]` | 1 | 0 | 日志 |
| system | 备份与恢复 `[backup]` | 0 | 0 | — |
| system | 安全防护 `[security]` | 4 | 4 | 危险命令确认、SSRF 防护、远端管理（反代部署）、其它内置防护 |
| system | 浏览器 `[browser]` | 1 | 1 | 使用 DSH 侧边浏览器 |
| system | 本地接口 `[local]` | 1 | 1 | 本地接口 |
| system | 关于 `[about]` | 3 | 0 | AuraBot for macOS、模块来源、来源与许可 |
| extensions | 模块管理 `[modules]` | 0 | 0 | — |
| extensions | 模块库 `[market]` | 1 | 0 | AuraBot 模块库 |

合计：**34 张卡片、64 个表单行、5 页有折叠分区（8 个）、8 页有空态**。
5 页（`persona`/`connect`/`group`/`stickers`/`backup`）在「无子接口数据」时渲染抛错 —— 它们各自 `get()` 了额外接口
（`/mind/people`、`/onebot/diagnose`、`/chat/secretary/export`、`/panel/faces`、`/backup/state`），说明**页面数据依赖不是统一模型**。

### 2.3 覆盖层（弹窗 / 浮层 / 条）

| 类型 | 现状 | 位置 |
|---|---|---|
| 首次设置向导 | 4 步（你们的 QQ 号 / 接网关 / 连机器人号 / 完成），整页占位不是模态 | `wizard.js`、`WIZ_STEPS` |
| 保存条 | 有未保存改动时从底部出现：提示 + ⌘S + 撤销 + 保存 | `aurabotPage.js` `.ab-savebar` |
| Toast | 动作结果，2.2 s，错误自动识别关键字变红 | `primitives().Toast` |
| 页内错误提示 | `role="status"` 的 warn 条（读不到状态时） | `.ab-note.warn` |
| 下拉框 | 自绘 listbox（键盘可走、aria 齐全） | `select.js` |
| 折叠分区 | `<details>` + 标题栏（「高级项」默认收起） | `card.js` `fold` |
| 删除确认 | 各页就地二次点击/文案确认，**没有统一确认弹窗** | 分散 |

结论：**没有模态对话框体系**，覆盖层只有「向导整页 + Toast + 保存条」。这与 Operate「少用模态」一致，值得保留。

### 2.4 扩展 UI（模块面板）

- 机制：模块可在 `settings[]` 声明字段（switch/number/select/textarea/password/text），面板自动生成表单；
  也可提供 `panel`（自定义面板），由 `ExtPanel` 渲染并内嵌在对应页。
- 真机现状：12 个内置模块**全部无 `panel`、无 settings 字段**（0 个扩展自定义面板），扩展现状 = 设置表 + 状态徽标。
- 缺口：扩展面板没有统一的加载/错误/空态外壳；`errors[0]` 只显示最近一条。

### 2.5 状态反馈现状

| 反馈 | 现状 | 问题 |
|---|---|---|
| 加载 | 页面级空白直到 `/state` 返回；子接口各自 loading 布尔 | 无骨架屏；慢接口先闪空态再出内容 |
| 错误 | 顶层 `err` 一条；子接口错误多被吞成空数组 | 用户看不到「哪一块失败了」 |
| 空态 | `Empty`：一个大 emoji + 一句话，8 页在用 | 不教学：多数只说「还没有 X」，不给下一步 |
| 脏标记 | 按页算 `tabDirty`，rail 与页导航显示未保存点；⌘S 保存；5 秒轮询 + 写锁 | 边界复杂（轮询与草稿） |
| 危险操作 | 安全防护页有独立确认卡；其它页就地确认 | 不一致 |
| 主题 | 单一调色板 + `body[data-ds-dark-theme]` 深色；4 个容器断点 | 与宿主 token 无对齐；颜色硬编码在 634 行 CSS |

### 2.6 盘点结论（要解决的问题）

1. **导航**：纵向 rail + 二级页导航 + 页内折叠 + 顶部查找，四套定位并存，新手要学两遍。
2. **控件不统一**：`Btn`/`Switch` 用宿主 primitives，`Select`/`Seg`/`Choices`/`Range` 自绘，两套语汇。
3. **状态三缺一**：加载缺骨架、错误缺就地、空态缺教学。
4. **数据依赖不统一**：23 页读 `/state`，另 5 页各自拉子接口 → 加载/错误粒度不可控。
5. **主题不可换**：颜色写死在单个 CSS 字符串里。
6. **扩展 UI 没有外壳**：模块面板插进页面后与主页面视觉不连续。

---

## 3. rc.3 能力边界（方案只能落在这里面）

### 3.1 Slots

| slot | kind | 我们能怎么用 |
|---|---|---|
| `main` | keyed（root） | **当前就用**：`key: 'aurabot'` 整块工作台 |
| `sidebar.panellist` | list | **当前就用**：侧栏图标入口（`order: 20`） |
| `sidebar.panellist.actions` | list | 面板列表「更多」里加条目（重开工作台 / 导出配置） |
| `settings.section` + `settings.section.icon` | list | **新增入口候选**：把「Aurabot 设置」嵌进宿主设置页（B3 评估） |
| `settings.plugins.tab` | list | 插件页 tab（放模块管理入口） |
| `settings.general.item` / `settings.action` / `settings.onboarding` | list | 设置页条目/动作/引导 |
| `shell.overlay` | list（root） | **全局 Toast/状态药的正确位置**（当前 Toast 挂在面板内） |
| `shell.bottom` | single | 全宽底栏（不放工作台内容） |
| `conversation.composer.*` / `conversation.input.*` | list/single | 聊天里的快捷入口（如「现在点一首」） |
| `sidebar.brand.mark` / `brand.name` | single | 品牌块（不建议动） |

要点：`main` 是 **keyed 面板**（一个 id 一块整页），`sidebar.panellist` 是 **一个 id 一个图标**；工作台内部多页导航仍是我们的自由。

### 3.2 UI primitives

- 运行时 `require('@deepseek-ai/dsh-client-ui-primitives')`，宿主版本 **0.2.2-rc.3**；缺包时面板显示降级页。
- 当前已用：`Button`、`Switch`、`Toast`、`writeClipboard`、`isDarwinDesktop`。
- **未探明**（B0 要枚举）：`Checkbox`/`Radio`/`Tooltip`/`Popover`/`Dialog`/`Tabs`/`Table`/`Skeleton`。
  在拿到清单前，新控件一律按「自绘 + 宿主 token」设计，不依赖未探明 API。

### 3.3 主题

- `dsh-client-ui-theme` 暴露 `ThemeDefinition` / `ThemeTokens` / `ThemeKey` / `ThemeTokenOverrides`；
  字体类 token 已知：`--dsh-font-family-text-default`、`--dsh-font-family-code-default`、`--dsh-content-font-size-*`、`--dsh-scrollbar-*`。
- 深色：本插件靠 `body[data-ds-dark-theme]`；宿主另有 `ThemePreference`（跟随系统/浅/深）。
- 结论：**保留 Aurabot 语义层，但值改为「引用宿主 token + 自有回退」**，并把 634 行 CSS 拆成
  `tokens / base / components / pages / dark` 五段（构建期拼接，产物仍单文件）。

---

## 4. 设计方向（Operate）

### 4.1 全局导航（四套定位收敛为两级 + 一处查找）

- **一级**：左侧 rail 9 组（保留），组名不变，图标统一 16px，选中态左侧 2px 强调条（现有）。
- **二级**：组内页 = rail 展开列表（保留）+ **页内 sticky 锚点条**（新增，与 `FIND_SECTIONS` 同源）。
  折叠分区不再作为唯一分区手段：折叠只留给「高级项」，普通分区默认展开 + 锚点跳转。
- **顶部条**：面包屑（组 / 页）+ 功能查找 + 运行态（启用 / 试运行 / 调试）+ 保存态。
- **小屏**（<660px）：容器查询切成顶部横向页签（宿主 `sidebar` 已负责宿主侧折叠）。
- **高频页**（关系 / 设置）：加「置顶到 rail」能力，减少两次点击。

### 4.2 主题

- 三层：**宿主 token**（字体/滚动条/尺寸）→ **Aurabot 语义 token**（约 14 个：`--ab-surface/-card/-text/-dim/-line/-accent/-ok/-warn/-err/-focus/-hover/-rail/-rail-ink/-radius`）→ 组件类。
- 深色只覆盖这 14 个值；组件里禁止出现十六进制颜色（CI 用 grep 断言，白名单仅 token 文件）。
- 对比度：正文与次要文字 ≥ 4.5:1（`--ab-dim` 需复核），焦点环 3:1、2px。
- 焦点可见：全站 `:focus-visible` 统一 2px `--ab-focus`。

### 4.3 公共控件（一套语汇，七种状态）

| 控件 | 统一到 | 状态 |
|---|---|---|
| Card（含 fold） | 现有 `Card` | default / hover / focus / collapsed |
| Row（标签+说明+控件） | 现有 `Row` + 新增 `error`/`hint` | default / disabled / error / hint |
| Button | 宿主 `Button`（primary/ghost/outline）+ danger 走 outline 红 | default/hover/focus/active/disabled/loading |
| Switch | 宿主 `Switch` | on/off/disabled/loading |
| Select | 自绘 listbox（已合规） | closed/open/active/disabled/error |
| Seg / Choices | 合并为一个 `Choices`（分段 / 卡片两密度） | selected/disabled |
| Range | 自绘 + 数值 | default/disabled |
| Field（input/textarea）**新增** | 统一 label/hint/error/计数 | default/focus/invalid/disabled/readonly |
| Empty **升级** | `Empty(icon,title,desc,action)` | — |
| ErrorBlock **新增** | 就地错误 + 重试 + 复制诊断 | — |
| Skeleton **新增** | 卡片/行/头像三种 | — |
| Badge / StatusDot | 模块状态、连接状态、保存态共用 | ok/warn/err/off/busy |

### 4.4 表单与保存

- 保持**草稿 + 显式保存**（配置项互相影响，自动保存会写出半套状态）。
- 保存条三态：`有改动未保存`（出现）→ `保存中`（按钮 busy）→ `已保存`（淡出）；⌘S 常驻。
- 字段级校验：`Row` 支持 `error`；保存前跑 `validate(draft)`，滚动并聚焦第一个错误。
- 离开提醒：跨页/关面板用保存条 + rail 未保存点（现有），**不弹模态**。
- 即时保存只留给开关类（模块启停、启用/试运行），UI 上标注「即时生效」。

### 4.5 加载

- 页面级骨架（卡片骨架 ×2 + 行骨架 ×3），超过 300ms 才显示（避免闪）。
- 子区块（各页额外 `get()`）局部骨架 + 失败用 `ErrorBlock`（可重试），**不再把错误吞成空数组**。
- 慢接口显示「正在取 X…（已 3s）」。
- 统一 `useResource(path, { ttl })`：单飞、去重、可重试、stale-while-revalidate。

### 4.6 错误

- 三处分工：页面错误块（数据取不到）/ Toast（动作结果，2s）/ 行内错误（字段校验）。
- 文案规则：一句话说「哪里 + 为什么 + 下一步」，禁止裸露 stack；技术细节进「复制诊断」。
- 服务端错误码（如 `MIND_ASK_TIMEOUT`、`BUDGET`）在面板侧映射成人话。

### 4.7 空态（教学式）

`Empty` 升级为：图标 + 标题（这是哪）+ 一句解释（为什么空）+ **主行动**（跳到能做事的地方）+ 可选次行动。
例：表情包空 →「还没有表情包」+「她收到真表情时会自动收下」+「去 QQ 会话里发一个」/「手动导入」。

### 4.8 排版与密度

- 基准 13px / 行高 1.6 保留；标题步进 1.125–1.2（13/15/17/19），不做流体字号。
- 卡片圆角 18px、单层阴影（保留）；日志/模型列表行高 28px，数字用 `--dsh-font-family-code-default`。
- 动效 150–220ms，只用于状态变化（展开 / 保存条 / Toast）。

---

## 5. 原功能 → 新入口 → 验收方式

### 5.1 全局壳

| 原功能 | 新入口 | 验收方式 |
|---|---|---|
| 28 页导航 | rail（9 组）→ 组内页 → 页内锚点 | Playwright：逐组展开逐页导航，断言 `aria-current` 与标题一致；28 页零控制台错误 |
| 顶部功能查找 | 顶部条常驻，「/」唤起，结果直达「页 + 分区」 | Playwright：输入「梦」「RVC」「白名单」，断言直达对应分区 |
| 启用 / 试运行 / 调试 | 顶部条右侧运行态组（保持） | Playwright：切换后刷新仍持久；Mini 断言 config 落库 |
| 未保存提示 + ⌘S | 保存条三态 | Playwright：改一项 → 出现 → ⌘S → 已保存 → 消失 |
| Toast | `shell.overlay`（不可用则面板右下固定） | Playwright：保存失败时 Toast 与错误块同时出现且不重叠 |
| 版本号入口 | rail 底部 → 关于页 | Playwright：点击落在 about |

### 5.2 28 页

| 页 | 新入口 | 验收 |
|---|---|---|
| 概览 `overview` | rail 首项；状态卡 + 最近日志 + 快捷入口 | Playwright：KPI 与日志非空；Mini 与 `/state` 同源 |
| 她现在 `now` | 心智组第 1 页 | Playwright：四数值与 `/mind/now` 一致；Mini 刷新一次 |
| 记忆 `mood` | 心智组；锚点：向量 / 流水保留 | Playwright：5 行表单可改可撤销；折叠展开见说明 |
| 知识库 `knowledge` | 心智组第 3 页 | Playwright：列表/搜索/写笔记；空库教学空态 |
| 关系 `persona` | 心智组；**新增**置顶 | Playwright：49 人列出、搜索、详情；Mini 断言人数 |
| 念头与行动 `inner` | 心智组第 5 页 | Playwright：日记/念头/权限三块；Mini 断言条数 |
| 人格与自我 `selfmind` | 自我组；锚点：人格卡/特质/习惯/版本 | Playwright：19 特质全渲染，band 文案与 `/mind/self` 一致 |
| 设置 `mindsettings` | 自我组（可选宿主 `settings.section`） | Playwright：64 参数行分组；高级项默认收起 |
| 平台连接 `platforms` | 平台组（单页） | Playwright：四平台卡；Mini 断言 channels |
| 连接 `connect` | QQ 组第 1 页；锚点：工作区/网关 | Playwright：诊断按钮 → 结果条；Mini 只读诊断 |
| 白名单与权限 `access` | QQ 组第 2 页 | Playwright：10 行 + 2 折叠；Mini 改一项保存复查 |
| 回复规则 `group` | QQ 组第 3 页 | Playwright：名单/覆盖增删；Mini 真群验证（单独授权） |
| 聊天模型 `model` | QQ 组第 4 页 | Playwright：下拉 + 测速空态；Mini `/models` 非空 |
| 语音识别 `asr` | QQ 组（需 voice） | Playwright：模块关闭时「去开模块」教学空态 |
| QQ 空间 `diary` | QQ 组（需 diary） | Playwright：三卡 + 发布历史；Mini `/diary/history` |
| 语音合成 `voice` | 创作组（需 voice） | Playwright：8 行 + 试听；Mini 真合成一次 |
| 表情包 `stickers` | 创作组（需 stickers） | Playwright：网格 + 批量起名进度（假数据）；Mini 341 条真实库 |
| 生图 `imagegen` | 创作组（需 imagegen） | Playwright：11 行 + 图库空态；Mini `/image/status` |
| 翻唱 `song` | 创作组（需 song） | Playwright：六组件体检 + 安装进度（假）；Mini 六绿 |
| 生视频 `video` | 创作组（需 video） | Playwright：本地接口卡 + 扩展位；Mini `/local/status` |
| 日志 `logs` | 系统组 | Playwright：级别筛选 + 空态；Mini 真实日志 |
| 备份与恢复 `backup` | 系统组 | Playwright：本地/远端两卡；Mini `/backup/state`；远端不实测 |
| 安全防护 `security` | 系统组（4 卡 3 折叠） | Playwright：危险确认卡可见且不可误触 |
| 浏览器 `browser` | 系统组 | Playwright：说明 + 开关；Mini 开关生效 |
| 本地接口 `local` | 系统组（也是生视频实现） | Playwright：脚本列表 + 复制；Mini `/local/status` |
| 关于 `about` | rail 底部版本号 | Playwright：版本/许可/来源三卡 |
| 模块管理 `modules` | 扩展组 | Playwright：12 模块列表 + 开关 + 报错徽标；Mini 同步 |
| 模块库 `market` | 扩展组 | Playwright：索引列表 + 空态；Mini 不实测外网 |

### 5.3 扩展 UI 与向导

| 原功能 | 新入口 | 验收 |
|---|---|---|
| 设置向导（4 步） | 首次整页；关于页可重开 | Playwright：走完 4 步（假网关）→ `setupDone` 落库 |
| 扩展模块设置表 | 对应页内嵌 Card | Playwright：3 种字段类型生成表单，保存 `ext.<id>` 落库 |
| 扩展自定义面板 | 同页 Card（`ExtPanel`） | Playwright：面板崩溃显示 ErrorBlock，不影响主页面 |
| 模块报错 | 模块卡徽标 + 展开最近一条 | Playwright：注入错误 → 徽标变红可展开 |

---

## 6. 分批（每批可独立验收）

| 批次 | 范围 | 独立验收 |
|---|---|---|
| **B0 通道与地基** ✅ 1.7.0 | `scripts/ui-preview.mjs` + `scripts/ui-shot.mjs`（不依赖宿主即可截图/断言）；五个控件；token 分层与对比度守卫 | 已达成，证据见 §6.1 |
| **B1 壳与导航** ✅ 1.7.1 | 顶部条、rail、页内锚点条、小屏页签、Toast 归 `shell.overlay` | 28 页导航断言 + 小屏快照（`ui-shot` 已覆盖） |
| **B2 心智组** ✅ 1.7.2 | now / mood / knowledge / persona / inner | 每页三态 + Mini 数据一致（`ui-shot` 10 页 × 3 态） |
| **B3 自我与设置** | selfmind / mindsettings（含 `settings.section` 入口评估） | 64 行表单校验与保存 |
| **B4 QQ 会话组** | connect / access / group / model / asr / diary | 连接诊断、白名单保存、模型选择 |
| **B5 表达与创作** | voice / stickers / imagegen / song / video | 模块门控 + 真机各一次 |
| **B6 系统组** | logs / backup / security / browser / local / about | 危险操作二次确认、备份状态 |
| **B7 平台与扩展** | platforms / modules / market / 扩展面板外壳 | 模块增删改查、报错隔离 |

**实施顺序**：B0 → B1 → B2 → B3 → B4 → B5 → B6 → B7。B0/B1 完成后其余批次可并行（同一目录不同 part 文件）。

### 6.1 第一批（B0）结束条件（已达成，1.7.0）

1. **通道**：`scripts/ui-shot.mjs` 一条命令起 `dsh web`（随机端口）+ 安装/启用 Aurabot + 打开工作台 + 28 页截图。
2. **基线**：28 页 × 2 套数据（空 / 真机快照）截图入 `docs/ui-baseline/`，后续每批对比。
3. **控件**：`Field`/`Empty`/`ErrorBlock`/`Skeleton`/`SaveBar` 五个控件在 `overview`、`mindsettings`、`voice`、`modules`、`logs` 五页真实替换；
   每页三态（loading/error/empty）各一条 Playwright 断言。
4. **token**：颜色硬编码清零（仅 token 文件允许），深色只覆盖 14 个语义 token；对比度 ≥ 4.5:1（脚本算）。
5. **回归**：全量 1730 通过；`client-css.test.js` / `client-form-kit.test.js` 扩展新控件；oxlint 0 error。
6. **真机**：Mini 冒烟一次（面板打开、5 个代表页可用、0 新增 error）。

**B0 实际达成证据（1.7.0）**

| 条件 | 证据 |
|---|---|
| 通道 | `scripts/ui-preview.mjs`（真组件 + 真机快照，不连宿主）+ `scripts/ui-shot.mjs`（随机端口拉起、跑完自动关） |
| 基线 | `docs/ui-baseline/pages/*.png`（28 张）、`states/*.png`（5 页 × 3 态 = 15 张）、`theme-dark.png`、`narrow.png` |
| 控件 | `Field` / `Empty`（升级）/ `ErrorBlock` / `Skeleton` / `SaveBar` 落地在 `overview`、`mindsettings`、`voice`、`modules`、`logs`；`ui-shot` 对每页三态各一条断言 |
| token | `client/parts/0tokens.js` 是唯一颜色来源；`test/client-tokens.test.js` 拦字面量、算对比度（浅/深各一遍）、禁止深色新增 token 名 |
| 回归 | 全量 1739 通过（新增 9 条）；oxlint 0 error；清单 0 待审 |
| 真机 | Mini 安装 1.7.0、面板照常、5 个代表页数据正常、0 新增 error（见 ACCEPTANCE-LOG） |

---

## 7. Air（Playwright）可验证 vs Mini 需实测

| Air 可验证 | Mini 需实测 |
|---|---|
| 28 页渲染与导航、aria-current、标题 | 真实 QQ 网关连接/诊断（`/onebot/*`） |
| 三态与骨架屏节奏 | 语音真合成/试听、ASR |
| 表单草稿、脏标记、保存条、⌘S、字段校验 | 表情包真实库与批量起名进度 |
| 主题深浅、token 对比度、焦点环 | 生图/翻唱真实链路（模型、ComfyUI、RVC 六组件） |
| 公共控件七种状态 | 备份/恢复真实读写、远端 WebDAV（需单独授权） |
| 扩展设置表生成、报错隔离 | 模块热重载、真实模块报错 |
| 小屏断点（660/930px） | 宿主侧栏折叠、桌面窗口框架 |
| Toast / 复制诊断 / 错误码映射 | 日志真实内容、三个 purge 维护工具 |

---

## 8. 风险与开放问题

1. **primitives 导出未知**：若宿主已有 `Dialog`/`Tabs`/`Skeleton`，方案应改用宿主版；B0 先枚举。
2. **`settings.section` 是否值得进**：多一处入口也可能多一处不一致；B3 评估后二选一，不做双入口。
3. **web profile 启用插件未持久化**：B0 第一件事，否则 Air 截图不可复现。
4. **`FIND_SECTIONS` 与新锚点条重复**：两处必须同源，不能维护两份。
5. **5 页子接口错误被吞**：改成就地错误块会改变「静默降级」行为，需在 Mini 确认无依赖。
6. **`styles.js` 634 行拆分**：构建期拼接，需 `client-css.test.js` 覆盖拆分后选择器仍在。

---

## 附：本轮产出物

- 本文：`docs/UI-PLAN.md`
- 组件树盘点数据：[panel-inventory.json](ui-baseline/panel-inventory.json)（28 页卡片 / 表单行 / 空态 / 折叠）
- 宿主壳实际渲染（Air Playwright）：[dsh-shell.png](ui-baseline/dsh-shell.png)、[dsh-plugins.png](ui-baseline/dsh-plugins.png)
