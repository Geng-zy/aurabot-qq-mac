<div align="center">

<img src="assets/mac-banner.svg" alt="Aurabot for macOS · 大肥鱼 QQ 插件的 macOS 分叉" width="100%" />

**让「大肥鱼」在 Apple 芯片的 Mac 上完整跑起来：聊天、语音、发文件、一键翻唱**

**简体中文** · [English](README_EN.md)

[![fork of](https://img.shields.io/badge/fork%20of-aureth--labs%2Fdsh--aurabot--qq-555?logo=github)](https://github.com/aureth-labs/dsh-aurabot-qq)
[![platform](https://img.shields.io/badge/platform-macOS%20·%20Apple%20silicon-1d4a4f?logo=apple)](#-安装)
[![license](https://img.shields.io/github/license/Geng-zy/aurabot-qq-mac?color=d9822b)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/DeepSeek%20Harness-plugin-6a5acd)](https://github.com/deepseek-ai/deepseek-harness)

</div>

## 📌 这个仓库是什么

本仓库 **fork 自 [aureth-labs/dsh-aurabot-qq](https://github.com/aureth-labs/dsh-aurabot-qq)**（MIT 许可，从原项目 v1.2.0 分出来）。
原项目是 DeepSeek Harness（DSH）的 QQ 机器人插件「Aurabot / 大肥鱼」：人格、心情、记忆、语音、表情、翻唱、QQ 空间、B 站、模块系统……这些**功能都来自原项目和它的贡献者**。

原作者只适配了 Windows。这个分叉做的事只有一件：**让它在 macOS（Apple 芯片）上完整可用**。为此删掉了 Windows / Linux 专用的代码，所以：

- 用 **Mac** → 装这个仓库；
- 用 **Windows** → 请装[原项目](https://github.com/aureth-labs/dsh-aurabot-qq)。

功能介绍、使用手册、模块市场、交流群都以原项目为准；**只和 Mac 有关的问题**请在本仓库提 issue。

## 🍎 和原项目有什么不同

| 方面 | 原项目（Windows） | 本分叉（macOS） |
|---|---|---|
| 接 QQ | 插件下载、启动、注入 Windows 版 SnowLuma | SnowLuma 没有 Mac 版：在 OrbStack / Docker 里跑它的官方镜像，插件只按填的 OneBot 地址去连 |
| 翻唱环境 | PowerShell 下载、CUDA 版 PyTorch、一套环境 | curl + 自带解压；Apple 芯片用 MPS 加速；**两套环境**（换声、人声分离分开，合成一套会让分离模型失败）；版本全部固定为实测跑通的组合 |
| 翻唱效果 | 分离 → 换声 → 混音 | 另加：本地原唱优先、去混响、拆主唱伴唱 / 男女对唱、按音色档案自动定调和挪八度、音色校正，面板可逐项开关 |
| 语音兜底 | Windows 自带语音（System.Speech） | macOS 自带语音（`say`），不用装任何东西 |
| 发文件 | 网关和插件在同一台机器，按路径直发 | 网关在容器里看不到本机路径：小文件走 base64，**超过 30 MB 走只对本机开放的临时下载口** |
| 面板 | Windows 路径、PowerShell 命令 | 全部换成 Mac 写法，示例路径按你自己的用户目录显示 |

逐条的改动说明见 [提交记录](https://github.com/Geng-zy/aurabot-qq-mac/commits/main)。

## 🗺️ 在一台 Mac 上怎么跑起来

<img src="assets/mac-architecture.svg" alt="QQ ⇄ OrbStack 里的 SnowLuma ⇄ Aurabot 插件 ⇄ DSH；翻唱环境在 ~/Aurabot/rvc" width="100%" />

## 🚀 安装

**你需要：** Apple 芯片的 Mac、装好的 DeepSeek Harness 桌面版、一个当机器人的 QQ 小号、[OrbStack](https://orbstack.dev)（或 Docker Desktop）。

1. **跑 QQ 网关**：用 [SnowLuma 官方的 docker-compose.yml](https://github.com/SnowLuma/SnowLuma.Docker.Framework) 起容器，打开它的远程桌面登录机器人号。NapCat、LLOneBot、Lagrange 等别的 OneBot v11 实现也可以。
2. **装插件**（在「终端」里运行）：

   ```bash
   "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add github:Geng-zy/aurabot-qq-mac
   ```

   装完重启 DSH，左侧栏会出现 **Aurabot**。
3. **跟着设置向导走**：填机器人 QQ 号和你的 QQ 号，再填 OneBot 正向 WebSocket 地址（一般是 `ws://127.0.0.1:3001`）和令牌。建议先开着「试运行」。

**升级**：再运行一遍上面的安装命令，然后重启 DSH。设置、人格、记忆都会保留。

## 🎤 翻唱一键安装装了什么

面板「翻唱」页点「一键安装」，全部装进 `~/Aurabot/rvc`（约 5 GB，不碰系统环境）：

| 东西 | 版本 |
|---|---|
| Python（uv 自己下载的，只给翻唱用） | 3.13.18 |
| Applio（RVC 换声）+ 自己的环境 | 3.7.1，torch 2.11 |
| 人声分离环境 | audio-separator[cpu] 0.48.0、librosa 1.0.0、audioread 3.1.0，torch 2.15 |
| 工具 | uv 0.13.7、ffmpeg（imageio-ffmpeg）、Rubber Band 4.0.0 官方版 |
| 模型 | 主分离模型 BS-Roformer Leap Xe、去混响 / 拆主唱伴唱 / 分男女声 3 个增强模型、rmvpe、contentvec |

下载都核对校验值。装好后导入你有权使用的 RVC 音色（.pth / zip）就能点歌；再用这个音色本人的干声数据集生成「音色档案」，就能自动定调和校正音色。

## 🧑‍💻 开发

```bash
git clone https://github.com/Geng-zy/aurabot-qq-mac.git
cd aurabot-qq-mac
npm test        # 全部测试；Mac 相关的在 test/macos.test.js、test/file-relay.test.js、test/song-pipeline.test.js
```

需要 Node.js ≥ 22.13.0。插件内部名字保持 `dsh-aurabot-qq` 不变（DSH 靠它找数据目录 `~/.dsh/plugins-data/aurabot`），从原项目换过来不会丢数据。

原项目的文档同样适用：[用户手册](docs/USER-MANUAL.md) · [写模块教程](docs/MODULE-TUTORIAL.md) · [模块 API](src/modules/API.md) · [设计要点](docs/DESIGN.md) · [更新记录](CHANGELOG.md)。

## 📄 License & 致谢

[MIT](LICENSE)，原项目的版权声明保留不变。

- Aurabot 的全部原有功能来自 [aureth-labs/dsh-aurabot-qq](https://github.com/aureth-labs/dsh-aurabot-qq) 及其贡献者。
- 原项目致谢：参考了 [Yuuyuko-uu](https://github.com/Yuuyuko-uu) 的 dsh-qq-bridge 等插件在 DSH 插件机制上踩过的坑；人物记忆的设计来自 [Emotionana](https://github.com/Emotionana) 的 persona-memory。
- 翻唱用到 [Applio](https://github.com/IAHispano/Applio)、[python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator)、[Rubber Band](https://breakfastquay.com/rubberband/)，主分离模型 [BS-Roformer Leap](https://huggingface.co/pcunwa/BS-Roformer-Leap)（unwa）；QQ 网关 [SnowLuma](https://github.com/SnowLuma/SnowLuma)。
