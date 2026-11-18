# dsh-purge 兼容与接缝实现

适用 AuraBot `1.5.10`，DSH `0.2.2-rc.4`。结论：**适配当前最新版 dsh-purge 1.7.20**。

## 版本差异

| 项 | 1.7.20 |
|---|---|
| `lib/identity.js` | 基准 |
| complete 预设保注入补丁 #40 | 有 |
| `dsh-purge*` / `dshpg-*` 段约定 | 基准 |
| `purge_*` 工具 | 基准 |

AuraBot 只依赖公开宿主 API 和段名约定，不 import purge 内部模块；当前验证 1.7.20。

1.7.20 相对 1.7.18 只改了 `assemble` 包装的 disposer 复用、补丁状态判断和 refusal retry，不改变 `dsh-purge*` 段名、`purge_*` 工具或 `rewritePromptAssembly` 的公开行为；DSH 0.2.2-rc.4 只修模型异常和 LiveShare，不改插件 API。

## 试过的实现与结论

| 方案 | 做法 | 结果 |
|---|---|---|
| A. 组装阶段把锁定句贴在 `dsh-purge` 段前 | `system-prompt/assemble` 监听改 section 文本 | 失败：purge 的 `leadWithInject()` 会丢弃旧 `dsh-purge` 段并重建 |
| B. persona 变量尾部加身份锁定 | `{{aurabot_identity_lock}}` | 有效，但 purge 把注入排在最前，人设位于长注入之后 |
| C. `llm/stream` 监听里重建 options | `next(rewritten)` | 失败：cordis waterfall 的 `next()` 不转发参数；purge 监听调用 `next()` 时会把改写丢掉 |
| D. 包 `llm.stream` 服务方法 | 替换 service 方法 | 失败：真实 DSH 的服务方法只读，赋值被忽略 |
| E. **包 provider adapter 的 `prepareCall/stream`** | 在 adapter 出口搬人设块 | **采用**：不依赖监听顺序，1.7.20 接缝测试通过；DSH 0.2.2-rc.4 的插件 API 与 rc.3 一致 |
| F. `excludePresets` 排除 aurabot 预设 | 保留宿主补丁、去掉注入 | 可选退路；会失去 purge 提示词注入，不作为默认 |

最终结构：

1. 四个大肥鱼预设的 persona 前缀用 `<!-- AURABOT:PERSONA:START/END -->` 包住人格卡、规则和身份锁定；
2. `src/integration/persona-hoist.js` 包住每个 provider adapter 的 `prepareCall` 与 `stream`；
3. 只对 `sessionId` 属于 Aurabot QQ 会话的请求生效，把标记块搬到第一条 system 消息最前，并移除标记；
4. `src/integration/purge-scope.js` 继续负责维护工具名、会话工具闸和执行约束段；
5. 人格块内文字语义原样保留，不解析、不改写；purge 会对连续空格做空白归一（`甲  乙` → `甲 乙`），这是已知差异。

## 验证

```bash
node --test test/purge-scope.test.js test/purge-scope-integration.test.js test/persona-hoist.test.js

# 指定下载下来的 purge 1.7.20 源码，避免只测本机旧版
PURGE_IDENTITY_PATH=/tmp/dsh-purge-1.7.20/kingcharleslzy-ai-dsh-purge-553fb93/lib/identity.js \
  node --test test/purge-scope-integration.test.js
```

真实 DSH 隔离 profile（`DSH_HOME` 临时目录、OneBot mock、fake OpenAI 服务）：

- purge 1.7.20 + AuraBot 1.5.10：接缝改写链；真实 QQ 回执需在已安装环境按下面命令复核；
- 两者的模型请求 system 都以人格卡开头，`【身份锁定】` 在 purge 注入之前，`AURABOT:PERSONA` 标记已移除。

## 已知限制（不是故障，但影响“完美兼容”）

- **工具级审批**：dsh-purge 默认把 approval 服务、工具管线和 sandbox 提权改成自动放行；AuraBot 的 `approval/request` QQ 中继在装 purge 的机器上不会触发。危险命令仍有 `danger.js` 的 QQ 确认。需要工具级审批时，把 purge 的 `tuning.permissionPatches` 设为 `false` 并重新 apply，或把确认逻辑迁到 `tools/pre-execute`。
- **执行约束是寄生的**：`dsh-purge:aurabot-exec` 只有存在非空 `dsh-purge` 段时才插入；注入为空、预设被排除或宿主 #40 补丁缺失时会静默消失。
- **人设前置依赖 adapter**：`ctx.llm` 未就绪时 `persona-hoist` 不会包装 provider；现在会打 warn，但不会自动重试。
- **升级韧性**：`session.header.agentPreset`、`llm.adapters`、assemble 的 `agent` 上下文和 #40 精确字符串补丁都不是稳定契约；DSH 换版后要跑一次 `purge_status` + 真实请求检查。
