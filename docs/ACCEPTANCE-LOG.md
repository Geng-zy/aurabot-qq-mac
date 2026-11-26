# 验收记录（每批四类证据）

每一批都要留四类证据，缺一类就不算通过：

1. **自动测试**：Air 上的全量 `node --test` + 语法检查 + lint + 清单独闸门；
2. **模拟网关**：fake DSH + mock OneBot 的接线回归（离线，不代表真实送达）；
3. **真实 Purge 模块**：用 `dsh-purge-community@1.7.20` 的真实 `lib/identity.js` 跑改写链（不是跳过）；
4. **Mini 实机**：候选包安装、DSH 重启后的版本、面板与实机行为、回滚点。

Air 与 Mini 的 purge 是同一份二进制：`lib/identity.js` 的 sha256 都是
`d0f89b96904b4251f1274d3695c3e302161f09159b34ad4a6878299c3529e44c`（判定见 HOST-COMPAT.md）。

---

## B0 · 清单 / 口径 / README 核对 / rc.5 判定

范围：只动文档、README、脚本、CI 与新增清单闸门，**不改运行时代码**（语音修复是接手前就在工作区的 1.6.31 改动）。

### 1. 自动测试（Air）

```text
基线（接手时，HEAD 3658ee3 + 未提交 1.6.31）：1572 pass / 0 fail / 0 skipped
本批结束：                                    1575 pass / 0 fail / 0 skipped
语法检查：559 个文件通过（src + scripts + client + test）
oxlint：0 error / 165 warning（282 文件，97 规则）
client 构建：node scripts/build-client.mjs 后 git status client/ 无漂移
清单独闸门：test/repo-inventory.test.js 3/3 通过（覆盖 627 个文件、0 待审、0 幽灵条目）
```

### 2. 模拟网关（Air，离线）

`test/e2e.test.js` 用 `test/helpers/fake-dsh.js` + `test/helpers/mock-onebot.js`（真 WebSocket 握手与帧编解码）跑完整插件入口；本批改动不触碰收发路径，回归全绿。真机送达仍需 Mini 实机，见第 4 段。

### 3. 真实 Purge 模块（Air）

```bash
dsh-node --test test/purge-scope-integration.test.js test/persona-hoist.test.js test/purge-scope.test.js
# tests 17 / pass 17 / fail 0 / skipped 0
```

集成用例真的加载了 `~/.dsh/profiles/desktop/node_modules/dsh-purge-community/lib/identity.js`（1.7.20），不是跳过分支。

### 4. rc.5 判定（证据）

插件用到的 5 个宿主事件、6 个服务、`stopReason`、`currentSelection`、`resolveModelInfo`、13 个 preset 插件包，逐项在 rc.3 安装目录里找到同名符号与实现，详见 `docs/HOST-COMPAT.md` 的符号表。

结论：**没有仅服务 rc.5 的代码，本批无需删除宿主分支**。两处双形态兼容（`stopReason`、字符串/对象消息块）在 rc.3 都是有效契约，保留并标 `keepDoc`。

### 5. Mini 实机（Mac mini · gengmac-mini · 100.89.128.72）

回滚点：`~/aurabot-release-backups/20261126-023334/`（旧 `dsh-aurabot-qq-final21.tgz` + profile `package.json` + `pnpm-lock.yaml`）。

部署：候选包 → `/tmp/dsh-aurabot-qq-final21.tgz` → `pnpm install --ignore-scripts` → 强杀并重开 DSH。

```text
包：433 → 437 条目（新增 4 份维护文档），sha256 记录见下方“候选包”
安装：node_modules/dsh-aurabot-qq 的 src/host.js、src/voice/duration.js、src/voice/tts.js、
      src/chat/voice-file.js 四个文件 sha256 与 Air 候选完全一致
重启：2026-11-26 02:34:10 [info] [core] Aurabot v1.6.31 已加载｜总开关 开｜试运行 关
网关：2026-11-26 02:34:13 [onebot] 已连上 QQ 网关（WS）
面板：GET http://127.0.0.1:49811/aurabot/api/state → 200，version=1.6.31，
      onebot.state=connected（uin 3307726247 / 大肥鱼），modules 与 mind 数据齐全
真实 purge：用 mini 上的 dsh-purge-community@1.7.20 lib/identity.js 跑
      PURGE_IDENTITY_PATH=… node --test test/purge-scope-integration.test.js
      test/purge-scope.test.js test/persona-hoist.test.js → tests 17 / pass 17 / fail 0 / skipped 0
语音链路：安装后的包 synth「语音通道自检，一切正常。」→ durationFromFile 2.916s，
      audioDurationSec（发给 QQ 的值）= 3；磁盘上的旧 4096 字节空 WAV
      isZeroSampleWav=true、ensureAudible 抛「合成的语音是空的」
```

**部署陷阱（新增到 HANDOFF）**：`file:` 依赖按锁文件里的 integrity 判定，同版本号换包体时
`pnpm install` 一律报 `Already up to date`（`--force` 也一样）。必须删掉
`pnpm-lock.yaml` 里该包的两段记录 + `rm -rf node_modules/dsh-aurabot-qq`，再 install。

**本轮未做真实外发**：按总控要求，QQ/Telegram 的真实消息只在指定账号/会话/动作时发送。
语音条的网关接受性在 1.6.31 开发期已用真实 `send_private_msg` 验过（`retcode 0`），本批不重复外发。

### 6. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.31.tgz
条目      437（全部在 package/ 下，无日志/配置/备份/DSH 状态）
字节      19,624,472
sha256    214aaa95ee38929db9c2f74e87e7c33e6414655886af507da3473cd3628a88dd
提交      0eee0b5（main）
tag       v1.6.31 → 0eee0b5
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.31
资产      dsh-aurabot-qq-1.6.31.tgz  19,624,472 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45678269153（上一个 dispatch 45635963413 的
          macos-latest 失败原因是 "job was not acquired by Runner"，GitHub 容量问题，非代码）
```

Mini 上跑的就是这份 sha256 的包：安装后 `src/host.js`、`src/voice/duration.js`、
`src/chat/voice-file.js`、`client/client.js`、`docs/REPO-INVENTORY.md` 五个文件与 Air 逐一同哈希。

**push 事件没有自动触发 CI**（0eee0b5 推送后 `gh run list` 无新记录，actions 权限为 enabled），
所以用 `workflow_dispatch` 显式触发，与以往做法一致。

---

## B1 · 宿主组合根瘦身

范围：只动 `src/host.js` 与新增的 `src/host/*.js`、一个快照测试与 fixture。对外行为、路由表、配置键都不变。

### 改动

```text
src/host.js                 855 → 658 行（-197）
src/host/routes.js          新增 172 行：21 处 register*Routes 收敛成 registerAllRoutes(d)，133 条路由的唯一入口
src/host/backup-schedule.js 新增  87 行：云备份 pushJob/pushTimer/pushDueAt 与失败重排
src/host/mind.js            新增  89 行：createMindAdapter 的 18 个回调
src/host/avatar.js          新增  12 行：头像文件位置与状态（概览 + 头像路由共用）
test/host-routes.test.js    新增  54 行：路由快照 + 前缀/数量断言
test/fixtures/host-routes.json 新增 134 行：133 条路由快照
```

顺手修掉一个隐患：`scheduleRemoteBackup` 原来定义在路由注册之后，`setConfig` 早调用会踩 TDZ；现在调度器在组合根里先建后传。

### 1. 自动测试（Air）

```text
全量        1577 passed / 0 failed / 0 skipped（比 1.6.31 多 2 个：路由快照）
语法检查    564 个文件通过
oxlint      0 error / 164 warning（比 1.6.31 少 1 条）
client 构建 node scripts/build-client.mjs 后 git status client/ 无漂移
清单闸门    635 个文件全部有结论，0 待审
```

### 2. 模拟网关（Air）

`test/e2e.test.js` 全绿：fake DSH + mock OneBot（真 WebSocket 握手）跑完整入口，插件收发路径未改。

### 3. 真实 Purge 模块（Air + Mini）

```text
Air ：purge-scope-integration / purge-scope / persona-hoist → 17/17，跳过 0
Mini：同上 + host-routes.test.js → 19/19，跳过 0（用 mini 上装的 dsh-purge-community@1.7.20）
```

### 4. 路由契约

133 条路由重构前后逐条一致：`test/fixtures/host-routes.json` 在重构前由当前实现导出，重构后原样通过，
说明 `/aurabot/api/*` 一条没丢、一条没多。

### 5. Mini 实机

```text
回滚点  ~/aurabot-release-backups/20261126-094452（旧 final21.tgz + profile package.json + pnpm-lock.yaml）
安装    installed: 1.6.32（先清锁文件里的 file: 钉死，再 rm -rf 旧目录安装）
加载    2026-11-26 09:45:04 [core] Aurabot v1.6.32 已加载｜总开关 开｜试运行 关
网关    2026-11-26 09:45:07 [onebot] 已连上 QQ 网关（WS）
面板    GET /aurabot/api/state → version=1.6.32，onebot=connected
错误    日志里 [error] / 没起来 / Cannot / undefined is not 命中 0
同源    已装包的 host.js、routes.js、backup-schedule.js、mind.js、avatar.js 与 Air 候选逐一同哈希
```

**本轮未做真实外发**（按总控：真实平台发送需指定账号/会话/动作）。

### 6. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.32.tgz
条目      441（全部在 package/ 下）
字节      19,629,634
sha256    1c6ca6c25c0dc90d56dea24ad82de3814327336e47b3e0ff724d7ffe602108ca
提交      7d7ad39（main）
tag       v1.6.32 → 7d7ad39
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.32
资产      dsh-aurabot-qq-1.6.32.tgz  19,629,634 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45738085526（ubuntu + macos 双平台 success）
```

---

## B2 · 面板写操作闸显式化 + 重复回执收敛

范围：`src/host/`、`src/panel/`（新增）、5 个 `src/features/mind-*-routes.js` 的重复常量。**路由表不增不减（133 条）**。

### 修掉的真实缺陷

```text
GET /aurabot/api/notice/toggle
  → readBody 返回 {} → kind='approval'、value=true → setConfig 把 notice.approval 写盘
同类：/debug/say（空文本进调试回合）、/modules/tool、/modules/simulate、/modules/fork、
      /mind/permission/decide、/knowledge/rename、/backup/* 等共 20 条读包体的接口
```

### 改动

```text
src/host/post-only.js          新增  41 行：20 条「需要请求包体」的显式登记表
src/host.js                    route() 闸门：writeLike 词根 ∪ POST_ONLY；405 文案改「这个接口只能用 POST」
src/panel/route-kit.js         新增  20 行：MIND_OFF（原 5 份重复）+ ok/fail
test/panel-post-only.test.js   新增 102 行 4 个用例
```

### 1. 自动测试（Air）

```text
全量        1581 passed / 0 failed / 0 skipped（比 1.6.32 多 4 个）
语法检查    567 个文件通过
oxlint      0 error / 164 warning
client 构建 无漂移
清单闸门    639 个文件全部有结论，0 待审
```

**红-绿证据**：把闸门临时退回旧写法（只认路径词根）后，
「GET /notice/toggle 不再偷偷改配置」与「GET 一律 405」两条用例都失败；改回新闸门后全绿。
fixture 里把 `notice.approval` 设成 `false` 才能测出来（默认值是 `true`，空包体写回 `true` 看不出变化）。

### 2. 模拟网关（Air）

`test/e2e.test.js` 全绿；本批只动 HTTP 管理面的方法闸，不碰收发路径。

### 3. 真实 Purge 模块（Mini）

```text
Mini：purge-scope-integration / purge-scope / persona-hoist / host-routes / panel-post-only
      → tests 23 / pass 23 / fail 0 / skipped 0（用 mini 上装的 dsh-purge-community@1.7.20）
```

### 4. Mini 实机

```text
回滚点  ~/aurabot-release-backups/20261126-101717
加载    2026-11-26 10:17:30 [core] Aurabot v1.6.33 已加载｜总开关 开｜试运行 关
网关    2026-11-26 10:17:33 [onebot] 已连上 QQ 网关（WS）
面板    GET /aurabot/api/state → 200，version=1.6.33，onebot=connected
新闸门  GET /aurabot/api/notice/toggle → 405 {"ok":false,"message":"这个接口只能用 POST"}
读接口  GET /aurabot/api/state → 200（没有被误伤）
错误    日志 [error]/Cannot/undefined is not 命中 0
同源    post-only.js / route-kit.js / mind-live-routes.js 与 Air 逐一同哈希
```

### 5. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.33.tgz（443 条目，19,630,700 字节）
sha256    b200c819dce3aabda716e64447df2248bac57afdc2874161306df43ea3a00095
提交      e924276（main）
tag       v1.6.33 → e924276
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.33
资产      dsh-aurabot-qq-1.6.33.tgz  19,630,700 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45741622764（ubuntu + macos 双平台 success）
```

---

## B4 · 渠道层契约补齐

范围：`src/channels/index.js`（契约校验）、`src/channels/qq/features/{actions,profile}/`、两个新测试。路由表、caps 取值、数据格式都不变。

### 修掉的两处真实缺陷（都是先红后绿）

```text
1) profile 功能 files: ['qq-profile.js']
   → module-registry.fork() 按 src 相对路径读文件 → src/qq-profile.js 不存在 → 面板「复制内置模块」必 ENOENT
   证据：test/module-files-paths.test.js 在修前报 "profile: files=qq-profile.js"，修后 3/3 通过

2) QQ caps.recall = true，但连接上没有 recall 方法（只声明没实现）
   证据：validateChannel 新增 caps↔方法校验后，QQ 适配器一旦缺 recall 就注册失败；
         test/channels-caps.test.js 用「declared but missing」的反例先红，补上 recall 后全绿
```

### 改动

```text
src/channels/qq/features/actions.js   +recall(messageId)（delete_msg），7 行
src/channels/qq/features/profile/index.js  files 改成 src 相对路径
src/channels/index.js                 +CAP_METHODS（8 项能力→方法）+ validateChannel 校验，165 行
test/module-files-paths.test.js       新增 44 行 3 个用例
test/channels-caps.test.js            新增 48 行 5 个用例
```

### 1. 自动测试（Air）

```text
全量        1589 passed / 0 failed / 0 skipped（比 1.6.33 多 8 个）
语法检查    569 个文件通过
oxlint      0 error / 164 warning
清单闸门    642 个文件全部有结论，0 待审
```

### 2. 模拟网关（Air）

`test/channels-contract.test.js` + `test/gateway-resilience.test.js` + 新契约测试共 22/22：
QQ 适配器通过 `validateChannel`，Telegram 因为没声明这些能力不要求实现，重连/补发不受影响。

### 3. 真实 Purge 模块（Mini）

```text
Mini：purge-scope-integration / channels-caps / module-files-paths / channels-contract /
      host-routes / panel-post-only → tests 19 / pass 19 / fail 0 / skipped 0
```

### 4. Mini 实机

```text
回滚点  ~/aurabot-release-backups/20261126-104139
加载    2026-11-26 10:41:53 [core] Aurabot v1.6.34 已加载｜总开关 开｜试运行 关
网关    2026-11-26 10:41:56 [onebot] 已连上 QQ 网关（WS）
面板    GET /aurabot/api/state → 200，version=1.6.34，onebot=connected
闸门    GET /aurabot/api/notice/toggle → 405（B2 的闸门继续生效）
契约    日志里 caps./必须是函数/连接少了 命中 0（新校验没有误伤注册）
同源    channels/index.js、qq/features/actions.js、qq/features/profile/index.js 与 Air 同哈希
```

### 5. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.34.tgz（443 条目，19,631,840 字节）
sha256    5363157ff4e20f343e43a7b45923da6e0746b52e94910bd4d557e192b375dd9e
提交      f8181f0（main）
tag       v1.6.34 → f8181f0
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.34
资产      dsh-aurabot-qq-1.6.34.tgz  19,631,840 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45744321874（ubuntu + macos 双平台 success）
```

---

## B3（第一刀）· 单一注意力排序搬出 hub

范围：`src/chat/attention.js`（+105 行）、`src/chat/hub.js`（1471 → 1455 行）、一个新测试。

### 改动

```text
src/chat/attention.js   + createAttentionRanking({ ownerIn, getMind, attentionQueue, busy, pending, flush, isBusy, isDisposed })
                          priority / blocked / drain 三条纯策略，原来是 hub 里的三个函数
src/chat/hub.js         ownerIn 留在原地（它要 isOwner+getConfig），其余三条改成惰性委托
test/chat-attention-ranking.test.js  新增 75 行 6 个用例
```

踩到的坑（已修）：第一次直接在 hub 里 `createAttentionRanking({ isBusy, ... })`，
`isBusy` 是后定义的 `const` → `ReferenceError: Cannot access 'isBusy' before initialization`，
全量 363 个用例一起红。改成「函数声明 + 惰性委托」：`attentionPriority/attentionBlocked/drainAttention`
仍是提升的函数声明，`attentionRanking` 在 `createAttentionQueue` 之前才装配。

### 1. 自动测试（Air）

```text
全量        1595 passed / 0 failed / 0 skipped（比 1.6.34 多 6 个）
语法检查    570 个文件通过
oxlint      0 error / 164 warning（新模块一开始多 1 条未使用参数，已去掉）
清单闸门    644 个文件全部有结论，0 待审
```

### 2. 模拟网关（Air）

`test/e2e.test.js` 全绿：单一注意力在群聊排队、私聊优先等路径照旧。

### 3. 真实 Purge 模块（Mini）

```text
Mini：purge-scope-integration / chat-attention-ranking / panel-post-only / channels-caps
      → tests 16 / pass 16 / fail 0 / skipped 0
```

### 4. Mini 实机

```text
回滚点  ~/aurabot-release-backups/20261126-111115
加载    2026-11-26 11:11:29 [core] Aurabot v1.6.35 已加载｜总开关 开｜试运行 关
网关    2026-11-26 11:11:32 [onebot] 已连上 QQ 网关（WS）
面板    GET /aurabot/api/state → 200，version=1.6.35，onebot=connected
闸门    GET /aurabot/api/notice/toggle → 405（B2 照旧）
运行    注意力相关日志命中 21 行（她在按新的排序规则判断接不接话）
错误    日志 [error]/Cannot access/ReferenceError 命中 0
同源    src/chat/hub.js、src/chat/attention.js 与 Air 同哈希
```

### 5. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.35.tgz（443 条目，19,633,299 字节）
sha256    fdbfe95f812b3712f91a7c5bf0a443fc2ab35ca6fd226277e0ca6c561de17055
提交      73439e6（main）
tag       v1.6.35 → 73439e6
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.35
资产      dsh-aurabot-qq-1.6.35.tgz  19,633,299 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45747561541（ubuntu + macos 双平台 success）
```

---

## B3（第二刀）· 会话事件状态机先补测试、再拆记账规则

范围：`src/chat/session-events.js`（230 → 215 行，依赖 43 → 41）、新增 `src/chat/usage-accounting.js`、一个新测试。

### 改动

```text
src/chat/session-events.js     记账那段（20 行）改为调用 accountUsage；少 3 个依赖，多 1 个
src/chat/usage-accounting.js   新增 50 行：token 求和、system 会话累 st.system.tokens、
                               紧跟 tool/call 的算到工具模块、其余按 sessionTarget 的 provider/model
test/chat-session-events.test.js 新增 222 行 10 个用例（7 个状态机 + 3 个记账）
```

顺序说明：先写测试把现有行为钉住（7 条判定全绿），再抽记账规则，抽完测试不改语义只换依赖形状 —— 全程没有「先改代码再补测试」。

### 1. 自动测试（Air）

```text
全量        1605 passed / 0 failed / 0 skipped（比 1.6.35 多 10 个）
语法检查    572 个文件通过
oxlint      0 error / 164 warning
清单闸门    647 个文件全部有结论，0 待审
```

直接测试覆盖到的判定：正常一轮发一次、旧会话不发但释放、隐私拦截改发 `[沉默]`、
非正常结束不发但释放、工具用量归模块、system 轮次交 promise（不发 QQ）、调试等待方收正文。

### 2. 模拟网关（Air）

`test/e2e.test.js` 全绿；本批只动会话事件的内部组织，收发路径不变。

### 3. 真实 Purge 模块（Mini）

```text
Mini：purge-scope-integration / chat-session-events / chat-attention-ranking / panel-post-only
      → tests 21 / pass 21 / fail 0 / skipped 0
```

### 4. Mini 实机

```text
回滚点  ~/aurabot-release-backups/20261126-113643
加载    2026-11-26 11:36:58 [core] Aurabot v1.6.36 已加载｜总开关 开｜试运行 关
网关    2026-11-26 11:37:01 [onebot] 已连上 QQ 网关（WS）
面板    GET /aurabot/api/state → 200，version=1.6.36，onebot=connected
闸门    GET /aurabot/api/notice/toggle → 405
账本    usage.json 最近写入 11:35（记账路径在跑）
错误    日志 [error]/Cannot access/ReferenceError/accountUsage 命中 0
同源    session-events.js、usage-accounting.js 与 Air 同哈希
```

### 5. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.36.tgz（444 条目，19,635,147 字节）
sha256    9d7fb4da1f3d3dca0b2b23235e6719eea9e86103a2996e8ecb70a636116a5783
提交      df27b61（main）
tag       v1.6.36 → df27b61
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.36
资产      dsh-aurabot-qq-1.6.36.tgz  19,635,147 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45750233692（ubuntu + macos 双平台 success）
```

---

## B5（第一刀）· core zip 读取去重

范围：`src/core/zip.js`（+strict 读取者）、`src/core/community.js`（328 → 296 行）、`src/host.js`（错误日志补堆栈）、一个新测试。

### 判定先说：三种读取者不是重复实现

| 读取者 | 输入来源 | 策略 | 结论 |
|---|---|---|---|
| `zip.js readZip` | 模型权重包（`python.js`、`song/studio.js`） | 内存宽松、按 `want` 挑文件、不校验 CRC/不限大小 | 保留 |
| `zip.js readZipStrict` | 网络下载的社区模块包 | 拒绝加密、拒绝路径穿越、限解压总量、逐条校验 CRC 与长度 | **由 community.js 的内联实现搬来** |
| `backup.js readEntries/readEntry` | 备份文件 | 从文件句柄流式读、分块 CRC、4GB/目录上限、边解边写盘 | 保留（流式，不能整块进内存） |

真正重复的是「解析中央目录」这一段（community 里 40 行），已合并；三处策略与报错文案逐条保留，
`test/community.test.js` 原样通过（16/16）。

### 1. 自动测试（Air）

```text
全量        1611 passed / 0 failed / 0 skipped（比 1.6.36 多 6 个）
语法检查    573 个文件通过
oxlint      0 error / 164 warning
清单闸门    649 个文件全部有结论，0 待审
```

自测抓到自己引入的坑：`inflateRawSync({ maxOutputLength: Infinity })` 抛 `RangeError`，
现在只在有限上限时传（默认路径已不可能踩到）。

### 2. 模拟网关（Air）

`test/e2e.test.js` 全绿；本批只动 core 的解析与日志，不碰收发。

### 3. 真实 Purge 模块（Mini）

```text
Mini：purge-scope-integration / zip-readers / community / song
      → tests 40 / pass 40 / fail 0 / skipped 0
（第一次跑出 1 个失败是同步脚本没带 docs/，MODULE-TUTORIAL 那条读不到文件；
  补上 docs 后 40/40 —— 属于验证脚本的问题，不是代码问题，已修正同步范围）
```

### 4. Mini 实机

```text
回滚点  ~/aurabot-release-backups/20261126-120224
加载    2026-11-26 12:16:06 [core] Aurabot v1.6.37 已加载｜总开关 开｜试运行 关
网关    2026-11-26 12:16:09 [onebot] 已连上 QQ 网关（WS）
面板    GET /aurabot/api/state → 200，version=1.6.37，onebot=connected，modules=12
接口    GET /aurabot/api/modules → ok=true，12 条（严格 zip 读取者所在模块可用）
同源    src/core/zip.js、src/core/community.js、src/host.js 与 Air 同哈希（host.js 含新日志）
```

### 5. 待查（本批新增的观测点）

Mini 上 11:44–11:45 出现 2 次 `[error] [core] 处理消息出错： Cannot read properties of undefined (reading 'get')`，
近 5 天日志里**只有这一次**，没有堆栈。本批已把该日志改成同时打印消息所在聊天与前三条堆栈帧；
下次复现即可定位。消息处理失败不会中断机器人（`.catch` 兜住，后续消息正常）。

### 6. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.37.tgz（444 条目，19,636,565 字节）
sha256    03f146e9362ed84cec63d9ad46cb77f25f4bc5a75da96ba1064a99fe1322db41
提交      a6f76e8（main）
tag       v1.6.37 → a6f76e8
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.37
资产      dsh-aurabot-qq-1.6.37.tgz  19,636,565 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45754398866（ubuntu + macos 双平台 success）
```

---

## B5（第二刀）· 修线上故障：hub 漏传 pending（潜伏自 1.6.9）

### 故障与定位

```text
现象  [error] [core] 处理消息出错： Cannot read properties of undefined (reading 'get')
来源  Mini 上 11:44:55 与 11:45:43 各一次（近 5 天日志里唯一的 error），整条群消息被丢掉
定位  1.6.37 先给这条日志补了堆栈；本批再加一道机械核对：
      「每个 chat 工厂解构出的参数」 vs 「hub 调用时传的实参」
      → src/chat/group-context.js 的 addGroupImages 第一行 pending.get(...)，而 hub 漏传 pending
溯源  git log -L：createGroupContext 的调用点从 1.6.9「拆出群聊上下文」起就少这三个键
```

### 改动

```text
src/chat/hub.js                createGroupContext 补 pending（少传的第三键 attentionRetryTimers 在模块里从未使用，直接删）
src/chat/group-context.js      删死参数 attentionRetryTimers
src/chat/run-subagent-turn.js  删死参数 getMind
src/chat/run-system-turn.js    删死参数 chatOfSession / isOwner / parseChat
src/chat/session-create.js     删死参数 getMind
test/chat-wiring.test.js       新增 63 行 2 个用例：参数必须传齐 + 不许有僵尸参数
test/group-context-images.test.js 新增 62 行 3 个用例：入队/无队列/到上限
```

### 1. 自动测试（Air）

```text
全量        1616 passed / 0 failed / 0 skipped（比 1.6.37 多 5 个）
语法检查    575 个文件通过
oxlint      0 error / 157 warning（删掉 5 个死参数后从 164 降下来）
清单闸门    652 个文件全部有结论，0 待审
```

红-绿：`test/chat-wiring.test.js` 在修复前报
`group-context.js → createGroupContext 缺：pending、attentionRetryTimers`，补上 `pending` 后通过。

### 2. 模拟网关（Air）

`test/e2e.test.js` 全绿（含群消息带图、待发队列、合并多条这几条路）。

### 3. 真实 Purge 模块（Mini）

```text
Mini：purge-scope-integration / chat-wiring / group-context-images / chat-session-events / e2e
      → tests 125 / pass 125 / fail 0 / skipped 0
```

### 4. 验证流程本身的一个坑（已修正并记下）

前两次 Mini 跑测试出现假失败，原因都是 **rsync 只同步了部分目录**：
- 只带 `src test package.json` → `community.test.js` 的 MODULE-TUTORIAL 断言读不到 `docs/`；
- 只带 `src test docs package.json` → `e2e` 的人格断言读不到 `personas/dafeiyu.md`（4 个用例红）。

现在统一用整仓同步（排除 `node_modules`/`.git`/`*.tgz`），补齐后 125/125。

### 5. Mini 实机

```text
回滚点  ~/aurabot-release-backups/20261126-123933
加载    2026-11-26 12:39:38 [core] Aurabot v1.6.38 已加载｜总开关 开｜试运行 关
网关    2026-11-26 12:39:41 [onebot] 已连上 QQ 网关（WS）
同源    src/chat/hub.js、group-context.js、run-system-turn.js 与 Air 同哈希
监控    重启后日志新增 error 0（原来的 2 条是 11:44 的历史记录）
```

### 6. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.38.tgz（444 条目，19,637,179 字节）
sha256    259fa5c4e8433bfeb0f62e46821ed6329f4a4ee6a7e180cfe4c6253c4a3c01f5
提交      282936b（main）
tag       v1.6.38 → 282936b
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.38
资产      dsh-aurabot-qq-1.6.38.tgz  19,637,179 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45757754389（ubuntu + macos 双平台 success）
```

---

## B5（第三刀）· config.js 按「数据 / 规则 / 磁盘」拆开

范围：`src/core/config.js` 844 → 三份（177 / 261 / 430），三个源码契约测试按新结构改读取范围。

```text
src/core/config-defaults.js   261 行：DEFAULTS（纯数据）
src/core/config-normalize.js  430 行：normalize + deepMerge + isObj/bool/num/qq/list/hhmm/dateKey/headerLines/bodyText/normalizeNotice
src/core/config.js            177 行：loadConfig / saveConfig / publicConfig / mergeFromPanel / ownerAuthorizationRevision /
                              reconcilePlatformAliases / registerSecretField / OPT_IN_ON_UPDATE，并 re-export DEFAULTS 与 normalize
```

### 1. 自动测试（Air）

```text
全量        1616 passed / 0 failed / 0 skipped
语法检查    577 个文件通过（新增两份）
oxlint      0 error / 157 warning
清单闸门    655 个文件全部有结论，0 待审
```

拆的过程中出现 3 个红：
- `normalize` 里用了 `LEVELS`／`PROFILE_PERM_*`，import 跟着默认值表搬走了 → 补回；
- `config.js` 的 `parentOf`／`mergeFromPanel` 用 `isObj`／`deepMerge` → 两者改为从 normalize 导出并接上；
- 三个源码契约测试（browser-panel / security-panel / wording）断言某段文本在 `config.js` 里 →
  按新结构改读 `config-defaults.js`（默认值）与 `config-normalize.js`（归一化），**断言的事实一条没放松**。

### 2. 等价性实证（本批最关键的一条）

把 1.6.38 的 `config.js` 用 `git show` 临时放回 `src/core/__old_config.js`（相对 import 能解析），
让新旧两版 `normalize()` 跑同一批输入：

```text
SAME 空配置 / 老向导配置 / 脏值 / 语音段 / 人格与工作区 / 通知段 / 平台镜像 / 生图回退 / 旧称呼 / null 与数组
SAME DEFAULTS 完全一致（逐字节）
结论：normalize 行为完全等价
```

临时文件用完即删，没进仓库。

### 3. 真实 Purge 模块（Mini）

```text
Mini：purge-scope-integration / macos / features / security-panel / browser-panel / e2e
      → tests 140 / pass 140 / fail 0 / skipped 0
```

### 4. Mini 实机

```text
回滚点  ~/aurabot-release-backups/20261126-132045
加载    2026-11-26 13:20:51 [core] Aurabot v1.6.39 已加载｜总开关 开｜试运行 关
网关    2026-11-26 13:20:54 [onebot] 已连上 QQ 网关（WS）
配置    /aurabot/api/state → version=1.6.39，onebot=connected，ownerName=老板（真配置读出来了），
        security.ssrfMode=strict（归一化补的默认值生效）
同源    config.js / config-defaults.js / config-normalize.js 与 Air 同哈希
```

### 5. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.39.tgz（446 条目，19,637,779 字节）
sha256    f10e2fadd84bc379b5ca7172bc57d1f99aa2c0eba1069489f46d5cc51182ce0d
提交      a80baef（main）
tag       v1.6.39 → a80baef
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.39
资产      dsh-aurabot-qq-1.6.39.tgz  19,637,779 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45761620480（ubuntu + macos 双平台 success）
```

---

## B5（第四刀）· core 反向依赖 10 → 0

### 做法：纯逻辑下沉 + 旧路径留一行兼容出口

```text
搬进 core（全部 0 内部依赖，或只依赖 core）：
  src/channels/ids.js                              → src/core/ids.js          133 行
  src/chat/access.js                               → src/core/access.js       147 行（只依赖 ids）
  src/chat/group-policy.js                         → src/core/group-policy.js 145 行
  src/chat/chat-model.js                           → src/core/chat-model.js    65 行
  src/channels/qq/features/diary/qzone-audience.js → src/core/qzone-audience.js 51 行
  src/voice/wav.js                                 → src/core/wav.js           60 行

两条「真反向边」用两个小模块替掉：
  core/media → features/stickers（stickerPath）      → 新增 core/sticker-path.js   18 行（目录由调用方给）
  core/bridge → chat/reply（describeDelivery）        → 新增 core/delivery-text.js  24 行（纯函数）

旧路径全部保留为「一行 re-export」，现有 import 一处都不用改。
```

### 1. 自动测试（Air）

```text
全量        1618 passed / 0 failed / 0 skipped（比 1.6.39 多 2 个分层守卫）
语法检查    586 个文件通过（新增 8 个 core 文件 + 1 个测试）
oxlint      0 error / 157 warning（搬动过程中新增的 2 条未使用 import 已清）
清单闸门    665 个文件全部有结论，0 待审（6 个旧路径的结论改成「兼容出口」，8 个新文件补了结论）
```

新增 `test/core-layering.test.js`：
- core 的 import 里不许出现 chat/channels/features/voice/song/mind/mind-adapter/modules/local/persona；
- 6 个兼容出口必须只剩「一行 re-export」，防止实现又被写回旧路径。

### 2. 真实 Purge 模块（Mini）

```text
Mini：purge-scope-integration / core-layering / group-owner-tools / e2e / voice-asr
      → tests 129 / pass 129 / fail 0 / skipped 0
```

### 3. Mini 实机

```text
回滚点  ~/aurabot-release-backups/20261126-140340
上传    scp 首次 "Connection closed"（交接文档 §1.8 记过的网络抖动），重试一次成功，sha256 前缀 334e90ca 对上
加载    2026-11-26 14:03:45 [core] Aurabot v1.6.40 已加载｜总开关 开｜试运行 关
网关    2026-11-26 14:03:48 [onebot] 已连上 QQ 网关（WS）
面板    /aurabot/api/state → version=1.6.40，onebot=connected，modules=12
同源    core/ids、access、group-policy、sticker-path、delivery-text 与 Air 逐一同哈希
```

### 4. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.40.tgz（454 条目，19,640,438 字节）
sha256    334e90ca8336ef836b6c58f15c768763e8abf987bbcf4a2c79a1e0c591bcb1e8
提交      deddb6f（main）
tag       v1.6.40 → deddb6f
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.40
资产      dsh-aurabot-qq-1.6.40.tgz  19,640,438 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45766624146（ubuntu + macos 双平台 success）
```

---

## B5（第五刀）· backup.js 拆出 ZIP 编解码

范围：`src/core/backup.js` 1059 → 897 行，新增 `src/core/backup-zip.js`（198 行）。

```text
搬走：dosTime / localHeader / centralHeader（写）、readExact / readEntries / verifyEntryStreaming / readEntry（读），
      以及格式上限常量（MAX_ZIP 4GB、MAX_DIRECTORY 32MiB、MAX_EXPANDED 8GiB、MAX_MANIFEST、DEFLATE_MAX）与 MANIFEST 名
留下：备份什么（SKIP/CONFIG_ONLY_SKIP/skipped）、.restore 发布与 journal 回滚、会话恢复、保留策略、检查与列表
```

关键取舍：`readEntries` 原来内联了「哪些路径能进备份」的业务规则（safeName + skipped + 历史遗留标记）。
这些规则**没有跟着搬**——函数改成收一个 `checkName` 钩子，`backup.js` 把自己的规则原样传进去。
字节格式属于编解码，路径政策属于业务，两件事分开。

### 1. 自动测试（Air）

```text
全量        1618 passed / 0 failed / 0 skipped
备份专项    backup / backup-restart / backup-webdav / backup-push → 45/45
语法检查    587 个文件通过
oxlint      0 error / 157 warning
清单闸门    667 个文件全部有结论，0 待审
```

### 2. 真实 Purge 模块（Mini）

```text
Mini：purge-scope-integration / backup / backup-restart / backup-webdav / backup-push
      → 与 Air 同源的整仓测试（见下一段实机证据里同时跑的备份接口）
```

### 3. Mini 实机（数据路径真跑，非破坏性）

```text
回滚点  ~/aurabot-release-backups/20261126-142836
加载    2026-11-26 14:28:41 [core] Aurabot v1.6.41 已加载｜总开关 开｜试运行 关
网关    2026-11-26 14:28:44 [onebot] 已连上 QQ 网关（WS）
建备份  POST /aurabot/api/backup/create → ok
        aurabot-backup-20261126-062919-110-55eed39a.zip
        127 个文件 / 展开 21,412,957 字节 / 压缩后 18,892,788 字节 / 78 个会话
校验    POST /aurabot/api/backup/verify → { ok:true, verified:true, files:127, sessions:78, version:"1.6.41" }
负例    把同一份 zip 拷一份、改坏中间 1 个字节再用 verify：
        { ok:false, message:"备份文件校验失败：data/stickers/collected-9e93c9ed….gif" }
        —— 流式 CRC 校验器在真实数据上确实生效，不是空跑。测试副本已删除。
GET 闸门  GET /backup/verify → 405「这个接口只能用 POST」（B2 的闸门照旧）
```

**没有做真实恢复**：恢复会替换数据目录，属于破坏性操作；本批只验证写入与校验（含负例），
`.restore` 发布与回滚逻辑一行未改，继续由 `backup-restart` 的离线用例守着。

### 4. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.41.tgz（455 条目，19,642,759 字节）
sha256    46536851a8f8585cf85fefc11f22bd112b4d092b5651f70a7e69d6164e6fc6b2
提交      6f19adc（main）
tag       v1.6.41 → 6f19adc
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.41
资产      dsh-aurabot-qq-1.6.41.tgz  19,642,759 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45768663434（ubuntu + macos 双平台 success）
```

---

## B6（第一刀）· 心智核心的两处越界归位

```text
1) src/mind/local/runner.js（177 行 mlx_lm 进程管理）→ src/mind-adapter/local-runner.js
   证据：只 import node 内置；只被 mind-adapter 的 index / context-text / install 与一个测试引用；
        mind 里没有任何文件调用它。搬走后 src/mind/** 不再出现 child_process。
   旧路径保留一行 re-export（mind 里唯一的兼容出口，测试用白名单锁住）。

2) MAX_PERSONA_CHARS：persona/personas.js → src/core/persona-limits.js
   证据：mind/self 与 persona/personas 都要用这份上限，原本造成「mind → persona」唯一一条上行依赖；
        放中性层后两边都从 core 取；personas.js 仍 re-export，对外契约不变。
```

### 1. 自动测试（Air）

```text
全量        1620 passed / 0 failed / 0 skipped（比 1.6.41 多 2 个分层守卫）
语法检查    590 个文件通过
oxlint      0 error / 157 warning
清单闸门    671 个文件全部有结论，0 待审
```

新增 `test/mind-layering.test.js`（3 个用例）：
- mind 的 import 只许指向 mind 与 core；
- 兼容出口走显式白名单（当前只有 `src/mind/local/runner.js`），且必须只剩一行 re-export；
- mind 目录里不许出现 `child_process`。

搬运过程中踩了一次路径错误（shim 写成 `../mind-adapter/...`，少了一层），测试立刻报
`Cannot find module .../src/mind/mind-adapter/local-runner.js`，改成 `../../` 后恢复。

### 2. 真实 Purge 模块（Mini）

```text
Mini：purge-scope-integration / mind-layering / mind-core / mind-inner / mind-adapter / memory-upgrade
      → tests 78 / pass 78 / fail 0 / skipped 0
```

### 3. Mini 实机

```text
回滚点  ~/aurabot-release-backups/20261126-145446
加载    2026-11-26 14:54:51 [core] Aurabot v1.6.42 已加载｜总开关 开｜试运行 关
网关    2026-11-26 14:54:54 [onebot] 已连上 QQ 网关（WS）
面板    /aurabot/api/state → version=1.6.42，onebot=connected，mind 段有 sleep/usage/counts
心智    GET /aurabot/api/mind/self → ok，identity.name=大肥鱼（走 persona 常量那条路）
        GET /aurabot/api/mind/people → ok，人物列表正常
本地模型 POST /aurabot/api/mind/local/install/status → ok 结构完整
        （running=false / supported=true / root=~/Aurabot/mind / paths 齐全）
闸门    GET /mind/local/install/status → 405「这个接口只能用 POST」（B2 的闸门照旧）
错误    14:54 部署后新增 [error] 0 条（当天仅剩 11:44 那两条历史记录）
同源    mind-adapter/local-runner.js、core/persona-limits.js、mind/self/index.js 与 Air 同哈希
```

### 4. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.42.tgz（457 条目，19,643,757 字节）
sha256    500c12109a027ff2811d44e38a0e0a7400f46ec06cfff7ad1f033e95174e2515
提交      1dfecd8（main）
tag       v1.6.42 → 1dfecd8
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.42
资产      dsh-aurabot-qq-1.6.42.tgz  19,643,757 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45772378244（ubuntu + macos 双平台 success）
```

---

## B6（第二刀）· 适配层只看门面

### 现状与做法

```text
改前  mind-adapter 有 13 条 import 直连 mind 内部：
      clock / budget / memory/words / memory/vectors / memory/index / params / conversation / motivation / place / local/runner
改后  只剩两个入口：core 的通用件、mind/index.js 门面
      · 通用工具搬进 core（旧路径一行兼容出口）：clock(246) / budget→tokens(54) / memory/words→keywords(46)
      · 心智自己的策略由门面统一导出：paramOf / effortForScene / speechScene / wantsMeal / wantsOwnerChat /
        createEmbedClient / createRerankClient / parseJson（shortId、placeOf 本来就在门面上）
      · 适配层对自己目录里的 local-runner.js 直接引用，不再绕兼容出口
```

### 1. 自动测试（Air）

```text
全量        1622 passed / 0 failed / 0 skipped（比 1.6.42 多 2 个门面守卫）
语法检查    594 个文件通过
oxlint      0 error / 157 warning
清单闸门    676 个文件全部有结论，0 待审
```

新增 `test/adapter-facade.test.js`：
- mind-adapter 的 import 里，凡是指向 `../mind/*` 的只允许 `../mind/index.js`；
- 门面必须继续导出适配层要用的 10 个函数（少一个就红）。

### 2. 真实 Purge 模块（Mini）

```text
Mini：purge-scope-integration / adapter-facade / mind-layering / mind-adapter / mind-core
      → tests 49 / pass 49 / fail 0 / skipped 0
```

### 3. Mini 实机

```text
回滚点  ~/aurabot-release-backups/20261126-152544
加载    2026-11-26 15:25:49 [core] Aurabot v1.6.43 已加载｜总开关 开｜试运行 关
网关    2026-11-26 15:25:52 [onebot] 已连上 QQ 网关（WS）
面板    /aurabot/api/state → version=1.6.43，onebot=connected
心智    GET /aurabot/api/mind/self → ok，identity.name=大肥鱼（门面路径通）
错误    15:25 部署后新增 [error] 0 条
同源    core/clock.js、core/tokens.js、core/keywords.js、mind/index.js 与 Air 同哈希
```

### 4. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.43.tgz（460 条目，19,645,374 字节）
sha256    7eef698b2928d5d09efde3155d22b5b59b8bb1bdbdafd5bb258f3fd79eeb825a
提交      869e733（main）
tag       v1.6.43 → 869e733
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.43
资产      dsh-aurabot-qq-1.6.43.tgz  19,645,374 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45775841449（ubuntu + macos 双平台 success）
```

---

## B7（第一刀）· 面板样式清死码

```text
client/parts/styles.js   739 → 634 行（删 108 条规则 / 37 个死类名）
client/client.js         5887 → 5783 行（生成物，重新构建）
```

死类名判定分三层，逐层收紧：
1. 字面量：片段与模板里出现过这个名字；
2. 动态前缀：`ab-hit-${i}` 这种拼接，前缀算用到；
3. 复合选择器的根类名：`.ab-pm-search .ab-sel` 的根 `.ab-pm-search` 已死 → 整条规则永远匹配不到，
   这一层又抓出 5 条（第一轮只按「选择器全部类名都死」漏掉了它们）。

`.ab-select` 没有任何元素使用，从三条分组选择器里摘掉（`.ab-input,.ab-textarea` 保留）。

### 反向检查（用了但没有样式规则）

扫出 13 个，逐个核对后分两类：
- `ab-hit` / `ab-section` 只作为 **id** 使用（`'ab-hit-' + i`），不是类名 —— 误报；
- `ab-btn` / `ab-btn-small` / `ab-link` / `ab-feed` / `ab-settings-body` / `ab-overview-paths` 是
  **惰性挂钩**：元素上有 className，但没有对应规则，视觉上无影响。

对第二类**不做改动**：给它们补样式等于改外观，删 className 等于动 DOM，两者都超出「清死码」的范围。
这条记在这里备查，等这些页面真要重做时一起处理。

### 1. 自动测试（Air）

```text
全量        1624 passed / 0 failed / 0 skipped（比 1.6.43 多 2 个样式守卫）
语法检查    595 个文件通过
oxlint      0 error / 157 warning
清单闸门    678 个文件全部有结论，0 待审
client 构建 node scripts/build-client.mjs 重新生成，无漂移
```

新增 `test/client-css.test.js`：样式里每个 `.ab-*` 类都必须有人用（含动态前缀）；
`var(--ab-*)` 必须都有声明。

### 2. Mini 实机

```text
回滚点  ~/aurabot-release-backups/20261126-154704
加载    2026-11-26 15:47:09 [core] Aurabot v1.6.44 已加载｜总开关 开｜试运行 关
面板    /aurabot/api/state → version=1.6.44，onebot=connected
产物    装好的 client/client.js 里 `ab-pm` 命中 0（死规则确实没进包）
```

界面无法在无凭据下截图（DSH 面板要登录），本批是纯 CSS 删除 + 构建产物核对，
视觉风险由「规则只可能匹配不到」这一点兜住；样式守卫测试防止回潮。

### 3. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.44.tgz（460 条目，19,642,490 字节）
sha256    dfe33f4bc4ceabf4c2ebb9246117cbf8f4725b2cd2d07c556220571f5a119fed
提交      e59d503（main）
tag       v1.6.44 → e59d503
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.44
资产      dsh-aurabot-qq-1.6.44.tgz  19,642,490 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45778066468（ubuntu + macos 双平台 success）
```

---

## B7（第二刀）· 面板表单小工具收敛

```text
f.secret(path, props)        密钥框：type=password + 「已保存就不回显」占位，13 处手写 → 1 处
notify(toast, result, fb)    成功绿/失败红 + 文案取 message，21 处手写 → 1 处
secretPlaceholder(saved, o)  不走 f 的两处（extPage 通用字段、imageFallbacks 本地 input）也复用
生成物                        client/client.js 5809 行（比上一版 +26：多的是共享实现）
```

**为什么行数反而多了**：13 处密钥文案 + 21 处提示各只省一两个字符，共享实现本身 26 行。
这一刀换的是**locality**——以后改「已保存（不改就留空）」这句文案，只动 `secretPlaceholder` 一处；
改成功/失败的落点策略，只动 `notify` 一处。行数不是目标，「改一处忘一处」才是。

### 过程中被 lint 抓住的作用域问题

`notify` 第一版写成模块级函数直接调 `toast(...)`，oxlint 报 `no-undef: 'toast' is not defined`。
原因：`toast` 是页面组件拿到的 **prop**（在 `aurabotPanel`/`aurabotPage.js` 里创建后逐层传下去），
不是模块级函数。改成 `notify(toast, result, fallback)` 显式收进来；20 个调用点同步补参数。

### 1. 自动测试（Air）

```text
全量        1627 passed / 0 failed / 0 skipped（比 1.6.44 多 3 个表单守卫）
语法检查    596 个文件通过
oxlint      0 error / 158 warning
清单闸门    680 个文件全部有结论，0 待审
client 构建 重新生成，无漂移
```

新增 `test/client-form-kit.test.js`：
- 面板片段里不许再出现 `<x>Set ? '已保存…' : …` 这种手写占位；
- 不许再出现 `toast(x.message, x.ok ? …)`；
- 三个共享实现各自只有一份。

### 2. Mini 实机

```text
回滚点  ~/aurabot-release-backups/20261126-161851
加载    2026-11-26 16:18:56 [core] Aurabot v1.6.45 已加载｜总开关 开｜试运行 关
面板    /aurabot/api/state → version=1.6.45，onebot=connected
产物    装好的 client/client.js：
        function notify(toast, result …) 命中 1；secretPlaceholder 命中 3；
        `toast(r.message, r.ok ?` 命中 0（旧写法清零）
同源    client/parts/useField.js、client/client.js 与 Air 同哈希
```

### 3. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.45.tgz（460 条目，19,644,499 字节）
sha256    5e8d131791fc393fa8e84fe49ebf3dc4a56273c67715b40292d02e81a968c9c7
提交      726a782（main）
tag       v1.6.45 → 726a782
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.45
资产      dsh-aurabot-qq-1.6.45.tgz  19,644,499 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45783100852
          ubuntu 先绿；macos 在 GitHub 排队约 12 分钟后跑完，最终双平台 success
```

---

## B8（第一刀）· 本地脚本的信任链真正落地（安全相关）

### 缺陷（声明了但没执行）

```text
approved(slot)     写好了，但 call() 从来没调用 → 「改了脚本要重新确认」只是个传说
status()           approved 硬编码 true → 面板的「确认这个脚本」按钮永远不出现
结果               用户改过的本地脚本会被静默执行
```

### 改动

```text
src/local/local.js
  trustState(slot)   纯查询：{ hash, approved, firstUse }，不写盘
  rememberTrust()    首次使用（TOFU）才写 .trusted.json
  approved()         改成 trustState 的便捷视图
  call()             导入脚本前校验：firstUse → 记 TOFU 放行；已确认但指纹变了 → 抛
                     「xxx 在确认之后又改过了：去面板「本地脚本」里点「确认这个脚本」再用」
  status()           报真实 approved / firstUse（不再是硬编码 true）
降级               被拒时 TTS/生图等照旧回退内置引擎（hub 那层本来就有 try/catch），功能不卡死
```

### 1. 自动测试（Air）

```text
全量        1631 passed / 0 failed / 0 skipped（比 1.6.45 多 4 个）
语法检查    597 个文件通过
oxlint      0 error / 158 warning
清单闸门    682 个文件全部有结论，0 待审
```

新增 `test/local-trust.test.js`（4 个用例，每个用例独立数据目录）：
TOFU 记指纹 / 改脚本后 call 拒绝 / 面板确认后恢复且执行新脚本 / status 只读不写盘。

### 2. Mini 实机（造临时脚本走一遍完整链路，验完清理）

```text
1) 放进脚本         status → exists=true approved=false firstUse=true
2) POST /local/trust 「脚本已确认；以后改了脚本要重新确认」
                    status → approved=true firstUse=false
3) 改脚本            status → approved=false（指纹变化被识别）
清理                删脚本与 .trusted.json、从 config.local.hashes 移除 tts；
                    status 恢复「无脚本」，面板 ok=true
```

另外：这台机器本来就没有本地脚本（5 个 slot 全空），所以这次改动在生产路径上不会改变现有行为；
上面的链路是用临时脚本证明的。

### 3. 真实 Purge 模块（Mini）

```text
Mini：purge-scope-integration / local-trust / local / features → tests 16 / pass 16 / fail 0 / skipped 0
```

### 4. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.46.tgz（460 条目，19,645,525 字节）
sha256    e860442a78337341489a144d9e0c4b9c4637cba82f699cb7474d4ffbe8fd68e3
提交      03661fb（main）
tag       v1.6.46 → 03661fb
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.46
资产      dsh-aurabot-qq-1.6.46.tgz  19,645,525 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45787267928（ubuntu + macos 双平台 success）
```

---

## B8（第二刀）· 宿主维护工具发现加固

### 改前 / 改后

```text
改前  1. tools.view(agent).restrictableNames
      2. 探针 restrict({deny:[probe]}) → 从英文报错里正则抠名单
      失败 → []（等于「没有要限制的维护工具」= 放行方向）

改后  1. tools.view(agent).restrictableNames      rc.3 有，首选
      2. tools.view(agent).knownNames            新增的备份字段（同一个 view 对象里）
      3. 探针报错 → parseKnownToolNames(message)  抽成纯函数，单独测
      失败 → null（未知），调用方按「不限制」处理，并留 debug 说明
```

### 宿主侧事实（rc.3 安装目录里查的，不是猜的）

```text
/Applications/DeepSeek Harness.app/.../dsh-tools/lib/index.js
  488  const restrictableNames = new Set();
  487  const knownNames = new Set();
  502  return { visible, knownNames, restrictableNames, … }
  466  报错文案：… known global tools: … 或 "(none)"
```

### 1. 自动测试（Air）

```text
全量        1640 passed / 0 failed / 0 skipped（比 1.6.46 多 9 个）
语法检查    598 个文件通过
oxlint      0 error / 158 warning
清单闸门    684 个文件全部有结论，0 待审
```

新增 `test/host-tools.test.js`（9 个用例）：四条发现路径逐一验证、`parseKnownToolNames` 容错
（引号 / 中文冒号 / 中英文逗号 / `(none)`）、`purge_` 前缀过滤、失败时只留 debug 不刷 warn。

**踩到一个连带影响**：第一版在探测失败时打了 `warn`，把 `system-session-backoff` 里
「warn 计数 = 3」的断言顶成 4。这个函数每个会话挂载都会走一次，`warn` 会刷屏，
改成 `debug` 并把测试的断言改成「只留 debug、不刷 warn」。

### 2. 真实 Purge 模块（Mini）

```text
Mini：purge-scope-integration / host-tools / purge-scope / persona-hoist
      → tests 26 / pass 26 / fail 0 / skipped 0（用 mini 上装的 dsh-purge-community@1.7.20）
```

### 3. Mini 实机

```text
回滚点  ~/aurabot-release-backups/20261126-172426
加载    2026-11-26 17:24:30 [core] Aurabot v1.6.47 已加载｜总开关 开｜试运行 关
面板    /aurabot/api/state → version=1.6.47，onebot=connected，modules=12
错误    部署后新增 [error] 0 条
同源    src/integration/host-tools.js 与 Air 同哈希
```

**证据边界（不夸大）**：`hostMaintenanceToolNames` 需要会话级 agent，只在挂载会话时执行；
本轮没有让真实 QQ 账号发消息触发挂载，所以「在 mini 上真的认出了 purge_* 三条工具」这件事
**没有直接日志证据**。可核对的事实是：rc.3 的 `view()` 确实返回 `restrictableNames`/`knownNames`（上面引了行号）、
四条路径都有单测、真实 purge 1.7.20 的集成用例全过、mini 启动无报错。

### 4. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.47.tgz（460 条目，19,646,706 字节）
sha256    f9e0c7f7739f2d0ca91202feac30b3388f9edc4f3ac3b8f6c61712772c94f931
提交      4e27afa（main）
tag       v1.6.47 → 4e27afa
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.47
资产      dsh-aurabot-qq-1.6.47.tgz  19,646,706 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45792379376
          ubuntu 先绿；macos 排队约 20 分钟后跑完，最终双平台 success
```

---

## B8（第三刀）· 当前预设的来源加固

### 假设与宿主事实

```text
我们的旧假设   session.header.agentPreset = 这个会话现在跑的预设
宿主文档       "The creation header names the preset a session STARTED with, and it is deep-frozen"；
               "Reconstruction reads the `agentPreset` Session projection, never the header alone."
               （dsh-agent-preset-registry/lib/types/session.js:1-12）
结论           header 是创建事实；会话中途换预设后它是过期的，而我们正好用它决定人设/执行约束
```

### 改动

```text
src/integration/purge-scope.js
  presetOfAgent(agent, lookup)    优先级改为：自记 > agent.preset > session.header.agentPreset
  createPurgeScope().notePreset()  建会话成功时记下当前预设
  createPurgeScope().presetFor()   查询（installPromptGuard 通过它拿到，不再直接摸 header）
  createPurgeScope().forgetPreset() 会话销毁时清
src/chat/session-create.js        建会话成功（含重挂成功）后调用 notePreset
src/chat/hub.js                   把 notePreset 接到 purge 上
```

### 1. 自动测试（Air）

```text
全量        1644 passed / 0 failed / 0 skipped（比 1.6.47 多 4 个）
语法检查    599 个文件通过
oxlint      0 error / 158 warning
清单闸门    686 个文件全部有结论，0 待审
```

新增 `test/purge-preset.test.js`（4 个用例）：自记优先于 header（用 header=private、记成 social 的场景）、
退回 agent.preset、退回 header、取不到 id/抛错、遗忘。

### 2. 真实 Purge 模块（Mini）

```text
Mini：purge-scope-integration / purge-preset / persona-hoist / system-session-backoff
      → tests 32 / pass 32 / fail 0 / skipped 0
```

### 3. Mini 实机

```text
回滚点  ~/aurabot-release-backups/20261126-184531
加载    2026-11-26 18:45:36 [core] Aurabot v1.6.48 已加载｜总开关 开｜试运行 关
面板    /aurabot/api/state → version=1.6.48，onebot=connected
错误    部署后新增 [error] 0 条
同源    src/integration/purge-scope.js、src/chat/session-create.js 与 Air 同哈希
```

**行为影响面**：只有「Aurabot 自己建的会话中途换过预设」才会走到新路径；没换过预设的会话结果不变。
这条链路要真实会话切换才能观察到，本轮没有构造那种场景，证据边界同上一批：
单测 + 宿主文档行号 + 真实 purge 集成测试 + 启动无报错。

### 4. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.48.tgz（460 条目，19,648,177 字节）
sha256    214745e88cec63bf82575b018c6467218ecd0e603069bcb4b87a8d184033de6f
提交      7cc835f（main）
tag       v1.6.48 → 7cc835f
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.48
资产      dsh-aurabot-qq-1.6.48.tgz  19,648,177 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45804466657（ubuntu + macos 双平台 success）
```

---

## B9 · 全仓清单闸门稳定化

### 问题（这一路真实返工了 6 次）

清单闸门要求**每个**受版本控制的文件都有人工审计行。于是每加一个测试文件、每写一份
`docs/repo-audit/*.json`，都要手工补一行 —— 而「测试文件的验证依据」本来就是「全量跑过」，
手写一行只是把清单变成负担，不产生任何新信息。

### 改法

```text
scripts/repo-inventory.mjs
  autoVerdict(rec)   测试文件 → keep，evidence 写「验证依据是全量运行（node --test …）+ 行数」
                     docs/repo-audit/** → keepGenerated，evidence 写「本清单的输入」
  其余（src / client / scripts / docs）仍然必须人工结论

test/repo-inventory.test.js
  覆盖面断言改成同一口径：只要求「需要人工结论的文件」有人工行
  新增反向断言：src/host.js、client/client.js、scripts/*.mjs、docs/HANDOFF.md 绝不能被自动放行
```

顺手清掉 18 份 `batch*-additions.json` 里「自己审计自己」的冗余行（共 18 行），
并加 `npm run inventory` 作为可发现的入口。

### 1. 自动测试（Air）

```text
全量        1645 passed / 0 failed / 0 skipped
语法检查    599 个文件通过
oxlint      0 error / 158 warning
清单闸门    686 行清单，待审 0
```

**行为验证**：临时新建 `test/tmp-auto-check.test.js` → 不补审计行，`--write` 直接 `待审 0`、
闸门 4/4 通过；删掉后重生成仍是 0。这就是「以后加测试文件不再卡流水」的实证。

### 2. 真实 Purge 模块（Mini）

```text
Mini：purge-scope-integration / repo-inventory / core-layering / mind-layering / adapter-facade
      → 9 passed / 2 skipped（跳过的是「不是 git 检出就跳过」那两条，/tmp 副本没有 .git，属预期）
Mini 上跑 scripts/repo-inventory.mjs 也正常：430 个自有代码文件、待审 0
```

### 3. Mini 实机

```text
回滚点  ~/aurabot-release-backups/20261126-190753
加载    2026-11-26 19:07:58 [core] Aurabot v1.6.49 已加载｜总开关 开｜试运行 关
面板    /aurabot/api/state → version=1.6.49，onebot=connected
错误    19:00 之后新增 [error] 0 条
```

### 4. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.49.tgz（460 条目，19,648,240 字节）
sha256    ade0999d989e91eb4798292ea5660165f43d42bdfabb46b60b194cb3d18fbd15
提交      93b20e7（main）
tag       v1.6.49 → 93b20e7
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.49
资产      dsh-aurabot-qq-1.6.49.tgz  19,648,240 字节  state=uploaded
CI        workflow_dispatch ref=main → run 45807913231（ubuntu + macos 双平台 success）
```

---

## B10 · 终验

这一批不改产品行为，改的是「这份清单能不能被人核对」。

### 1. 清单依据对齐现实

抽样发现：部分**已执行**的结论，依据还停在改前。

```text
src/host.js        证据写「855 行」 → 实际 664（1.6.32 已拆）
src/core/config.js 证据写「844 行」 → 实际 177（1.6.39 已拆）
```

处理：
- 12 条改成执行后的事实（写明是哪一版拆的、拆去哪、现状行数）；
- 9 个**随发布变动**的文件（CHANGELOG / README×2 / package.json / client.js / 清单自身 / 交接文档 /
  .gitignore / 清单生成器）不再写死行数，改成「随发布更新（行数见清单「行」列）」；
- `test/**` 的 190 条人工审计行删掉，交给 1.6.49 引入的自动结论。

核对结果：**证据首句行数与实际行数的偏差 0 / 688**。

### 2. 终验做成可复跑的脚本

`scripts/verify-release.mjs`（`npm run verify`）：

```text
① 复算全仓清单，要求「待审 0」
② 把 docs/ACCEPTANCE-LOG.md 里每个版本的 sha256 与 GitHub Release 资产 digest 逐条比对
③ 校验 package.json 版本 = 最近 tag
只读、不改仓库；任一项失败以非 0 退出；--skip-remote 可离线跑
```

第一次运行它报「✖ 全仓清单：还有 1 个待审」—— 正是它自己这个新脚本还没有审计结论。

### 3. 19/19 资产与记录逐字节一致

```text
✔ v1.6.31 … v1.6.49 资产：与记录同哈希（19 条全过）
✔ 版本一致：package.json = 最近 tag
```

### 4. e2e 的间歇失败查清了（不是产品缺陷）

```text
现象    「翻聊天记录：读当前聊天更早的消息」在全量套件里偶发 8s 超时（独立跑 4/4 通过）
原因    until() 默认 8 秒，是按「机器空闲」定的；全量 1645 个用例 + 打包/rsync 并行时不够用
处理    放宽到 20 秒，并在注释里写明理由；条件本身仍然必须成立，等不到照样失败
```

这条**明确记为测试时间假设的修正**，不算产品修复 —— 不去假装它是 bug 也不假装它不存在。

### 5. 自动测试（Air）

```text
全量        1645 passed / 0 failed / 0 skipped
语法检查    600 个文件通过
oxlint      0 error / 158 warning
清单闸门    688 行，430 个自有代码文件，0 待审；证据行数偏差 0/688
终验脚本    --skip-remote：清单通过、发布记录 19 条、版本一致（tag 在发版后补上）
```

### 6. Mini 实机

```text
回滚点  ~/aurabot-release-backups/20261126-203350
加载    2026-11-26 20:33:55 [core] Aurabot v1.6.50 已加载｜总开关 开｜试运行 关
面板    /aurabot/api/state → version=1.6.50，onebot=connected，modules=12
错误    20:00 之后新增 [error] 0 条
测试    purge-scope-integration + e2e + repo-inventory：112 passed / 0 failed / 2 skipped
        （跳过的是「不是 git 检出就跳过」的两条，/tmp 副本没有 .git）
```

### 7. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.50.tgz（460 条目，19,634,315 字节）
sha256    dd165851970389c7acaaa829f20ad85d0a7377d891d30569d199920c694f1e52
提交      ca0d7f3（main）
tag       v1.6.50 → ca0d7f3
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.50
资产      dsh-aurabot-qq-1.6.50.tgz  19,634,315 字节  state=uploaded
终验脚本  node scripts/verify-release.mjs → 清单 0 待审、20/20 资产同哈希、版本一致，全部通过
```

### 8. CI（含一次平台故障，已复查）

```text
run 45821348237（workflow_dispatch ref=main，head ca0d7f3）
  ubuntu-latest  success
  macos-latest   macOS runner 排队 30 分钟未分配 → 平台取消 → gh run rerun --failed
                 重跑产生的 run 是**僵尸**：jobs 总数 0、attempt=1、updated_at 停住 → 永远不会完成
处理             重新派发 run 45835628991（head 57d1f85）
结果             ubuntu-latest + macos-latest **双平台 success**（约 6 分钟跑完）
```

先前那次不是测试失败、这次也不是「改 CI 让它变绿」：僵尸 run 里连 job 都没有，
新派发的 run 跑的是同一条命令、同一份代码（57d1f85 只改了文档）。


---

## B11 · `hub.js` 拆分第一刀（纯函数）

```text
src/chat/hub.js       1459 → 1433 行
src/chat/hub-pure.js  新增 45 行
搬走   withoutImageBlocks（只留指定图片，连带它前面的「下一张图的来源」标记）
       keyOf（模型身份键 provider::model::档位）
       flatHistory（网关历史压成「谁：说了什么」，单条截断 120 字）
       IMAGE_SOURCE_PREFIX 常量
```

为什么先搬这四个：它们不碰 Map、不碰网络、不读配置 —— 是 hub 里唯一能**脱离会话状态直接测**的部分。
其余 1400 多行的主体都闭包在 hub 的局部状态上，硬拆会变成「把参数表搬来搬去」，那不算拆。

### 1. 自动测试（Air）

```text
全量        1650 passed / 0 failed / 0 skipped（比 1.6.50 多 5 个）
语法检查    602 个文件通过
oxlint      0 error / 158 warning
清单闸门    691 行，0 待审
```

新增 `test/chat-hub-pure.test.js` 5 个用例，其中两个是以前没人测过的细节：
「来源标记要跟着它的图一起消失」、「第 4 条要截到 120 字」。

### 2. 真实 Purge 模块 + 实机（Mini）

```text
回滚点  ~/aurabot-release-backups/20261126-222036
加载    2026-11-26 22:20:42 [core] Aurabot v1.6.51 已加载｜总开关 开｜试运行 关
面板    /aurabot/api/state → version=1.6.51，onebot=connected
错误    22:30–22:59 新增 [error] 0 条
测试    chat-hub-pure + e2e + purge-scope-integration → 115 passed / 0 failed / 0 skipped
同源    src/chat/hub-pure.js、src/chat/hub.js 与 Air 同哈希
```

### 3. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.51.tgz（461 条目，19,635,172 字节）
sha256    b056fb483767da07efa749fa40da58125b5aee1dc1a4c5d0f96cae3ae89f4d3c
提交      1ad2840（main）
tag       v1.6.51 → 1ad2840
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.51
```

### 4. CI 状况：macOS runner 拿不到机器（连续三次，有具体形态）

```text
run 45838591057  ubuntu success(22:24→22:27) | macos started 22:23:55 → 22:38:56 cancelled，steps=0
run 45841300451  ubuntu success(22:40→22:43) | macos started 22:40:02 → 22:55:03 cancelled，steps=0
run 之后再派发一次（见下一条记录）
```

三次都是同一个形态：**macOS job 等了 15 分钟、一步都没跑（steps=0）就被平台取消**。
不是测试失败、不是代码问题，也不是并发组互相取消（那段时间本仓没有其它 run）。

对照事实：

```text
本机（MacBook Air，macOS）全量       1650 passed / 0 failed / 0 skipped  ← macOS 上的实际执行证据
run 45835628991（22:06）            macos-latest success（约 6 分钟跑完）
前 20 个版本的 macOS job            全部 success
```

处理原则：**不改 CI 语义把它变绿**。继续派发，等平台给机器。

第三次派发（run 45846782697）：

```text
ubuntu-latest  completed/success  steps=14
macos-latest   completed/success  steps=14   ← 等到机器后正常跑完
```

所以前面两次是平台容量问题，不是代码或配置问题。1.6.51 的双平台 CI：**success**。


---

## B12 · 云备份后端分家

```text
src/core/backup-push.js    469 → 285 行（只剩 Gitee 那条链）
src/core/backup-webdav.js  新增 160 行（WebDAV 全链）
src/core/backup-shared.js  新增 45 行（两后端共用）
搬到 webdav   webdavSettings / ensureWebdavFolder / webdavFetch / webdavList /
              listWebdavBackups / downloadWebdavBackup / pushBackupWebdav
搬到 shared   pushHooks（测试钩子）/ redact（令牌打码）/ prunePlan（保留计划）/
              BACKUP_ZIP_RE / NAME_RE / BRANCH_RE / MARKER / validateCandidate
保留在 push   gitEnv（令牌走环境变量不进命令行）/ runGit / giteeApi / assertPrivate /
              createRepo / ensureRemote / resetHistory / 分卷推送
```

**对外 API 一个字没改**：`backup-push.js` 仍 `export { pushHooks, redact, prunePlan, listWebdavBackups, downloadWebdavBackup }`，
`host.js` 与三个测试文件的 import 一句没动。

### 为什么按后端分，而不是按「工具/业务」分

这两条链**互相不调用**，只是共用打码与文件名规则。混在 469 行里只能靠注释分界；分家后各自
160 / 285 行，出错时不用在两套协议（git refspec 与 WebDAV 方法）之间跳。

### 过程中抓到的问题

- 第一次切分把 `pushBackup` 的 JSDoc 头一起带进了 `backup-webdav.js`，语法检查直接报错 → 裁掉；
- 审计里 `src/core/backup-push.js` **同时存在于 `core-security.json` 与 `core-data.json`**，
  清单闸门报「重复出现」→ 删掉旧的那条，保留新结论。这条闸门本来就是为了防这种漂移。

### 1. 自动测试（Air）

```text
全量        1650 passed / 0 failed / 0 skipped
语法检查    604 个文件通过
oxlint      0 error / 19 warning（备份相关文件零告警）
清单闸门    695 行，0 待审
备份专项    backup / backup-push / backup-webdav / system-processes → 51/51
```

### 2. 真实 Purge 模块 + 实机（Mini）

```text
回滚点  ~/aurabot-release-backups/20261126-234332
加载    2026-11-26 23:43:38 [core] Aurabot v1.6.52 已加载｜总开关 开｜试运行 关
面板    /aurabot/api/state → version=1.6.52，onebot=connected
备份    /aurabot/api/backup/state → ok，本地 1 份备份仍可列出
错误    23:20 之后新增 [error] 0 条
测试    backup-webdav / backup-push / backup / backup-restart / purge-scope-integration
        → 46 passed / 0 failed / 0 skipped
同源    三个文件与 Air 同哈希
```

### 3. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.52.tgz（463 条目，19,635,879 字节）
sha256    b0c37826fb2ccd14c393cd525c6b9e1cff03bb77c0c3e6e1c7bfea00b9da6789
提交      ce4591c（main）
tag       v1.6.52 → ce4591c
Release   https://github.com/Geng-zy/aurabot-qq-mac/releases/tag/v1.6.52
CI        run 45852200820 → ubuntu-latest success、macos-latest success（00:22 双绿）
```

---

## B13 · 恢复路径补直接测试 + 修掉一个清理泄漏

### 现状（写测试前）

```text
.restore 发布 / journal 回滚 / 会话恢复 只有一条端到端用例（备份 → 恢复 → 重启）
失败分支：非备份文件、重复暂存、取消、入口空输入 —— 一条都没测过
```

所以这批先补测试，不动结构：没有直接测试就搬这段路径，等于把风险从「不知道」变成「看不见」。

### 1. 新增 test/backup-stage.test.js（6 个用例）

```text
非 zip → 拒绝，且不留待恢复项
真备份 → 暂存成功、pendingRestore() 能查到 files
重复暂存 → 被单飞锁拒绝（另一个备份正在暂存）
取消幂等 → 没有待恢复项时 cancelRestore 不炸
stageReceivedBackup → 空 Buffer / 非 Buffer 在入口被挡
取消后 → 数据目录不留任何 .restore-* 残留
```

### 2. 写测试时抓到的两件事

**真实小泄漏**：`cancelRestore()` 没清数据目录根部的 `.restore-stage-id`。
`publishStage` 会把阶段号放到那里，取消时却没删。它不致命（在备份 SKIP 名单里、下次发布会覆盖），
但「取消」应该什么都不留 —— **改代码，没有放宽断言**。

**测试自己踩的坑**：`stageRestore` 与 `stageReceivedBackup` 都是异步函数，第一版用 `assert.throws`
直接卡住单飞锁、留下未处理的 rejection；改成 `assert.rejects` + `await` 才对。
这类坑记在这里，下次拆这段路径时不用再踩一遍。

### 3. 自动测试（Air）

```text
全量        1656 passed / 0 failed / 0 skipped（比 1.6.52 多 6 个）
语法检查    605 个文件通过
oxlint      0 error / 19 warning
清单闸门    697 行，0 待审
```

### 4. 真实 Purge 模块 + 实机（Mini）

```text
回滚点  ~/aurabot-release-backups/20261127-003358
加载    2026-11-27 00:34:03 [core] Aurabot v1.6.53 已加载｜总开关 开｜试运行 关
面板    /aurabot/api/state → version=1.6.53，onebot=connected
残留    数据目录里 .restore* 命中 0（实机核对，不只是测试里断言）
错误    00:20 之后新增 [error] 0 条
测试    backup-stage / backup / backup-restart / purge-scope-integration → 26 passed / 0 failed
同源    src/core/backup.js 与 Air 同哈希
```

### 5. 发布

```text
候选包    /tmp/dsh-aurabot-qq-1.6.53.tgz（463 条目，19,636,200 字节）
sha256    b7704051334dd69b95a433bb85660158287ccc086914b9c2bebea28986c60123
```
