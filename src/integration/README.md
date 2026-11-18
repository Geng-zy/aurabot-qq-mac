# 宿主维护插件接缝（integration）

这个目录只放「Aurabot 与 DSH 其他插件之间的边界」，不写聊天业务。

## 为什么需要它

DSH 的宿主补丁（例如 dsh-purge 的 88 条）改的是宿主代码，对所有会话全局生效，
Aurabot 不需要重复实现审批、沙箱、工具权限这些事。真正需要处理的只有三件：

1. **对方追加的提示词不要盖掉大肥鱼人设**。Aurabot 的 preset 用 `complete: true`
   独占系统提示词；宿主在 complete 分支里会保留 `completeSection` 和所有以
   `dsh-purge` 开头的段。身份锁定放在 preset 的 persona 变量（`{{aurabot_identity_lock}}`）里，
   跟着人格卡一起进入 complete 段，所以不会被对方的 rewrite 丢掉；接缝只额外补一段
   只约束执行方式的「执行约束」，人设段本身只读。
2. **维护工具只在本机管理员私聊出现**。宿主把 `purge_*` 注册在根作用域，社交预设
   也会继承；按会话 `tools.restrict({ deny })` 收窄，执行入口再用 `tools.guard`
   复核一次，管理员授权版本变化后旧会话立即失效。
3. **工具名发现要容错**。优先 `tools.definitions()`，其次
   `tools.view(agent).restrictableNames`，最后从探测报错里解析已知名单；
   三条都失败时按「一个都不给」处理。

## 文件

| 文件 | 职责 |
| --- | --- |
| `host-tools.js` | 全局工具名发现、`purge_*` 识别；不依赖聊天层 |
| `purge-scope.js` | 身份锁定文案、执行约束、`system-prompt/assemble` 监听、维护工具名 |
| `persona-hoist.js` | 模型请求出口的人设前置：按标记把「人格卡 + 规则 + 身份锁定」搬到 system 最前 |
| `../chat/tool-scope.js` | 会话工具闸：访客白名单、群聊 `group-full` 的开合 |
| `../chat/privileged-tools.js` | 需要「这一轮全是管理员」才执行的 QQ 工具 |

## 兼容与取舍

见 [docs/PURGE-COMPAT.md](../../docs/PURGE-COMPAT.md)：当前适配最新版 1.7.20；组装阶段贴锁、`llm/stream` 重建 options、包 `llm.stream` 都不成立，最终采用 provider adapter 出口的人设前置。

## 契约

- 接缝只读宿主的公开 API（`ctx.on('system-prompt/assemble')`、
  `agent.ctx.tools.*`），不 import 宿主内部文件，也不改 dsh-purge 的源码。
- 监听失败只记 debug 日志，不影响宿主启动；下游 `assemble` 抛错时原样抛出，
  不拿旧 assembly 兜底。
- 人设前置包在每个 provider adapter 的 `prepareCall/stream` 上。`llm/stream` waterfall 的
  `next()` 不转发参数，其他插件在监听里重建的 options 会被丢掉；adapter 层不受监听顺序影响。
- 身份锁定只对 `aurabot-private`、`aurabot-private-long`、`aurabot-social`、
  `aurabot-group-owner` 生效；`aurabot-subagent` 不带人设，不参与。
- 维护段为空（插件关闭）时不插入任何内容，保持提示词原样。

## 测试

```bash
node --test test/purge-scope.test.js test/tool-scope.test.js test/persona-hoist.test.js test/integration-architecture.test.js
node --test test/group-owner-tools.test.js
node scripts/check-syntax.mjs
```
