# 宿主兼容判定（DSH 0.2.2-rc.3 · purge 1.7.20）

唯一兼容目标：**DSH Desktop `0.2.2-rc.3`**（`/Applications/DeepSeek Harness.app`，`@deepseek-ai/dsh-desktop-runtime@0.2.2-rc.3`）+ **dsh-purge `1.7.20`**。

要回答的问题只有一个：**仓库里有没有「已证实仅服务 rc.5」的代码**。结论：**当前没有找到**。下面是判据，不是印象。

## 1. 判定方法

1. 从插件源码里枚举所有宿主接触面：`ctx.*` 服务、`ctx.on()` 事件名、`cordis.patch.yml` 里引用的 `@deepseek-ai/*` 插件包。
2. 逐个在 rc.3 的安装目录里找同名符号/同名包（`node_modules/@deepseek-ai/*`）。
3. 找不到的符号才算「rc.3 无」；找到的按「rc.3 原生契约」处理，不删。
4. 判定完在 Mini 上实跑一次（插件加载 + 面板 + 一条会话），确认没有被静态检查漏掉的运行时差异。

## 2. 宿主服务与方法

| 插件用法 | 出现位置 | rc.3 证据 | 结论 |
|---|---|---|---|
| `ctx.on('approval/request')` | `src/security/approval.js` | `dsh-acp/lib/index.js` 有同名事件 | rc.3 原生 |
| `ctx.on('llm/adapters-updated')` | `src/integration/persona-hoist.js` | `dsh-client-ui-model-selection` 有同名事件 | rc.3 原生 |
| `ctx.on('session/event')` | `src/chat/session-events.js` | `dsh-tool-jobs` / 会话层有同名事件 | rc.3 原生 |
| `ctx.on('system-prompt/assemble')` | `src/integration/purge-scope.js` | `dsh-working-directory/lib/index.js` 有同名事件 | rc.3 原生 |
| `ctx.on('tools/pre-execute')` | `src/security/danger.js` | `dsh-tool-jobs/lib/index.js` 有同名事件 | rc.3 原生 |
| `ctx.systemPrompt.variable()` | `src/host/prompt-vars.js:22` | `dsh-system-prompt/lib/index.js:312` | rc.3 原生 |
| `agent.ctx.systemPrompt.context()` | `src/chat/mount.js:132` | `dsh-system-prompt/lib/index.js:281` | rc.3 原生 |
| `agent.ctx.tools.register()` | `src/chat/mount.js:123`、`src/core/bridge.js:155` | `dsh-tools/lib/index.js` 有 `register` | rc.3 原生 |
| `agent.ctx.tools.restrict({allow|deny})` | `src/chat/tool-scope.js:31`、`src/chat/mount.js:72` | `dsh-tools/lib/index.js:453`，且要求 scoped context——插件传的正是 `agent.ctx` | rc.3 原生 |
| `agent.ctx.tools.guard()` | `src/chat/mount.js:163` | `dsh-tools/lib/index.js` 有 `guard(` | rc.3 原生；插件还加了 `typeof === 'function'` 兜底 |
| `ctx.webServer.register()` | `src/host/http.js` | `dsh-host-open-in-app` 等使用同名服务 | rc.3 原生 |
| `ctx.workspaceRegistry` | `src/host/overview.js` | `dsh-workspace` | rc.3 原生 |
| `ctx.createTransport()` | `src/channels/qq/transport.js` 等 4 处 | `dsh-acp` 等 | rc.3 原生 |
| `ctx.llm` / `ctx.get('llm')` | `src/host.js:244`、`src/core/llm.js` | `dsh-agent-default-model` 提供 `llm` 服务 | 两种取法都保留：`ctx.llm` 访问器在 rc.3 可用，`ctx.get` 是 cordis 通用兜底 |
| `llm.currentSelection` | `src/core/llm.js:11` | `dsh-agent-default-model/lib/index.js` | rc.3 原生（有 `typeof` 探测） |
| `llm.resolveModelInfo` | `src/core/llm.js:38,91,121,136` | `dsh-acp/lib/index.js`、`dsh-api-session-controller` | rc.3 原生（有 `typeof` 探测） |
| 子智能体结果 `stopReason` | `src/chat/run-subagent-turn.js:66` | `dsh-subagent/lib/index.js`：`SubagentResult['stopReason']` | rc.3 原生，不是新版专属 |
| 消息块 `type: 'text' / tool-call / tool_use` | `src/chat/run-subagent-turn.js` | `dsh-acp/lib/index.js` 的类型化 content | rc.3 原生 |

## 3. preset 插件包

`cordis.patch.yml` 引用的 13 个包在 rc.3 全部存在：

```text
@deepseek-ai/dsh-agent-preset          @deepseek-ai/dsh-persona
@deepseek-ai/dsh-time-context          @deepseek-ai/dsh-command-compact
@deepseek-ai/dsh-compaction-basic      @deepseek-ai/dsh-compaction-tool-result-pruner
@deepseek-ai/dsh-tool-bash             @deepseek-ai/dsh-tool-pwsh
@deepseek-ai/dsh-tool-fs               @deepseek-ai/dsh-tool-fs-search
@deepseek-ai/dsh-tool-web              @deepseek-ai/dsh-tool-jobs
@deepseek-ai/dsh-tool-schedule
```

核对命令：

```bash
D="/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai"
grep -oE "@deepseek-ai/[a-z0-9-]+" cordis.patch.yml | sort -u | while read -r p; do
  n="${p#@deepseek-ai/}"; [ -d "$D/$n" ] && echo "OK $p" || echo "MISS $p"; done
```

## 4. purge 1.7.20

- Air 与 Mini 上的 `dsh-purge-community@1.7.20` 是同一份：`lib/identity.js` 的 sha256 都是
  `d0f89b96904b4251f1274d3695c3e302161f09159b34ad4a6878299c3529e44c`。
- Air 上 `test/purge-scope-integration.test.js` 会真的加载它（不是跳过）：`tests 1 / pass 1 / skipped 0`。
- 插件不 import purge 内部模块，只依赖 `dsh-purge*` 段名与 `rewritePromptAssembly` 的公开行为（见 `docs/PURGE-COMPAT.md`）。

## 5. 结论与后续判据

- **删除结论：无。** 没有一处宿主接触面是「rc.3 无、只有 rc.5 有」。
- 两处双形态兼容分支（`stopReason`、字符串/对象消息块）在 rc.3 都是有效契约，**保留**，只在审计里标 `keepDoc`（把「为什么两种形态都要处理」写清）。
- 以后如果 DSH 再升版，按第 1 节的方法重跑；只要某个符号在目标版本里不存在，且没有第二形态兜底，那才是候选删除项。
- 当前保留的「防御式写法」（`typeof x === 'function'`）不算 rc.5 代码：它们服务的是宿主未就绪/服务缺失时的降级，删了会让失败变成异常。
