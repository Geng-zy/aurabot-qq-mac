# AuraBot macOS 新会话交接

```text
最后更新   2026-11-26
适用版本   v1.6.42
仓库目录   /Users/geng/Desktop/Project/dsh/aurabot-qq-mac
维护仓库   https://github.com/Geng-zy/aurabot-qq-mac
默认分支   main（发布只用 main + 版本 tag + GitHub Release）
```

这份文档是给“新开一个会话继续干”的人/模型看的，不是对外用户手册。先看「五分钟接手」，再按需查后面的章节。

---

## 0. 五分钟接手

### 0.1 当前基线

```text
上一个发布             3658ee3 / v1.6.30
package.json           1.6.42
全量测试               1577 passed / 0 failed / 0 skipped
语法检查               564 个文件通过
oxlint                 0 errors / 164 warnings
全仓清单               633 个文件全部有审计结论（docs/REPO-INVENTORY.md）
Mac mini               见 docs/ACCEPTANCE-LOG.md 的 B0 段
```

### 0.2 新会话第一步

```bash
cd /Users/geng/Desktop/Project/dsh/aurabot-qq-mac
git status --short
git log --oneline -5
python3 -c 'import json;print(json.load(open("package.json"))["version"])'
```

如果 `git status` 有未提交的 `docs/SESSION-HANDOFF.md` / `docs/HANDOFF.md`，那是交接文档本身，先确认再决定是否提交。

### 0.3 新会话第二步：跑基线

```bash
export PATH="/Users/geng/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin:$PATH"
caffeinate -dimsu node --test --test-concurrency=1 --test-timeout=120000 "test/**/*.test.js"
```

期望：

```text
tests 1562
pass 1562
fail 0
skipped 0
```

必须用 `caffeinate -dimsu`。Mac 睡眠会把测试拖到几十分钟，并制造假的超时/失败。

### 0.4 新会话第三步：语法和 lint

```bash
export PATH="/Users/geng/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin:$PATH"
node scripts/check-syntax.mjs
/Users/geng/.bun/bin/bunx --bun oxlint --config .oxlintrc.json src client
```

期望：

```text
555 files
0 errors
165 warnings（当前刻意保留）
```

### 0.5 不要做的事

- 不要因为“测试全过”就认为所有本地工作已穷尽；剩余 warning 和小函数拆分属于低收益项。
- 不要为了消 lint 去删 `mentions/tags/reply` 的必要正则转义。已经踩过一次 60 秒正则回溯卡死。
- 不要只替换 `node_modules/dsh-aurabot-qq` 目录就以为 Mac mini 升级完成。profile 依赖的是 `/tmp/dsh-aurabot-qq-final21.tgz`。
- 不要在没有跑全量的情况下发布。
- 不要把 `~/.ssh` 私钥、Bot Token、API Key、聊天记录、备份 ZIP 提交到仓库。
- 新写的 `.md` 里不能出现旧角色称呼（`test/wording.test.js` 会扫全仓），角色一律叫「管理员」。

---

## 1. 机器、网络与 Tailscale

### 1.1 两台机器

```text
本机（开发）       MacBook Air
Tailscale 名称     gengmacbook-air
Tailscale IP       100.83.0.68

目标机（部署）     Mac mini
主机名             GengdeMac-Mini.local
Tailscale 名称     gengmac-mini
Tailscale IP       100.89.128.72
系统               macOS 27.2.1（以 sw_vers 为准）
架构               arm64
SSH 用户           gengzhiyu
```

Tailscale 版本（本机实测）：`1.104.7`。

### 1.2 确认 Tailscale 在线

```bash
/usr/local/bin/tailscale status
```

正常会看到类似：

```text
100.83.0.68    gengmacbook-air  ... macOS
100.89.128.72  gengmac-mini     ... macOS
```

如果只看某一台：

```bash
/usr/local/bin/tailscale status | grep gengmac-mini
```

注意：本会话实测 `tailscale ping 100.89.128.72` 可能超时（`no reply`），但 SSH/TCP 22 仍然可用。不要把 `tailscale ping` 失败直接当成机器离线；以 `tailscale status` 和实际 SSH 为准。

### 1.2.1 不在线时

本机和 mini 必须登录同一个 Tailscale tailnet（本会话状态里都是 `Geng-zy@`）。

本机检查/拉起：

```bash
/usr/local/bin/tailscale up
/usr/local/bin/tailscale status
/usr/local/bin/tailscale netcheck
```

macOS GUI 版 Tailscale 也可以从菜单栏确认已连接。

机器不在线时：

1. 确认 mini 没关机/睡眠；
2. 确认 mini 菜单栏 Tailscale 已连接；
3. 确认两台机器在同一个 tailnet；
4. 确认 tailnet ACL 没有禁止 `100.89.128.72:22`；
5. 确认 mini 的「系统设置 → 通用 → 共享 → 远程登录」开启。

本会话使用 **系统 OpenSSH over Tailscale IP**，不是 Tailscale SSH 功能。也就是说：

```text
ssh gengzhiyu@100.89.128.72
```

走的是 Tailscale 虚拟网络 + macOS 自带 sshd，不依赖 `tailscale ssh`。所以 mini 必须开 Remote Login。

如果 MagicDNS 正常，也可能可以直接：

```bash
ssh gengzhiyu@gengmac-mini
```

但交接文档统一用 Tailscale IP，避免 tailnet 域名变化。

### 1.3 SSH 密钥

本机使用：

```text
~/.ssh/aurabot_macmini_ed25519
~/.ssh/aurabot_macmini_ed25519.pub
```

私钥权限应为 `600`：

```bash
chmod 600 ~/.ssh/aurabot_macmini_ed25519
```

公钥需要出现在 mini 的：

```text
~/.ssh/authorized_keys
```

如果不确定，先在 mini 本机确认；不要把私钥复制到 mini。

### 1.4 直接 SSH

```bash
ssh -i ~/.ssh/aurabot_macmini_ed25519 \
  -o IdentitiesOnly=yes \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=no \
  gengzhiyu@100.89.128.72
```

建议日常加超时和保活：

```bash
ssh -i ~/.ssh/aurabot_macmini_ed25519 \
  -o IdentitiesOnly=yes \
  -o ConnectTimeout=10 \
  -o ServerAliveInterval=30 \
  gengzhiyu@100.89.128.72
```

### 1.5 建议写进 `~/.ssh/config`

```sshconfig
Host aurabot-mini
  HostName 100.89.128.72
  User gengzhiyu
  IdentityFile ~/.ssh/aurabot_macmini_ed25519
  IdentitiesOnly yes
  ConnectTimeout 10
  ServerAliveInterval 30
```

之后可以直接：

```bash
ssh aurabot-mini
```

### 1.6 第一次连接与主机指纹

首次连接可能会问 host key。脚本里常用：

```bash
-o StrictHostKeyChecking=no
```

这是为了自动化；手动登录时建议先核对指纹，确认是 mini 再接受。

### 1.7 传文件

```bash
scp -i ~/.ssh/aurabot_macmini_ed25519 \
  -o IdentitiesOnly=yes \
  /tmp/dsh-aurabot-qq-1.6.42.tgz \
  gengzhiyu@100.89.128.72:/tmp/
```

大目录可以用：

```bash
rsync -avz -e "ssh -i ~/.ssh/aurabot_macmini_ed25519 -o IdentitiesOnly=yes" \
  ./dist/ gengzhiyu@100.89.128.72:/tmp/dist/
```

### 1.8 常见 SSH 问题

```text
Connection reset by peer / Broken pipe
```

本会话出现过。通常是 mini 睡眠、Tailscale 路径切换或网络抖动。处理顺序：

1. 本机 `tailscale status` 看 mini 是否在线。
2. 重新 SSH，命令本身支持重试。
3. 换用 `ConnectTimeout=10`。
4. 如果 mini 睡眠，先在 GUI 唤醒，或在 mini 上临时 `caffeinate -dimsu`。
5. 仍不行再检查 macOS「系统设置 → 通用 → 共享 → 远程登录」。

```text
Permission denied (publickey)
```

- 私钥路径不对；
- 私钥权限不是 600；
- mini 的 `authorized_keys` 没有对应公钥；
- 用了错误的用户（应为 `gengzhiyu`）。

```text
Host key verification failed
```

说明之前记录的 host key 变了。先确认是否是重装/换机；确认后再清理：

```bash
ssh-keygen -R 100.89.128.72
```

### 1.9 图形界面（可选，未在本次交接中验证）

如果 mini 开了屏幕共享，可以尝试：

```bash
open "vnc://100.89.128.72"
```

是否开启、账号权限如何，本次没有验证。日常部署优先 SSH，不依赖 GUI。

### 1.10 mini 的休眠

mini 睡眠会导致 SSH 断、测试超时、DSH 插件不加载。建议：

- 部署/跑测试期间在 mini 上执行 `caffeinate -dimsu`。
- 不要把 `caffeinate` 当成永久电源策略；是否改 `pmset` 由机器使用者决定。

---

## 2. 仓库、分支与版本

### 2.1 分支

```text
main            唯一开发/发布分支
```

`beta/v1.5.10` 已删除：发布只走 `main` + 版本 tag + GitHub Release，不再维护兼容分支。

### 2.2 远端

```bash
git remote -v
```

应指向：

```text
https://github.com/Geng-zy/aurabot-qq-mac.git
```

### 2.3 版本规则

- `package.json`、`CHANGELOG.md`、README 安装示例、tag 必须一致。
- 发布包名：`dsh-aurabot-qq-<version>.tgz`。
- `private: true`，不发布 npm，只走 GitHub Release。
- 包必须是 npm 布局：顶层目录为 `package/`。

### 2.4 包内容审计

```bash
tar -tzf /tmp/dsh-aurabot-qq-1.6.42.tgz | head
tar -tzf /tmp/dsh-aurabot-qq-1.6.42.tgz | grep -v '^package/' | head
tar -tzf /tmp/dsh-aurabot-qq-1.6.42.tgz | wc -l
```

期望：

- 所有路径以 `package/` 开头；
- 没有 `logs/`、`sessions.json`、`config.json`、`backups/`；
- 1.6.42 实测 433 个条目。

---

## 3. 本机开发环境

### 3.1 Node

不要依赖系统 `node`。使用 DSH 自带运行时：

```bash
export PATH="/Users/geng/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin:$PATH"
node -v
```

### 3.2 Bun

打包用：

```text
/Users/geng/.bun/bin/bun
```

### 3.3 常用脚本

```bash
npm test          # node --test
npm run check     # scripts/check-syntax.mjs
npm run lint      # oxlint src client
npm run build:client
```

实际测试命令建议手写带 `caffeinate` 和并发 1 的版本，见第 0 节。

### 3.4 仓库不安装宿主依赖

插件依赖由 DSH 宿主提供。源仓库离线跑测试使用 fake DSH / fake OneBot，不需要先装 QQ 网关、模型或媒体环境。

---

## 4. 代码架构总览

### 4.1 宿主半边

```text
src/host.js                 DSH 插件入口、组合根、生命周期、平台接线
src/host/                   host 内部工具（overview/panel-save/http 等）
src/features/               面板 API 路由、功能路由
src/core/                   配置、备份、模块系统、任务、日志、模型等
src/channels/               QQ/OneBot、Telegram 适配
src/chat/                   QQ 聊天中枢及拆分模块
src/mind/                   心智核心（身体/情绪/关系/记忆/人格/动机/内心）
src/mind-adapter/           心智与聊天/DSH 的对接层
src/modules/                内置模块、模块 API、模块文档
src/integration/            dsh-purge、host-tools 等宿主接缝
src/song/                   翻唱/RVC/Applio
src/voice/                  TTS/ASR/Breeze
src/security/               危险命令、安全策略
src/persona/                人格卡
```

### 4.2 聊天中枢拆分

`src/chat/hub.js` 从 3952 行降到 1471 行；主体拆到：

```text
src/chat/on-message.js          320  收消息主流程
src/chat/session-events.js      230  DSH 会话事件
src/chat/attention.js           218  排队/注意力/群聊秘书
src/chat/mount.js               189  挂载/卸载/调试会话
src/chat/group-context.js       163  群聊上下文/群图
src/chat/agent-resolve.js       148  会话解析/交接/agentFor
src/chat/turn-state.js          139  回合状态/回复重写
src/chat/deliver-turn.js        136  一轮回复投递
src/chat/run-subagent-turn.js    97  子代理回合
src/chat/transcribe.js           87  语音转写
src/chat/send-segments.js        79  消息段最终出口
src/chat/run-system-turn.js      74  系统回合
src/chat/notify-events.js        62  通知/戳一戳
src/chat/turn-helpers.js         53  戳回去/静默/后台发送
src/chat/model-target.js         52  目标模型解析
src/chat/workspace.js            46  工作区/平台/标题
src/chat/reference.js            41  引用图片/最近媒体
src/chat/images.js               40  图片下载/缩小/动图说明
src/chat/quote-format.js         37  引用文字格式
src/chat/reply-journal.js        30  回复流水
src/chat/on-delivered.js         23  回执记账
src/chat/quote.js                49  引用解析
```

更早还拆过：

```text
send-text.js / send-image.js / send-voice.js / send-sticker.js
send-file.js / file-policy.js / image-policy.js / voice-file.js
```

### 4.3 client 半边

DSH 只加载：

```text
client/client.js
```

但源码是模板 + 页面片段：

```text
client/client.template.js   280 行，DSH __ModuleLoader__ 包装/React/primitives/export
client/parts/*.js           104 个页面/组件/样式/hooks 片段
scripts/build-client.mjs    拼回单文件
test/client-build.test.js   构建回归
```

构建标记：

```text
/* @include parts */
```

改完模板或片段必须：

```bash
node scripts/build-client.mjs
```

否则 DSH 读到的还是旧 `client/client.js`。

### 4.4 心智核心

`src/mind/` 按域拆分，`mind/index.js` 是装配门面。`src/mind-adapter/` 已把上下文、权限、主动联系、模块 API、内心、会话策略、身体、提醒、记忆编码、向量、人物、恢复、快照等拆开。

不要在没读依赖的情况下把心智模块继续硬拆；它的 SQLite 事务、快照和隐私版本语义很重。

---

## 5. 数据与配置路径

### 5.1 Mac mini

```text
插件代码
  ~/.dsh/profiles/desktop/node_modules/dsh-aurabot-qq

DSH profile
  ~/.dsh/profiles/desktop
  ~/.dsh/profiles/desktop/package.json
  ~/.dsh/profiles/desktop/pnpm-lock.yaml

插件数据
  ~/.dsh/plugins-data/aurabot/
    config.json
    sessions.json
    mind/
    personas/
    chatlog/
    logs/
    backups/
    imagegen/
    stickers/
    modules/
    qq-inbox.json
    outbox/
    creative-tasks.json
    appearance/

QQ 工作区
  ~/Aurabot/qq-chats
```

### 5.2 本机

本机仓库只用于开发/测试/打包。真实运行数据以 mini 的 `~/.dsh/plugins-data/aurabot` 为准。

### 5.3 日志

```text
mini 插件日志
  ~/.dsh/plugins-data/aurabot/logs/aurabot-YYYY-MM-DD.log
```

查版本：

```bash
grep "Aurabot v" ~/.dsh/plugins-data/aurabot/logs/aurabot-$(date +%F).log | tail -1
```

### 5.4 不要把数据提交

以下都不要进 git / Release：

```text
config.json
sessions.json
mind/*.db
chatlog/
logs/
backups/
personas/（如果包含私人内容）
任何 API Key / Bot Token / 私钥
```

---

## 6. 安装、部署与重启 Mac mini

### 6.1 为什么不能只换目录

Mac mini 的 profile `package.json` 依赖：

```text
dsh-aurabot-qq: file:/tmp/dsh-aurabot-qq-final21.tgz
```

DSH/pnpm 在启动/安装时会按这个 tarball 解析。只替换 `node_modules/dsh-aurabot-qq` 目录，下一次启动可能又回到旧版本，或者插件直接不加载。

### 6.2 正确部署流程

本机打包：

```bash
cd /Users/geng/Desktop/Project/dsh/aurabot-qq-mac
/Users/geng/.bun/bin/bun pm pack --ignore-scripts --filename /tmp/dsh-aurabot-qq-1.6.42.tgz
shasum -a 256 /tmp/dsh-aurabot-qq-1.6.42.tgz
```

传到 mini：

```bash
scp -i ~/.ssh/aurabot_macmini_ed25519 \
  -o IdentitiesOnly=yes \
  /tmp/dsh-aurabot-qq-1.6.42.tgz \
  gengzhiyu@100.89.128.72:/tmp/dsh-aurabot-qq-1.6.42.tgz
```

在 mini 上执行：

```bash
cp /tmp/dsh-aurabot-qq-1.6.42.tgz /tmp/dsh-aurabot-qq-final21.tgz

cd ~/.dsh/profiles/desktop

NODE=/Applications/DeepSeek\ Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node
PNPM=/Applications/DeepSeek\ Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs

"$NODE" "$PNPM" install --ignore-scripts

pkill -9 -f "MacOS/DeepSeek Harness" 2>/dev/null || true
sleep 3
open -a "DeepSeek Harness"
sleep 25

grep "Aurabot v" ~/.dsh/plugins-data/aurabot/logs/aurabot-$(date +%F).log | tail -1
```

期望：

```text
Aurabot v1.6.42 已加载
```

### 6.3 为什么用 `pkill -9`

`osascript -e 'tell application "DeepSeek Harness" to quit'` 偶尔会卡住，导致后续 `open` 不生效。`pkill -9` 后 `open` 更稳。注意会强杀未保存的 GUI 状态，但插件数据在磁盘上。

### 6.4 版本没变怎么查

按顺序：

```bash
python3 -c "import json;print(json.load(open('/Users/gengzhiyu/.dsh/profiles/desktop/node_modules/dsh-aurabot-qq/package.json'))['version'])"
ls -l /tmp/dsh-aurabot-qq-final21.tgz
grep -R "dsh-aurabot-qq" -n ~/.dsh/profiles/desktop/package.json ~/.dsh/profiles/desktop/pnpm-lock.yaml | head
grep "Aurabot v" ~/.dsh/plugins-data/aurabot/logs/aurabot-$(date +%F).log | tail -3
```

常见原因：

- 忘了复制到 `/tmp/dsh-aurabot-qq-final21.tgz`；
- 没有 `pnpm install`；
- app 没真正重启；
- profile 安装失败，日志在 DSH 侧，不一定写到 aurabot 日志；
- `/tmp` 被清理，tarball 不存在。

### 6.5 离线 pnpm 报错

如果看到：

```text
ERR_PNPM_NO_OFFLINE_TARBALL
```

说明 profile 依赖里有 GitHub 包，缓存里没有。不要用 `--offline`，需要联网执行 `pnpm install --ignore-scripts`。

### 6.6 回滚

最简单：重新安装上一个版本的 tgz，走同一套流程。

```bash
cp /tmp/dsh-aurabot-qq-<old>.tgz /tmp/dsh-aurabot-qq-final21.tgz
cd ~/.dsh/profiles/desktop

NODE=/Applications/DeepSeek\ Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node
PNPM=/Applications/DeepSeek\ Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs

"$NODE" "$PNPM" install --ignore-scripts
pkill -9 -f "MacOS/DeepSeek Harness" || true
sleep 3
open -a "DeepSeek Harness"
```

注意 `/tmp` 可能被清理；重要版本 tgz 应另存到稳定目录。

`node_modules` 里的 `dsh-aurabot-qq.pre-*` 旧目录可能被 pnpm 移到 `.ignored`，不要把它们当成可靠回滚源。

---

## 7. 测试体系

### 7.1 全量

```bash
export PATH="/Users/geng/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin:$PATH"
caffeinate -dimsu node --test --test-concurrency=1 --test-timeout=120000 "test/**/*.test.js"
```

### 7.2 单文件/单用例

```bash
node --test test/e2e.test.js
node --test --test-name-pattern='引用消息|生图由她理解' test/e2e.test.js
```

### 7.3 fake 环境

`test/e2e.test.js` 使用：

- fake DSH：`test/helpers/fake-dsh.js`
- mock OneBot：`test/helpers/mock-onebot.js`
- 临时目录

它验证接线、权限、状态转换和发送路径，不证明真实 QQ 送达、真实模型质量或付费服务可用。

### 7.4 已知计时敏感点

已加固：

```text
test/modules.test.js
  until 默认 30s（原来 10s）

test/song.test.js
  取消后台翻唱测试 timeout 15s
  假 ffmpeg 落盘等待 10s
```

如果全量里偶发失败，先单独重跑；单独过、全量不过，优先看机器负载/睡眠/计时，不要立刻改业务。

### 7.5 源码契约测试

client 页面现在由 parts 拼接，函数顺序不代表页面顺序。已有测试：

```text
test/security-panel.test.js
test/about-panel.test.js
test/browser-panel.test.js
```

都已改成按函数体边界取源码。新测试不要写：

```js
indexOf('function A') < indexOf('function B')
```

### 7.6 期望值不是永远 1562

新增测试后数字会变。以当前 `package.json` 版本对应的实际全量输出为准；不要为了凑数字删测试。

---

## 8. 语法、lint 与 warning 现状

### 8.1 命令

```bash
node scripts/check-syntax.mjs
/Users/geng/.bun/bin/bunx --bun oxlint --config .oxlintrc.json src client
```

`client/client.template.js` 和 `client/parts/**` 被 `.oxlintrc.json` 忽略，因为它们是片段，不是独立文件；只检查生成后的 `client/client.js`。

### 8.2 当前 warning

```text
165 warnings
0 errors
```

主要类型：

```text
未使用的工厂参数
有意排除的 destructure 字段
空 catch / 控制字符正则 / emoji 正则
风格项
```

已经清掉：

```text
436 → 165
未使用 import
未使用变量
空 catch 绑定
单行/多行未使用 error
无意义 try/catch
部分三元副作用
```

不要为了把 165 清零去改 API 形状或正则。先判断是否真的是问题。

---

## 9. 发布流程（GitHub Release）

### 9.1 准备

1. 全量测试通过。
2. `node scripts/check-syntax.mjs` 通过。
3. lint `0 errors`。
4. 更新 `package.json` 版本。
5. 更新 `CHANGELOG.md`。
6. 更新 README/README_EN 安装示例版本。
7. `git diff --check`。

### 9.2 打包

```bash
/Users/geng/.bun/bin/bun pm pack --ignore-scripts --filename /tmp/dsh-aurabot-qq-<ver>.tgz
shasum -a 256 /tmp/dsh-aurabot-qq-<ver>.tgz
```

### 9.3 提交、推送、tag

```bash
git add -A
git commit -m "..."
git tag -a v<ver> -m "AuraBot v<ver>"
git push origin main refs/tags/v<ver>
```

### 9.4 创建 Release

用 GitHub API 或 `gh`。本会话使用 API，token 从 git credential 取：

```bash
cred=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill)
token=$(printf '%s\n' "$cred" | sed -n 's/^password=//p')
```

创建 release 后拿 `id`，再上传 asset：

```text
POST https://uploads.github.com/repos/Geng-zy/aurabot-qq-mac/releases/<id>/assets?name=dsh-aurabot-qq-<ver>.tgz
Content-Type: application/gzip
```

### 9.5 GitHub 不稳定

本会话遇到过：

```text
HTTP 401 Bad credentials
SSL_ERROR_SYSCALL
HTTP 000
timeout
```

都通过重试恢复。上传命令必须写成重试循环，不能一次失败就断言发布失败。上传成功后核对：

```json
{"name":"dsh-aurabot-qq-...tgz","size":20043672,"state":"uploaded"}
```

### 9.6 Release 正文

至少包含：

```text
版本变更
发布包名
sha256
```

### 9.7 CI

工作流：

```text
.github/workflows/pr-check.yml
```

触发：

```text
workflow_dispatch ref=main
```

本会话 1.6.30 的 run：

```text
https://github.com/Geng-zy/aurabot-qq-mac/actions/runs/45635963413
状态：queued
```

CI queued 不等于通过；最终要以实际 run 结果为准。macOS runner 偶尔排队/取消，需要重跑。

---

## 10. 故障排查 playbook

### 10.1 插件没加载 / 版本仍旧

```text
Aurabot v1.6.x 已加载 没有出现
```

检查：

1. `/tmp/dsh-aurabot-qq-final21.tgz` 是否存在，是否是目标版本。
2. `~/.dsh/profiles/desktop/node_modules/dsh-aurabot-qq/package.json` 版本。
3. profile `package.json` 依赖路径。
4. `pnpm install --ignore-scripts` 输出。
5. 强杀 app 后重开。
6. DSH 启动日志/控制台错误。

### 10.2 SSH 断

见第 1.8 节。先重试，再查 Tailscale，再查 mini 睡眠/远程登录。

### 10.3 测试变慢/假超时

- 是否 `caffeinate`；
- 是否 `--test-concurrency=1`；
- 是否机器睡眠；
- 是否单个用例本身重（e2e/模块/生图）。

### 10.4 正则卡死

已知案例：

```text
去掉 mentions/tags/reply 的必要转义
→ 群聊唤醒测试 60 秒超时
→ 已回滚
```

如果出现某个消息一进来就卡住，优先看最近是否改正则，尤其是字符类嵌套和 emoji。

### 10.5 client 改了不生效

- 是否运行 `node scripts/build-client.mjs`；
- 是否提交生成的 `client/client.js`；
- DSH 是否重载插件；
- 浏览器是否缓存（刷新/重开面板）。

### 10.6 client 构建失败

```text
client 模板还有没展开的 @include
```

说明模板里有未识别的 include 标记，或 parts 文件缺失。运行：

```bash
node scripts/build-client.mjs
```

看具体错误；检查 `client/parts/` 文件名。

### 10.7 页面测试失败

先看是不是源码顺序假设。按函数体取：

```js
const start = src.indexOf('function X(')
const end = src.indexOf('\n    function ', start + 1)
const body = src.slice(start, end < 0 ? src.length : end)
```

### 10.8 备份/恢复

- 恢复前先保留当前备份。
- 中断恢复有 `.restore-publish.json` journal，启动会回滚/继续。
- 大媒体条目走流式 CRC，避免整块读入内存。
- 恢复后按面板要求重启 DSH。

### 10.8.1 语音条发不出去

现象（1.6.30 及以前在 Mac mini 上稳定复现，25/25）：

```text
[warn] [chat] 发到 group:XXX 失败： send_group_msg 失败：Input does not contain a known duration
[warn] [chat] 语音没发出去，改发文字： send_group_msg 失败：Input does not contain a known duration
```

原因链：

1. QQ 的 `record` 段必须带 `duration`。
2. 旧代码只靠 ffmpeg 的 `Duration:` 探时长；mini 上没装 ffmpeg → 恒返回 0 → 段里干脆不带 `duration`。
3. 网关（SnowLuma/NapCat 一类）直接以 `Input does not contain a known duration` 拒收。
4. 拒收后走「改发文字」，所以群里只看到文字，像是「她不想发语音」。

1.6.42 起的处理：

- `src/voice/duration.js` 自己解 WAV / MP3 / OGG / M4A 容器，没有 ffmpeg 也能给出秒数；认不出才回落 ffmpeg。
- `src/voice/tts.js` 检查 `say` / `afconvert` 退出码，并要求结果不是 0 采样的 WAV（`say` 失败会留下正好 4096 字节的空 WAV，旧的大小校验过得去）。
- 空音频直接抛错 → 调用方改发文字，不会发一条没声音的语音条。

自查命令（在 mini 上，用部署后的代码）：

```bash
NODE="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node"
"$NODE" /tmp/verify-deployed.mjs   # 合成 + 时长 + 空音频拦截
```

判据：

```text
engine = system  durationFromFile ≈ 2.9  audioDurationSec = 3
旧空语音 isZeroSampleWav = true
```

网关侧验证（带 duration 的 record 能不能发）：直连 `ws://127.0.0.1:3001?access_token=…`，
`send_private_msg` 带 `{type:'record', data:{file:'base64://…', duration: 5}}`，期望 `retcode 0`。

### 10.9 真实平台问题

QQ/Telegram/WebDAV/Gitee/API 的真实错误不在离线测试覆盖内，按 `docs/EXTERNAL-ACCEPTANCE.md` 的检查顺序做。

---

## 11. 拆分方法论与坑

### 11.1 工厂依赖注入

模式：

```js
export function createX({ depA, depB, getConfig, getMind, isDisposed }) {
  return function x(...) {
    // 原逻辑
  }
}
```

在 `hub.js` 里：

```js
const x = createX({
  depA,
  depB,
  getConfig,
  getMind: () => mind,
  isDisposed: () => disposed,
})
```

### 11.2 TDZ

如果工厂创建时直接传了后面才初始化的 `const`：

```text
ReferenceError: Cannot access 'xxx' before initialization
```

处理：

- 依赖已初始化：直接传。
- 依赖在后面：`(...a) => fn(...a)` thunk。
- 循环依赖：用 thunk 断开。

本会话踩过：

```text
agentFor / resolveTarget / targetModel / silenceTurn / deliver / encodeForHandoff
```

### 11.3 不要搬走内部声明的 map/const

有些函数块里包含：

```js
const handoffEncodings = new Map()
const keyOf = ...
const pending = new Map()
```

它们如果被一起搬进新模块，原 hub/其他模块会找不到。拆之前先确认声明属于谁。

### 11.4 源码契约测试

拆文件后，测试可能还在读旧文件。不要立刻改业务，先更新测试读取范围或按函数体取。

### 11.5 不要改行为去适配测试

先判断测试是不是在锁旧结构。结构变了，测试应适配；行为变了，才改业务。

### 11.6 client parts

- parts 按文件名排序拼接。
- 函数声明会 hoist，顺序通常不影响调用。
- 顶层 `const` 在 parts 中会在 `apply` 调用前初始化；但不要把依赖初始化顺序的代码随便移到 parts。
- 模板只保留一个 `/* @include parts */` 标记。

---

## 12. 最近版本变更摘要

### 12.1 1.5.x 关键修复

```text
1.5.67  恢复发布 journal，中断自动回滚
1.5.68  备份大条目流式 CRC，降低峰值内存
1.5.69  心智自我/版本/性格路由拆分 + xAI 契约回归
1.5.70  人格路由拆分
1.5.71  群头衔/调试路由拆分
1.5.72  本地脚本路由拆分
1.5.73  模块面板路由拆分
1.5.74  心智关系/权限/本地模型路由拆分
1.5.75  发图流程拆分
1.5.76  头像路由拆分
1.5.77  上报/秘书路由拆分
1.5.78  联动/模型动作路由拆分
1.5.79  心智实时路由拆分
1.5.80  面板概览拆分
1.5.81  回执记账拆分
1.5.82  知识库分页/旧请求取消
1.5.83  Telegram 纯图 503 最终重试
1.5.84  面板核心路由 + 分页回归
1.5.85  贴表情路由 + 去重 setup
1.5.86  忘掉一个人整批事务
1.5.87  回复流水拆分
1.5.88  引用解析拆分
1.5.89  引用格式化拆分
1.5.90  引用媒体工具拆分
1.5.91  语音转写拆分
1.5.92  图片处理拆分
1.5.93  会话事件拆分
1.5.94  onMessage 拆分
1.5.95  client 模板/片段构建
1.5.96  测试计时稳定 + 文档
1.5.97  client 页面模块化
1.5.98  再拆 9 个页面
1.5.99  再拆 28 个页面
1.5.99 之后直接进入 1.6.0，没有 1.5.100
```

### 12.2 1.6.x 关键节点

```text
1.6.0   通知/戳一戳拆分
1.6.1   sendSegments 拆分
1.6.2   client 导航拆分
1.6.3   47 个共享 UI/子页拆分
1.6.4   CSS 拆分
1.6.5   deliverTurn 拆分
1.6.6   runSystemTurn / runSubagentTurn 拆分
1.6.7   client 核心 hooks 拆分
1.6.8   回合辅助拆分
1.6.9   群聊上下文拆分
1.6.10  审计文档同步
1.6.11  页面顺序假设清理 + 构建回归
1.6.12  外部验收清单
1.6.13  注意力队列拆分
1.6.14  会话恢复拆分
1.6.15  会话创建拆分
1.6.16  会话解析/交接拆分
1.6.17  目标模型解析拆分
1.6.18  挂载/调试会话拆分
1.6.19  工作区辅助拆分
1.6.20  回合状态拆分
1.6.21  hub lint 清理
1.6.22  host lint 清理
1.6.23  模块/核心空 catch 清理
1.6.24  全仓空 catch 绑定清理
1.6.25  单行 catch 清理
1.6.26  多行 catch 清理
1.6.27  未使用 import + apply 拆分
1.6.28  未使用变量清理
1.6.29  安全 warning 清理 + 正则实验回滚
1.6.30  最终审计/版本文档同步
1.6.42  语音条补 duration（不依赖 ffmpeg）+ 空语音拦截
```

---

## 13. 当前剩余与建议优先级

### 13.1 本地还能做

```text
165 条 warning
  ～
hub.js 1471 行
  主要是组合根和小工具
client.template.js 280 行
  入口包装/React/primitives/export
```

建议优先级：

1. 先做实机验收，找真实故障。
2. 再处理真实故障带来的代码改动。
3. 最后才考虑 warning / 进一步拆小函数。

### 13.2 不建议

- 为了清 warning 改工厂参数形状；
- 为了拆文件改业务；
- 为了“全绿”删测试；
- 没有真实平台验证就宣称 QQ/Telegram/备份/API 全通过。

---

## 14. 外部验收清单（需要人/账号/硬件）

完整版在 [`EXTERNAL-ACCEPTANCE.md`](EXTERNAL-ACCEPTANCE.md)。这里给新会话一个执行顺序。

### 14.1 QQ / OneBot

准备：

- 专用测试机器人 QQ；
- OneBot v11 网关；
- 测试群、测试管理员号；
- 隔离 profile / 数据目录。

步骤：

1. 配置机器人号、管理员号、OneBot 地址/Token。
2. `/platforms` 确认连接、机器人号核对。
3. 管理员私聊发普通消息，确认回复。
4. 白名单群 @ 她，确认群回复。
5. 引用回复、@、图片、语音、文件、撤回通知。
6. 试运行/总开关/调试模式确认不真发。
7. 停网关，发消息进补发队列；恢复后确认只补一次。
8. 断线重连/机器人号变更后的核对。

### 14.2 Telegram

1. Bot Token，`getMe` 正常。
2. 私聊文本、图片、带说明图片。
3. 群消息、回复关系。
4. 连续 503 纯图：确认不推进 offset，恢复后能重试。

### 14.3 备份 / WebDAV / Gitee

1. 本地备份生成与 ZIP 校验。
2. 恢复后重启，数据一致。
3. WebDAV 上传/下载/删除。
4. Gitee 私有仓库首推/增量/拉取。
5. 中断恢复 journal 回滚/继续。
6. 大媒体备份内存峰值。

### 14.4 模型 / API

1. 聊天模型真实回复，用量/费用。
2. 生图文生图/图生图/参考图/失败回退。
3. ASR 云端/本地、TTS 云端/本地。
4. 向量/精排，离线向量回退。
5. xAI 兼容接口参考图契约。

### 14.5 桌面 GUI / profile

1. 面板各页打开、保存、重载。
2. 首次向导、权限页、危险命令确认。
3. 插件升级/回退后 profile 重载，版本正确。
4. 深浅色、窗口尺寸、侧栏布局。

### 14.6 本地推理 / 创作

1. Mac mini MLX/MFLUX 本地生图。
2. RVC/Applio 翻唱、音色导入、取消后台任务。
3. 人声分离、ffmpeg、长任务超时。
4. 大文件上传、磁盘不足、镜像切换。

### 14.7 长期运行

1. 心智记忆跨天、睡觉整理、恢复区 30 天。
2. 会话映射重启恢复、工作区搬家。
3. 定时任务、主动联系、勿扰/每日上限。
4. 连续运行日志、内存、磁盘。

---

## 15. 安全与隐私

- SSH 私钥只在 `~/.ssh`，权限 600。
- Bot Token、API Key、WebDAV/Gitee 凭据只在 mini 的配置里。
- 不要把 `~/.dsh/plugins-data/aurabot` 打包进 Release。
- 不要在日志/issue 里贴未脱敏 Token。
- 测试账号与正式账号分开。
- `dsh-purge` 等宿主维护工具会改变审批行为，实机验收时单独核对。

---

## 16. 新会话开场提示词（可直接复制）

```text
你在 /Users/geng/Desktop/Project/dsh/aurabot-qq-mac 继续维护 AuraBot macOS 插件。
先读 docs/SESSION-HANDOFF.md 和 docs/EXTERNAL-ACCEPTANCE.md。
当前基线：v1.6.42，3658ee3，1562 tests passed，0 lint errors。
先跑 caffeinate 全量测试确认基线，不要假设上次状态。
不要为清 warning 改 API/正则；不要只替换 node_modules 目录升级 Mac mini。
Mac mini：gengzhiyu@100.89.128.72，SSH key ~/.ssh/aurabot_macmini_ed25519，Tailscale 名称 gengmac-mini。
发布必须：全量测试 → lint/语法 → 打包 → tag/Release → 部署 mini → 验证 Aurabot v<version> 已加载。
```

---

## 17. 关键文件索引

```text
docs/SESSION-HANDOFF.md          本文件
docs/EXTERNAL-ACCEPTANCE.md      外部验收清单
docs/HANDOFF.md                  维护交接（环境/数据/发布）
docs/P2-MIGRATION.md             模块/client 迁移审计
docs/OVERLAP-AUDIT.md            与 DSH 能力重叠审计
docs/PURGE-COMPAT.md             dsh-purge 兼容
docs/REFACTOR-PLAN.md            重构总纲（目标架构 / 审计口径 / 批次表）
docs/REPO-INVENTORY.md           全仓清单与每文件结论（生成物）
docs/HOST-COMPAT.md              宿主兼容判定（rc.3 / purge 1.7.20）
docs/ACCEPTANCE-LOG.md           每批验收证据（自动测试 / 模拟网关 / 真实 purge / Mini 实机）
docs/repo-audit/*.json           审计结论数据（清单的唯一来源）
client/README.md                 client 单文件构建
CHANGELOG.md                     版本变更
src/chat/                        聊天中枢拆分模块
test/client-build.test.js        client 构建回归
test/e2e.test.js                 完整插件 E2E
test/modules.test.js             模块/热重载
test/backup.test.js              备份/恢复
test/mind-core.test.js           心智核心
test/group-owner-tools.test.js   群管/权限
```

---

## 18. 最后检查清单

发布前：

- [ ] `git status` 明确，未提交文件知道是什么
- [ ] `package.json` / CHANGELOG / README 版本一致
- [ ] 全量 1562（或当前数量）通过
- [ ] 语法检查通过
- [ ] lint 0 errors
- [ ] client build 已重新生成
- [ ] 包布局 `package/`，无日志/配置/备份
- [ ] sha256 已计算
- [ ] tag 与 commit 对应
- [ ] GitHub Release 资产上传成功
- [ ] mini `/tmp/dsh-aurabot-qq-final21.tgz` 已更新
- [ ] mini `pnpm install` 成功
- [ ] mini 日志显示目标版本
- [ ] 外部验收清单中本轮涉及项已实机验证/明确未验证

如果任何一步没做，不要对外说“全部完成”。
