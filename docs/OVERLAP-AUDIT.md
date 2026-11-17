# 与 DSH 的能力重叠审计

对照 DSH `0.2.2-rc.3` 的包清单（`@deepseek-ai/dsh-*`）。结论分三类：真重复、名义重复但不等价、AuraBot 独有。

## 真重复，已处理

| 能力 | AuraBot 旧实现 | DSH 对应 | 处理 |
|---|---|---|---|
| 插件更新检查/一键更新 | `src/core/update.js`、`/update/check`、`/update/apply`、面板更新卡 | `dsh-plugin-manager`、`dsh-plugin-market`、桌面更新器 | 已删除自更新；只保留 `/changelog` 版本说明，更新交给 DSH 插件管理器 |
| 旧模块源码路径 | `src/modules/qq-api/*`、`qq-tools/*`、`qzone-social/*`、`features/qzone-social.js` | 无直接对应，但只是 re-export | 标记 `@deprecated`，下个大版本删除 |

## 名义重复但不等价，保留

| 能力 | 为什么保留 |
|---|---|
| `src/core/community.js` + 模块市场 | 装的是 AuraBot 自己的 `.mjs` 模块，不是 DSH 插件；`dsh-market` 不能安装这种模块。面板已改名为「AuraBot 模块库」并在说明里区分 |
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
