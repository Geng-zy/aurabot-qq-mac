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
