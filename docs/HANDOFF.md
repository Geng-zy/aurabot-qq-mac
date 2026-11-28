# AuraBot for macOS 维护交接

> 新会话/换人接手先看 [`SESSION-HANDOFF.md`](SESSION-HANDOFF.md)。

适用版本为 AuraBot for macOS `v1.6.92`。维护仓库为 `Geng-zy/aurabot-qq-mac`，发布分支为 `main`。上游为 `aureth-labs/dsh-aurabot-qq`。DSH 安装时使用的包名仍是 `dsh-aurabot-qq`，这样现有用户可以继续读取同一份插件数据。

## 接手所需环境

- 代码与离线测试使用 Node.js ≥ 24（DSH 0.2.2-rc.3 自带 24.21.0）。依赖由 DSH 宿主提供，源仓库无需先下载 QQ 网关、模型或媒体环境来跑 `npm test`。
- 实机用 Apple 芯片 Mac、DeepSeek Harness 桌面版、单独的测试机器人 QQ 号和 OneBot v11 网关。`v1.6.92` 的工作区恢复按 DSH `0.2.2-rc.3` 适配。内置本地生图另需 macOS 26 或更新版本。
- 向原仓库 `main` 推送和发 GitHub Release 需要仓库写权限。在终端用 `gh auth status` 确认 GitHub CLI 登录了有权限的账号。开发和离线测试不需要 GitHub 写权限。

```bash
git clone https://github.com/Geng-zy/aurabot-qq-mac.git
cd aurabot-qq-mac
npm test
```

## 代码入口与测试

| 区域 | 入口 | 针对性测试 |
| --- | --- | --- |
| DSH 宿主、面板、预设和生命周期 | [`src/host.js`](../src/host.js)、[`cordis.patch.yml`](../cordis.patch.yml)、[`client/client.js`](../client/client.js) | [`test/system-session-backoff.test.js`](../test/system-session-backoff.test.js)、[`test/system-processes.test.js`](../test/system-processes.test.js)、[`test/panel-mind.test.js`](../test/panel-mind.test.js) |
| QQ 消息、排队、引用、工具授权 | [`src/channels/qq/`](../src/channels/qq/)、[`src/chat/`](../src/chat/) | [`test/e2e.test.js`](../test/e2e.test.js)、[`test/group-owner-tools.test.js`](../test/group-owner-tools.test.js)、[`test/chat-final-reply.test.js`](../test/chat-final-reply.test.js) |
| 心智、人设、记忆与可见范围 | [`src/mind/`](../src/mind/)、[`src/mind-adapter/index.js`](../src/mind-adapter/index.js)、[`src/persona/personas.js`](../src/persona/personas.js) | [`test/mind-core.test.js`](../test/mind-core.test.js)、[`test/mind-adapter.test.js`](../test/mind-adapter.test.js)、[`test/output-guard.test.js`](../test/output-guard.test.js) |
| 创作任务、参考图、供应方与媒体文件 | [`src/modules/imagegen/index.js`](../src/modules/imagegen/index.js)、[`src/features/imagegen.js`](../src/features/imagegen.js)、[`src/core/tasks.js`](../src/core/tasks.js)、[`src/local/`](../src/local/) | [`test/imagegen.test.js`](../test/imagegen.test.js)、[`test/imagegen-img2img.test.js`](../test/imagegen-img2img.test.js)、[`test/codex-image.test.js`](../test/codex-image.test.js) |
| 扩展、配置、备份与恢复 | [`src/core/modules.js`](../src/core/modules.js)、[`src/core/config.js`](../src/core/config.js)、[`src/core/backup.js`](../src/core/backup.js)、[`src/modules/API.md`](../src/modules/API.md) | [`test/modules.test.js`](../test/modules.test.js)、[`test/backup.test.js`](../test/backup.test.js) |
| 宿主维护插件接缝 | [`src/integration/`](../src/integration/)、[`src/chat/tool-scope.js`](../src/chat/tool-scope.js)、[`src/chat/privileged-tools.js`](../src/chat/privileged-tools.js) | [`test/purge-scope.test.js`](../test/purge-scope.test.js)、[`test/tool-scope.test.js`](../test/tool-scope.test.js)、[`test/integration-architecture.test.js`](../test/integration-architecture.test.js) |

`test/e2e.test.js` 使用假的 DSH 和 OneBot 网关，在临时目录里读写并验证完整插件入口。运行单项测试时可以用 `node --test --test-name-pattern='引用消息|生图由她理解' test/e2e.test.js`。全仓语法检查用 `node scripts/check-syntax.mjs`（或 `npm run check`）。修改回执和权限时应补查失败、撤权和重试分支。GitHub 的 `PR Check` 使用 Node 24，覆盖面与 `npm test` 一致。离线用例验证接线、权限和状态转换，实机模型的回复和 QQ 送达需在测试账号上另外验证。

## 数据、密钥与备份

| 位置 | 用途 |
| --- | --- |
| `~/.dsh/plugins-data/aurabot/config.json` | 面板配置与选模、权限、服务端点和授权信息 |
| `~/.dsh/plugins-data/aurabot/sessions.json` | QQ 窗口与 DSH 会话的映射，含正式和调试会话 |
| `~/.dsh/plugins-data/aurabot/mind/` | 心智数据库、版本、记忆及恢复所需文件 |
| `~/.dsh/plugins-data/aurabot/personas/`、`chatlog/`、`logs/` | 人格卡、聊天流水和运行日志 |
| `~/.dsh/plugins-data/aurabot/qq-inbox.json`、`outbox/`、`creative-tasks.json` | QQ 补收、断线后待投递项、创作任务状态 |
| `~/.dsh/plugins-data/aurabot/appearance/`、`imagegen/`、`stickers/`、`modules/` | 形象、画作、表情和用户安装的模块 |
| `~/.dsh/plugins-data/aurabot/backups/`、`~/Aurabot/` | 插件备份、默认 QQ 工作区与部分本地环境 |

从「系统 → 备份」创建备份并核对备份类型。只备份配置适合迁移设置，恢复记忆、聊天或画作需要包含相应数据的完整备份。DSH 会话归档由宿主管理，保留会话时也应核对备份中是否包含会话。还原前先保留当前备份，并按面板要求重启 DSH。手工复制数据库时先退出 DSH，或通过 SQLite 自身的备份能力制作一致快照。

仓库和 Release 只放源码、安装包和公开材料。OneBot 令牌、API 密钥、订阅授权文件、聊天记录、数据库、个人备份和本机排障笔记都应留在私有存储。报错时复制时间、模块、状态码和经脱敏的错误信息。

## 收到故障时的检查顺序

1. 在「概览」确认本机已加载的 AuraBot 版本、QQ 账号、运行模式和聊天模型。先用「试运行」核对消息能收到、能生成公开的普通回复，再切换到正式模式做实际发送验证。生图试运行仍可能出图并保存，调用在线服务也可能计费。
2. 在「系统 → 日志」定位同一条事件。收到消息后先检查白名单、回复策略、合并窗口和账号匹配，再核对工作区挂接及对应 DSH 会话。使用时区一致的时间戳跟踪，避免把较早会话或任务的错误归到本轮。
3. 如果 DSH 已生成正文，核对 QQ 转换、发送回执和补发状态。确认失败才可补发；结果未知时先检查原会话，避免重复投递。排查隐私问题时核对消息来源、会话角色、隐私版本和该轮实际说话人。
4. 如果报工作区挂接失败，检查 DSH 工作区是否可打开、路径是否可访问以及它是否包含原会话。`hub.js` 只会恢复本次明确新建且归属明确的会话。保留备份与错误信息，再考虑重建工作区或重置会话映射。
5. 如果画图、唱歌或视频没有产出，先在面板确认服务就绪。生图检查当前会话的生图白名单、DSH 本轮的工具调用和任务记录。模型未调用工具时不会有任务；已创建的任务再按生成、投递和回执逐段定位。内部维护工具与常规生图权限分别核验。
6. 排查模块时先看「扩展」页的加载状态，再看模块日志。更新、重载后刷新一次当前会话的工具列表。模块模拟入口可检查接管和回复形态，模型层应使用离线测试或专用实机配置。面板内部接口位于 `src/host.js` 的 `/aurabot/api/` 路由，带写入或工具执行的操作按现有面板访问方式运行。

## 构建、发布与回滚

1. 在开展改动前确认工作区干净，确认 `origin` 指向维护仓库。仅在同步上游时才使用 `upstream`，先看提交和差异，再决定是否合并。
2. 在待发布提交中确认 `package.json` 版本、`CHANGELOG.md` 的对应章节、README 安装例子和安装包白名单。运行全量测试与 `git diff --check`。用 `npm pack --dry-run --ignore-scripts` 检查包内容，再在仓库外生成 `.tgz`。
3. 提交并推送 `main`，在对应提交上创建同名 Git tag。先创建 GitHub 草稿，上传安装包和公告，核对下载摘要后再公开。`package.json` 的 `private` 用于防止误发 npm，用户通过 GitHub Release 安装。

下面以 `v1.6.92` 为例。维护分支、tag 与发布包要对应同一份源码。

```bash
npm test
git diff --check
release_dir=$(mktemp -d)
npm pack --dry-run --ignore-scripts
npm pack --ignore-scripts --pack-destination "$release_dir"
shasum -a 256 "$release_dir/dsh-aurabot-qq-1.6.92.tgz"

# 在已提交、已审核的 main 上操作，release-notes.md 由维护者准备。
git tag -a v1.6.92 -m 'AuraBot v1.6.92'
git push --atomic origin main refs/tags/v1.6.92
gh release create v1.6.92 "$release_dir/dsh-aurabot-qq-1.6.92.tgz" \
  --verify-tag --draft --title 'AuraBot v1.6.92' --notes-file release-notes.md
gh release view v1.6.92
gh release edit v1.6.92 --draft=false --latest
```

本机安装与版本回退沿用离线安装方式。先退出 DSH，安装指定版本的 TGZ 后重启，并在面板确认实际加载版本。跨版本回退先备份，核对旧版能否读取当前数据；如果需要回退数据，使用配对备份。已发布的 tag 和安装包应保留，发现问题后发布修订版本。

```bash
dsh="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
"$dsh" plugin --profile desktop -- add "file:$HOME/Downloads/dsh-aurabot-qq-1.6.92.tgz" --offline
```

## 当前边界与接手后核验

- 本版本的生图基于自然语言和工具调用。旧画图命令不再提交任务，升级后新生图白名单需要在面板按会话配置。管理员群聊也按会话白名单核验。
- DSH 版本、聊天预设、当前人设、已存在的会话历史和生图供应方都可能影响实机表现。桌面普通会话与 QQ 会话应分别验收。出现差异时固定模型和用户请求，再单独改变预设或历史等一个变量。
- dsh-purge 是独立的 DSH 插件，宿主补丁对所有会话全局生效。AuraBot 只在 [`src/integration/purge-scope.js`](../src/integration/purge-scope.js) 处理三件事：维护工具只在本机管理员私聊可见；人格卡尾部带身份锁定（preset 变量 `{{aurabot_identity_lock}}`），维护段只补执行约束，大肥鱼人设只读；维护段为空时提示词保持原样。宿主维护插件把注入排到最前时，`src/integration/persona-hoist.js` 会在 provider adapter 出口把「人格卡 + 规则 + 身份锁定」搬回 system 最前。`purge_*` 工具名由 [`host-tools.js`](../src/integration/host-tools.js) 按公开定义、会话可限制名单、探测报错三种方式发现，三条都失败时按一个都不给处理。已对当前最新版 dsh-purge `1.7.20` 跑过接缝与真实 DSH 请求验证。日志里出现某段系统提示词只说明该轮带入了它，QQ 端的工具调用和任务结果仍需分别核验。
- 主要回归路径是管理员私聊、已开放的普通私聊、已开放的群聊、未开放的会话、正式与调试的隔离，以及重启后的工作区会话恢复。选用有权限的测试账号、公开样本和独立数据目录。

完整入口见[功能、设计与实现](FEATURES-AND-IMPLEMENTATION.md)、[用户手册](USER-MANUAL.md)、[历史设计](DESIGN.md)、[模块教程](MODULE-TUTORIAL.md)和[更新记录](../CHANGELOG.md)。接手时先核对文档对应的发布版本与本机实际加载版本。
