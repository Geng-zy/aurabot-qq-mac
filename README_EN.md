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

You need an Apple-silicon Mac, DeepSeek Harness desktop, a spare QQ account for the bot and OrbStack (or Docker Desktop).

1. Run [SnowLuma's official docker-compose.yml](https://github.com/SnowLuma/SnowLuma.Docker.Framework) and log the bot account in through its remote desktop (any OneBot v11 implementation works).
2. Install the plugin in Terminal, then restart DSH:

   ```bash
   "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add github:Geng-zy/aurabot-qq-mac
   ```
3. Follow the setup wizard: QQ numbers, then the OneBot forward WebSocket URL (usually `ws://127.0.0.1:3001`) and token.

Upgrade by running the same command again and restarting DSH; settings, personas and memories are kept.

## 📄 License & credits

[MIT](LICENSE); upstream's copyright notice is kept. Original features: [aureth-labs/dsh-aurabot-qq](https://github.com/aureth-labs/dsh-aurabot-qq) and contributors. Covers use [Applio](https://github.com/IAHispano/Applio), [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator), [Rubber Band](https://breakfastquay.com/rubberband/) and unwa's [BS-Roformer Leap](https://huggingface.co/pcunwa/BS-Roformer-Leap); QQ gateway [SnowLuma](https://github.com/SnowLuma/SnowLuma).
