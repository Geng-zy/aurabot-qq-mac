<div align="center">

<img src="assets/mac-banner.svg" alt="Aurabot for macOS · a macOS fork of the Dafeiyu QQ plugin" width="100%" />

**Run "Dafeiyu" fully on an Apple-silicon Mac: chat, voice, file sending and one-click song covers**

[简体中文](README.md) · **English**

[![fork of](https://img.shields.io/badge/fork%20of-aureth--labs%2Fdsh--aurabot--qq-555?logo=github)](https://github.com/aureth-labs/dsh-aurabot-qq)
[![platform](https://img.shields.io/badge/platform-macOS%20·%20Apple%20silicon-1d4a4f?logo=apple)](#-install)
[![license](https://img.shields.io/github/license/Geng-zy/aurabot-qq-mac?color=d9822b)](LICENSE)

</div>

## 📌 What this repository is

This repository is a **fork of [aureth-labs/dsh-aurabot-qq](https://github.com/aureth-labs/dsh-aurabot-qq)** (MIT, branched from upstream v1.2.0). Upstream is the "Aurabot / Dafeiyu" QQ bot plugin for DeepSeek Harness (DSH). **All of its features come from upstream and its contributors.**

Upstream targets Windows only. This fork does one thing: **make it work on macOS (Apple silicon)**. Windows / Linux-only code was removed, so use [upstream](https://github.com/aureth-labs/dsh-aurabot-qq) on Windows. Please file only macOS-specific issues here.

## 🍎 What differs from upstream

| Area | Upstream (Windows) | This fork (macOS) |
|---|---|---|
| QQ gateway | Plugin downloads, starts and injects Windows SnowLuma | SnowLuma has no macOS build: run its official image in OrbStack / Docker; the plugin only connects to the OneBot address you enter |
| Song environment | PowerShell, CUDA PyTorch, one environment | curl + built-in unzip, MPS on Apple silicon, **two environments** (voice conversion and vocal separation), every version pinned to a verified set |
| Song quality | separate → convert → mix | plus local originals first, de-reverb, lead/backing or duet split, auto key and octave folding from a per-voice profile, tone matching |
| Fallback TTS | Windows System.Speech | macOS `say` |
| Sending files | gateway reads local paths | gateway in a container can't: small files as base64, **files over 30 MB through a loopback-only temporary download link** |

## 🚀 Install

**What you install and set up yourself — nothing else:**

| Item | Why | Notes |
|---|---|---|
| DeepSeek Harness desktop | the plugin runs inside it | set up a model in DSH; enable DSH's speech-input plugin if she should understand voice notes |
| [OrbStack](https://orbstack.dev) (or Docker Desktop) | runs the QQ gateway | approve its prompt on first launch |
| [SnowLuma](https://github.com/SnowLuma/SnowLuma.Docker.Framework) container | QQ gateway (OneBot v11) | start the official docker-compose.yml, log the bot account in through its remote desktop (`http://127.0.0.1:6081`); any OneBot v11 implementation works |
| [Homebrew](https://brew.sh) + `brew install ffmpeg` | only for looking at Bilibili video frames | optional |

No Python, Xcode command line tools, uv, Node or Git to install, no PATH or environment variables, no macOS privacy permissions.

1. Start SnowLuma and log the bot account in.
2. Install the plugin in Terminal, then restart DSH:

   ```bash
   "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add github:Geng-zy/aurabot-qq-mac
   ```
3. Follow the setup wizard: QQ numbers, then the OneBot forward WebSocket URL (usually `ws://127.0.0.1:3001`) and token.
4. As needed in the panel: one-click song install and import a voice, install edge-tts, scan in to Bilibili / Qzone, add an image API.

Upgrade by running the same command again and restarting DSH; settings, personas and memories are kept.

## 📁 Where the plugin puts things

Only these three places, all in your home folder:

| Location | Contents |
|---|---|
| `~/.dsh/profiles/desktop/node_modules/dsh-aurabot-qq` | plugin code (managed by DSH, replaced on upgrade) |
| `~/.dsh/plugins-data/aurabot/` | settings, personas, memory, stickers, diaries, logs, cover cache, installed modules |
| `~/Aurabot/` | `rvc/` song environment, `pyenv/` voice component, `qq-chats/` QQ workspace |

Song environment `~/Aurabot/rvc` (about 5 GB, every download checksummed): uv 0.13.7 and Rubber Band 4.0.0 in `bin/`, Python 3.13.18 in `python/`, Applio 3.7.1 with its own environment (torch 2.11), a separate vocal-separation environment `env/` (audio-separator[cpu] 0.48.0, librosa 1.0.0, torch 2.15), the separation and RVC models, and your imported voices in `models/`. Voice component `~/Aurabot/pyenv`: edge-tts 7.3.1 on the same Python. The plugin never touches the system Python and leaves nothing in `~/.cache` or `~/.local`.

## 📄 License & credits

[MIT](LICENSE); upstream's copyright notice is kept. Original features: [aureth-labs/dsh-aurabot-qq](https://github.com/aureth-labs/dsh-aurabot-qq) and contributors. Covers use [Applio](https://github.com/IAHispano/Applio), [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator), [Rubber Band](https://breakfastquay.com/rubberband/) and unwa's [BS-Roformer Leap](https://huggingface.co/pcunwa/BS-Roformer-Leap); QQ gateway [SnowLuma](https://github.com/SnowLuma/SnowLuma).
