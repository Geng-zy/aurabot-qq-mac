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
