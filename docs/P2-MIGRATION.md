# P2 迁移审计与分阶段方案

结论先说：**P2 的“模块内核迁 DSH 插件系统 / client.js 整体迁 DSH client-ui”不能作为一次低风险改动直接落地。** 这轮完成了可行性与风险审计，只提交了不改变行为的安全清理；大迁移需要单独排期。

## 1. modules.js（900 行）

`createModules` 是一个大闭包，`live / errors / routes / listeners / revisions / generation / userSeen / syncing` 被 registry、loader、module-api、panel 四组职责共享。直接按函数切文件会破坏热重载和 `generation` 失效语义。

已完成（1.5.10 beta）：`module-state.js` / `module-code.js` / `module-panel.js` / `module-api.js` / `module-registry.js` / `module-loader.js`，`modules.js` 从 900 行降到 190 行，只保留组合根。

原计划顺序：

1. 抽 `state.js`：只放 8 个 Map 和 `generation`，0 行为变化；
2. 抽 `panel.js`：`handle / panelSource / inside / emit / claim / filter`；
3. 抽 `module-api.js`：`makeApi / scopeCoreForModule / lazyProxy`；
4. 最后拆 `registry.js`（定义、扫描、status、create/fork）与 `loader.js`（start/stop/sync/reload）。

闸门：`test/module-lifecycle.test.js`（12）、`test/modules.test.js`（26）、`test/module-panel-route.test.js`。本次试拆到第 1 步时发现热重载测试出现 404 竞态，已整体回退，不把半成品留在 beta。

## 2. client/client.js（6360 行）

- `@deepseek-ai/dsh-client-ui-primitives` **不是 npm 包**，只作为 DSH Web shell 的 seed 词存在；插件目录没有 `node_modules`，Node 侧测试无法 import。
- 10 个测试文件用 `readFileSync('client/client.js')` + `includes` 锁死了单文件结构；整体迁移会成片打红。
- `client-ui-settings` 是 profile 级设置服务，和 AuraBot 自己的 `/state + draft` 双缓冲不是同一模型，不能直接替换。

可行顺序（先松绑测试）：

1. 把 `panel-mind.test.js` / `persona-filter-select.test.js` 的 marker 字符串注入改成固定 `exports.__test__` 钩子；
2. 迁移纯叶子：`SOURCE` 死常量、图标、`Btn/Switch/Toast`、剪贴板；
3. 再评估 `Card/Row/Select` 和整页容器。

## 3. 兼容层

旧路径 re-export 已删除；外部模块迁移时由 AI 按新路径改 import。`STABLE_ROUTES` 只保留 `group-admin` 一个历史根路由。

## 4. 这轮实际改动

- 删除 `client.js` 未引用的 `SOURCE` 表；
- 修掉 `modules.status()` 安全模式下重复 `scanUser()`；
- `persona-hoist` 在拿不到 `ctx.llm.adapters` 时打 warn，不再静默失效；
- `docs/PURGE-COMPAT.md` 补充 purge 自动放行审批、执行约束寄生性、空白归一和升级韧性；
- 新增措辞回归测试。

## 5. 验证

```bash
node scripts/check-syntax.mjs
node --test "test/**/*.test.js"
```

当前：314 个文件语法通过，1528 个测试通过，0 失败。

## 6. 真实环境核验（2026-11-17）

隔离 profile：`DSH_HOME=/tmp/dsh-e2e-home`，DSH `0.2.2-rc.3`，AuraBot `1.5.10`，dsh-purge `1.7.18`，Mock OneBot + fake OpenAI provider。

- `/aurabot/api/state` 返回 `200`，`onebot.state=connected`，`ownerName` 从旧默认值迁移为 `管理员`；
- 私聊消息进入真实 DSH 会话，模型请求的 system 长 27,849 字符；
- system 以人格卡开头，`【身份锁定】` 和 `【执行约束】` 都在，`AURABOT:PERSONA` 标记已移除；
- QQ 回执正常。该结果验证的是主链路与 purge 接缝，不代表 27 个面板页面和所有外部服务都已逐项跑过。


## 7. 心智对接层分层（1.5.10 beta 后续）

`src/mind-adapter/index.js` 已从 1,725 行降到约 300 行，拆出：

- `context.js` / `context-text.js`：上下文拼装、纯文本常量
- `permission.js` / `outreach.js` / `offers.js`：权限、主动联系、自主行动
- `module-api.js` / `tools.js`：扩展模块接口、她的心智工具
- `inner.js` / `turn-policy.js` / `turn-flow.js` / `turn-context.js`：内心、会话策略、接话、回复前准备
- `body.js` / `reminders.js` / `encoding.js` / `lifecycle.js`：身体、提醒、记忆编码、启动关闭
- `feel.js` / `social.js` / `social-preferences.js` / `privacy.js` / `self.js`：投喂/感受、跨聊天、关系偏好、隐私、自我
- `embedding.js` / `perception.js` / `people.js` / `restore.js` / `snapshot.js`：向量、感知、人物、恢复、快照
- `inspection.js` / `install.js` / `migrate.js` / `local-embedding.js`：检索、安装、迁移、离线向量

`src/mind` 本身已按身体/情绪/关系/记忆/人格/自我/动机/内心分目录，`mind/index.js` 是装配门面，不再硬拆。
