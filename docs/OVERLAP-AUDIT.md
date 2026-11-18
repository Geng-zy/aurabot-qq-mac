# 与 DSH 的能力重叠审计

对照 DSH `0.2.2-rc.4` 的包清单（`@deepseek-ai/dsh-*`）。结论分三类：真重复、名义重复但不等价、AuraBot 独有。

## 真重复，已处理

| 能力 | AuraBot 旧实现 | DSH 对应 | 处理 |
|---|---|---|---|
| 插件更新检查/一键更新 | `src/core/update.js`、`/update/check`、`/update/apply`、面板更新卡 | `dsh-plugin-manager`、`dsh-plugin-market`、桌面更新器 | 已删除自更新；只保留 `/changelog` 版本说明，更新交给 DSH 插件管理器 |
| 旧模块源码路径 | `src/modules/qq-api/*`、`qq-tools/*`、`qzone-social/*`、`features/qzone-social.js` | 无直接对应，但只是 re-export | 已删除；外部模块迁移时改新路径 |

## 名义重复但不等价，保留

| 能力 | 为什么保留 |
|---|---|
| `src/core/community.js` + 模块库 | 装的是 AuraBot 自己的 `.mjs` 模块，不是 DSH 插件；`dsh-market` 不能安装这种模块。面板名为「模块库」，并在说明里区分上游参考和本分支可安装 |
| `src/core/models-list.js` | 按用户临时填的 `baseUrl + apiKey` 问外部生图/ASR/向量/精排服务的 `/models`；DSH 只知道 profile 里注册的 provider |
| `src/tools/tools.js` | DSH `defineTool` 的 `parameters` 是 schema spec，AuraBot 模块一直传 JSON Schema，还要 `slow`/`render` 元数据；这是适配层，直接 re-export 会改坏所有模块工具 |
| `src/core/modules.js` | 和 Cordis 插件生命周期有重叠，但 AuraBot 模块是「按 QQ 会话挂载的能力」，不是 profile 级插件；整体迁移属于 P2 |
| `src/core/config.js` + 面板设置 UI | 通用表单/持久化与 `dsh-settings` 重叠，但 AuraBot 有大量 QQ/心智域配置；迁到 DSH settings schema 属于 P2 |

## 看起来重复，但属于 AuraBot 产品能力

- QQ 渠道、OneBot、群策略、引用/合并转发、QQ 输出拆条；
- 心智核心（长期人格、关系、情绪、记忆、念头）；
- 动态人格/规则变量（DSH persona 是静态 prefix/suffix）；
- TTS/RVC/翻唱/生图/空间日记/表情库/视频；
- 审批转 QQ、her-voice、备份/云备份、工作区搬家；
- `src/integration/persona-hoist.js`（purge 排序 workaround）和 `purge-scope.js`（维护工具收窄）。

## 后续 P1/P2

- P1：`usage.js`、`tasks.js`、`chat-log.js`、`recent-media.js` 改成 DSH 会话/任务/附件数据的投影；`danger.js` 黑名单交给 DSH 审批，只留 QQ 中转；确认 `host/http.js` 能否复用 DSH 路由鉴权。
- P2：`modules.js` 逐步改成 DSH 插件/MCP/skill；`client/client.js` 通用 UI 迁移到 `client-ui-primitives`/`client-ui-settings`；删除旧模块兼容层。

## P1 复核（beta/1.5.10）

| 项 | 复核结论 | 处理 |
|---|---|---|
| `danger.js` 交给 DSH 审批 | 当前组合里 dsh-purge 把 DSH 的 approval 服务改成自动放行；删掉本地守卫会失去唯一 QQ 确认 | 保留守卫，只把规则/shell 解析拆到 `danger-rules.js`，行为不变 |
| `usage.js` → DSH sessionStats | DSH 的 stats 只有 turns/steps/耗时，没有 token、费用和模块归因 | 保留 AuraBot 的按调用账本 |
| `tasks.js` → DSH jobs | DSH jobs 面向 shell 后台进程；生图/翻唱需要自己的排队长、取消、发送未确认状态 | 保留创作任务状态机 |
| `chat-log.js` → DSH session query | session query 有会话日志，但没有 QQ 聊天的按天保留、管理员私聊隐私标记和空间/日记读取语义 | 暂保留，后续做只读投影再替换 |
| `recent-media.js` → DSH attachment | attachment store 没有“最近 N 张给模型选”的公开选取接口 | 保留短期引用缓存 |
| `host/http.js` → DSH 路由鉴权 | DSH `webServer.register` 只做路由匹配，没有插件路由级鉴权中间件 | 保留本机/Host/CSRF 闸 |

P1 只做了可证明不改变行为的拆分；把上面这些直接删掉会改变权限或数据语义，不属于中等风险。
