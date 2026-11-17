# dsh-purge 兼容与接缝实现

适用 AuraBot `1.5.9`，DSH `0.2.2-rc.3`。结论：**适配 dsh-purge 1.7.15 与 1.7.18**。

## 版本差异

| 项 | 1.7.15 | 1.7.18 |
|---|---|---|
| `lib/identity.js` | 与 1.7.18 逐字一致 | 基准 |
| complete 预设保注入补丁 #40 | 有 | 有 |
| `dsh-purge*` / `dshpg-*` 段约定 | 一致 | 一致 |
| `purge_*` 工具 | 一致 | 一致 |
| 新增内容 | — | 状态页逐补丁计数、补丁组开关等面板功能 |

AuraBot 只依赖公开宿主 API 和段名约定，不 import purge 内部模块；1.7.15 的宿主补丁与 1.7.18 在接缝相关行为上一致。

## 试过的实现与结论

| 方案 | 做法 | 结果 |
|---|---|---|
| A. 组装阶段把锁定句贴在 `dsh-purge` 段前 | `system-prompt/assemble` 监听改 section 文本 | 失败：purge 的 `leadWithInject()` 会丢弃旧 `dsh-purge` 段并重建 |
| B. persona 变量尾部加身份锁定 | `{{aurabot_identity_lock}}` | 有效，但 purge 把注入排在最前，人设位于长注入之后 |
| C. `llm/stream` 监听里重建 options | `next(rewritten)` | 失败：cordis waterfall 的 `next()` 不转发参数；purge 监听调用 `next()` 时会把改写丢掉 |
| D. 包 `llm.stream` 服务方法 | 替换 service 方法 | 失败：真实 DSH 的服务方法只读，赋值被忽略 |
| E. **包 provider adapter 的 `prepareCall/stream`** | 在 adapter 出口搬人设块 | **采用**：不依赖监听顺序，1.7.15/1.7.18 真实 DSH 都验证通过 |
| F. `excludePresets` 排除 aurabot 预设 | 保留宿主补丁、去掉注入 | 可选退路；会失去 purge 提示词注入，不作为默认 |

最终结构：

1. 四个大肥鱼预设的 persona 前缀用 `<!-- AURABOT:PERSONA:START/END -->` 包住人格卡、规则和身份锁定；
2. `src/integration/persona-hoist.js` 包住每个 provider adapter 的 `prepareCall` 与 `stream`；
3. 只对 `sessionId` 属于 Aurabot QQ 会话的请求生效，把标记块搬到第一条 system 消息最前，并移除标记；
4. `src/integration/purge-scope.js` 继续负责维护工具名、会话工具闸和执行约束段；
5. 人格块内文字原样保留，不解析、不改写。

## 验证

```bash
node --test test/purge-scope.test.js test/purge-scope-integration.test.js test/persona-hoist.test.js
PURGE_IDENTITY_PATH=/path/to/purge-1.7.15/lib/identity.js node --test test/purge-scope-integration.test.js
```

真实 DSH 隔离 profile（`DSH_HOME` 临时目录、OneBot mock、fake OpenAI 服务）：

- purge 1.7.15 + AuraBot 1.5.9：私聊/群聊消息 → 模型 → QQ 回执；
- purge 1.7.18 + AuraBot 1.5.9：同上；
- 两者的模型请求 system 都以人格卡开头，`【身份锁定】` 在 purge 注入之前，`AURABOT:PERSONA` 标记已移除。
