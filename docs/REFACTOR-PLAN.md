# Aurabot 重构总纲（目标架构 · 审计口径 · 批次计划）

本文件是这次全仓重构的唯一口径。任何一批的改动、审计结论和验收证据都对齐这里；口径要改，先改这里再动手。

- 起点：`main@3658ee3`（`v1.6.30`），工作区带未提交的 `1.6.31` 语音修复。
- 唯一宿主兼容目标：**DSH Desktop `0.2.2-rc.3` + dsh-purge `1.7.20`**。
- 不做的事：改远端历史、覆盖已有 tag、动用户的真实数据与会话标识。

## 1. 目标架构

分层按依赖方向，箭头表示「可以依赖」：

```text
host  ──→ chat ──→ mind-adapter ──→ mind
 │        │            │
 │        └──→ channels ──→ core
 ├──→ panel ──→ feature ──→ core
 ├──→ modules ──→ core
 ├──→ integration ──→ core
 └──→ security ──→ core

client（网页半边）──→ 只走 HTTP API，不 import src/
tooling / test ──→ 可依赖任意层
```

| 归属 | 目录 | 职责（一句话） | 不该出现的依赖 |
|---|---|---|---|
| `host` | `src/host.js`、`src/host/` | 组合根：装配各层、注册路由、生命周期 | 业务实现细节、平台私有逻辑 |
| `core` | `src/core/` | 基础设施：配置、存储、日志、用量、任务、备份、模块内核、模型调用 | chat / channels / features / mind |
| `channels` | `src/channels/` | 平台接入：连接、消息转换、收发、能力声明 | chat 业务、mind、面板 |
| `chat` | `src/chat/` | 聊天中枢：回合状态机、输出策略、会话解析 | 平台 SDK 细节、面板路由 |
| `panel` | `src/features/*-routes.js` | 面板 HTTP 路由：参数校验、调用领域服务 | 直接改文件、绕过领域服务 |
| `feature` | `src/features/`（非 routes） | 面板背后的领域服务（知识库、生图、通知、她的话） | 平台细节 |
| `mind` | `src/mind/` | 心智核心：记忆、情绪、关系、人格、动机、内心 | channels / mind-adapter / chat |
| `mind-adapter` | `src/mind-adapter/` | 心智与聊天/DSH 的对接与策略 | 面板路由 |
| `persona` | `src/persona/` | 人格卡读写与默认人格 | chat / channels |
| `media` | `src/voice/`、`src/song/`、`src/local/` | 语音、翻唱、本地接口 | chat 业务 |
| `modules` | `src/modules/` | 可插拔模块内核与内置模块 | 面板、平台私有实现 |
| `security` | `src/security/` | 危险命令、审批中继、SSRF 策略 | 业务逻辑 |
| `integration` | `src/integration/` | 宿主接缝：purge 范围、人格前置、宿主工具 | 面板路由 |
| `client` | `client/` | 网页半边：模板 + 片段，构建成 `client/client.js` | `src/`、Node API |
| `tooling` | `scripts/` | 构建、校验、回放、清单等开发脚本 | 运行时状态 |
| `test` | `test/` | 离线回归：fake DSH、mock OneBot、fixtures | 真实账号与网络 |

深模块口径（`.dsh/skills/codebase-design`）：

- **深**＝小接口后面压着大量行为；**浅**＝接口和实现一样厚（纯透传、只换名字）。
- 判定「浅」要过**删除测试**：把这个文件删掉，复杂度如果只是在调用点各复制一遍，它就不该存在。
- 一个适配器＝假想的接缝；两个适配器＝真接缝。没有第二实现的接口不新增。
- 接口就是测试面：测试要能穿过公开接口验证，而不是去摸内部状态。

### 1.1 明确保留的契约

这些不是重构对象，改动必须有迁移和回滚方案：

1. `package.json` 的 `main` / `exports` / `dsh.bundle.patch` / `files` 形状；
2. `cordis.patch.yml` 的五个 preset id 与 `<!-- AURABOT:PERSONA:START/END -->` 标记；
3. `dsh-purge*` 段名、`purge_*` 工具名、`rewritePromptAssembly` 接缝行为；
4. 面板路由 `/aurabot/api/*` 的路径与返回字段；
5. 配置键名与默认值（`config.json`）、数据目录布局（`~/.dsh/plugins-data/aurabot`、`~/Aurabot`）；
6. 会话标识格式（`private:<qq>` / `group:<gid>` / telegram 对应形式）、`sessions.json` 映射；
7. 模块 API 版本 `API_VERSION` 与 `src/modules/API.md` 描述的面；
8. 社区模块的 `/ext/<id>/...` 路由形状。

## 2. 审计口径

全仓清单由 `scripts/repo-inventory.mjs` 用 `git ls-files` 生成事实（行数、导出、内部依赖、被依赖数、引用它的测试），结论来自 `docs/repo-audit/*.json`，两者合成 `docs/REPO-INVENTORY.md`。

### 2.1 每个文件一条结论

```json
{
  "path": "src/chat/hub.js",
  "area": "chat",
  "owner": "chat",
  "verdict": "split",
  "evidence": "1471 行组合根，被 src/host.js 引用；已抽出 20 个 chat/ 子模块；test/e2e.test.js、test/hub-lifecycle.test.js 覆盖；待拆：回复投递与回合状态"
}
```

`verdict` 只能取：

| 值 | 含义 | 判据 |
|---|---|---|
| `keep` | 保留 | 接口清晰、被依赖、有测试或文档，且不属于下面任何一类 |
| `keepDoc` | 保留但补文档 | 行为正确但缺少接口说明/契约文档 |
| `keepGenerated` | 生成物 | 由脚本产出，手改无效（`client/client.js`） |
| `split` | 拆分 | 单文件 >300 行且承担 ≥2 个职责，或接口过宽 |
| `merge` | 合并 | 过删除测试后确认是纯透传/重复实现，应并入 `X` |
| `rewrite` | 重写 | 实现与目标分层冲突且无法靠移动解决 |
| `vendor` | 第三方 | 非本仓自有代码（`models/`、第三方声明） |
| `delete` | 删除 | 无 import、无动态引用（`grep`）、无文档、无测试引用，四者都有证据 |

### 2.2 证据必须可核对

每条 `evidence` 至少包含两类可复核事实：

1. 依赖事实：被谁 import（具体文件或 `0 引用`），或反向 grep 结论；
2. 验证事实：哪个测试文件覆盖 / 哪份文档描述 / 哪条路由或配置键对外暴露；
3. 规模事实：行数与内部依赖数量（>300 行必须写）。

禁止写在证据里的话：`看起来`、`应该`、`一般`、`暂时`、`可能`。无法确认就写「未证实」，并把它记进该批的待办。

## 3. 批次计划

每批固定五段：**改 → Air 自动测试 → 打包 → Mini 实机验收 → 提交/tag/Release**。任何一段没过，就地修复复验，不往后推。

| 批 | 范围 | 主要目标 | 风险闸门 |
|---|---|---|---|
| B0 | 清单、口径、README 核对、rc.5 判定 | 让后续每一批都有据可依 | 只动文档与 README，不改行为 |
| B1 | `host` 组合根 | `host.js` 855 行只留装配；路由注册收敛 | 面板 `/aurabot/api/*` 全路由回归 |
| B2 | `panel` 路由 | 去重、统一参数校验与错误形状 | `test/*-panel*.test.js`、CSRF/公开面 |
| B3 | `chat` 中枢 | 回合状态机与输出策略收敛 | `test/e2e.test.js`、`hub-lifecycle` |
| B4 | `channels` | QQ features 归一、适配器接口统一 | `channels-contract`、`gateway-resilience` |
| B5 | `core` | 配置/备份/模块内核边界 | `backup*`、`modules*`、`config` 迁移 |
| B6 | `mind` + `mind-adapter` | 装配门面与内部边界 | `mind-*`、迁移/快照/隐私版本 |
| B7 | `client` | 片段分组、模板收敛、构建校验 | `client-build`、面板源码契约测试 |
| B8 | `media` / `modules` / `security` / `integration` | 接缝显式化 | `purge-scope*`、`persona-hoist`、`danger-*` |
| B9 | `test` / `tooling` / CI | 助手去重、脚本归一 | 全量 + 语法 + lint |
| B10 | 收尾 | 全仓清单复核 + 最终实机验收 | 清单 100% 有结论 |

B0 之后每批都要在 `docs/ACCEPTANCE-LOG.md` 追加一段：自动测试、模拟网关、真实 purge 模块、Mini 实机四类证据。

## 4. 执行结果（1.6.31 → 1.6.50）

每一批都是「Air 全量 + Mini 真实 purge + Mini 实机 + CI 双平台 + Release 资产同源」五件套，
原始证据在 `docs/ACCEPTANCE-LOG.md` 与 `docs/REPO-INVENTORY.md`。

| 批次 | 版本 | 做了什么 | 结果 |
| --- | --- | --- | --- |
| B0 | 1.6.31 | 语音条修复 + 用 `git ls-files` 建全仓清单 | 665 个文件全有归属，0 待审 |
| B1 | 1.6.32 | `host.js` 拆路由/云备份/心智/头像 | 855 → 664 行，133 条路由快照守住 |
| B2 | 1.6.33 | 面板写操作闸 | 20 条会读 body 的路径确认 POST-only，GET 一律 405 |
| B4 | 1.6.34 | 渠道能力契约 | `caps.recall` 兑现（补 delete_msg），`CAP_METHODS` 校验 |
| B3a | 1.6.35 | 单一注意力 | 排序/放行规则进 `createAttentionRanking`，hub 1471 → 1455 |
| B3b | 1.6.36 | 会话事件 + 记账 | 依赖 43 → 41，补 10 个直接用例（原先 0） |
| B5a | 1.6.37 | zip 三处收敛 | `community.js` 328 → 296，严格校验保留 |
| B5b | 1.6.38 | 修线上潜伏 bug | `hub` 从未把 `pending` 传给 `createGroupContext`（潜伏 20+ 版本） |
| B5c | 1.6.39 | `config.js` 三段拆分 | 844 → 177（+ defaults 261 + normalize 430），带等价性实证 |
| B5d | 1.6.40 | core 反向依赖 | 10 → 0，新增 `test/core-layering.test.js` |
| B5e | 1.6.41 | `backup.js` 拆 ZIP 编解码 | 1059 → 897 + `backup-zip.js` 198；实机负例（改坏 1 字节）验证 CRC |
| B6a | 1.6.42 | 心智核心两处越界归位 | 进程管理搬出 mind，人格上限下沉 core，新增 mind 分层守卫 |
| B6b | 1.6.43 | 适配层门面化 | 13 条绕过边 → 0，新增门面守卫 |
| B7a | 1.6.44 | 面板样式清死码 | 739 → 634 行，删 108 条不可达规则，新增样式守卫 |
| B7b | 1.6.45 | 表单小工具收敛 | 13 处密钥占位 + 21 处提示 → 各 1 处（行数 +26，换 locality） |
| B8a | 1.6.46 | 本地脚本信任链 | 「改了要重新确认」真正执行（原先是死代码），新增 4 个用例 |
| B8b | 1.6.47 | 宿主工具发现加固 | 2.5 → 4 条发现路径，报错解析抽成纯函数并单独测 |
| B8c | 1.6.48 | 当前预设来源 | 自记 > `agent.preset` > header，避免读到过期 header |
| B9 | 1.6.49 | 清单闸门稳定化 | 测试/审计数据自动结论，源码仍需人工；新增 `npm run inventory` |
| B10 | 1.6.50 | 终验 | 清单依据对齐现实（0 处行数漂移）、19/19 资产哈希一致、`scripts/verify-release.mjs` 可复跑 |

## 5. rc.5 判定方法

「仅服务 rc.5 的代码」不能靠印象删。判定顺序：

1. 在 rc.3 的宿主里实跑一遍（插件加载 + 面板 + 一条会话），确认目标行为；
2. 对每个可疑分支，找出它服务的宿主 API：在 rc.3 的 `dsh` 包里能不能找到同名符号；
3. 找不到符号的，写清「rc.3 无此符号」并用测试锁住删除后的行为；
4. 同时服务 rc.3 与 rc.5 的代码不删，只标注兼容范围。

判定记录写进 [`HOST-COMPAT.md`](HOST-COMPAT.md)（符号表 + rc.3 证据 + 结论）。
