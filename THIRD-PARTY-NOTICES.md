# 第三方组件署名与许可（THIRD-PARTY NOTICES）

本仓库是 [aureth-labs/dsh-aurabot-qq](https://github.com/aureth-labs/dsh-aurabot-qq) 的 macOS 分支。插件代码沿用 [MIT](LICENSE)，保留原作者及贡献者的版权声明。下列素材和第三方组件适用各自的许可。

## 大肥鱼默认头像

`assets/dafeiyu.jpg` 沿用 [上游的原图](https://github.com/aureth-labs/dsh-aurabot-qq/blob/a138d14/assets/dafeiyu.jpg)。上游面板将「大肥鱼」形象标为 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)。

## 桌宠

桌宠模块和素材都不在本仓库，署名和许可见 [dsh-aurabot-qq-mods](https://github.com/aureth-labs/dsh-aurabot-qq-mods) 的 `modules/pet/THIRD-PARTY-NOTICES.md` 和仓库 README。

## Mieksido/surfcore — 目的引擎（MIT）

- 项目：<https://github.com/Mieksido/surfcore>
- 许可：MIT
- 移植范围：`src/purpose/engine.js` 的纯逻辑核心（配置归一化、排程、素材摘要、目标假设、
  候选选择、提示词构建、回执解析、状态迁移）移植自该项目的 `src/purpose-engine.js`，
  并按 Aurabot 的模块与配置语境做了改写（接线层 `src/purpose/module.js`、独立模块
  `src/modules/purpose/index.js` 是我们为 Aurabot 新写的，不属于移植范围）。
- 现状：本分叉换成心智核心（`src/mind/`）后，这部分移植代码已经删除，不再随插件分发；署名保留给仍包含它的旧版本。

其原许可全文如下：

```text
MIT License

Copyright (c) 2026 Derpyu520 and qq-bridge / QSH contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## BAAI bge-small-zh-v1.5（MIT）

- 模型和词表来自上游 Aurabot [beta 的模型目录](https://github.com/aureth-labs/dsh-aurabot-qq/tree/fd7d746/models)，模型卡见 [BAAI](https://huggingface.co/BAAI/bge-small-zh-v1.5)。许可原文见随包的 `models/LICENSE`。
- 本地推理的接线基于上游 Aurabot [vector-embed.js](https://github.com/aureth-labs/dsh-aurabot-qq/blob/fd7d746/src/features/vector-embed.js)，并接到本项目的心智向量接口。

## Microsoft ONNX Runtime Web（MIT）

- `models/onnxruntime/` 中的 JavaScript 和 WebAssembly 文件取自 [onnxruntime-web 1.31.1](https://www.npmjs.com/package/onnxruntime-web/v/1.31.1) 的官方 npm 包。运行时的 `LICENSE` 和 `ThirdPartyNotices.txt` 一同分发。

## 内置本地生图

- 推理环境按需安装 [MFLUX](https://github.com/mflux-community/mflux)（MIT）。[OsaurusAI 的四位权重](https://huggingface.co/OsaurusAI/Qwen-Image-2.1-mflux-4bit) 由部署器单独下载，适用该模型仓库的 Qwen Research License Agreement。

## 其他

- `README.md` 的「致谢」一节还列出了在 DSH 插件机制上参考过思路的其他插件（MIT），那些只参考了踩坑经验，未复制代码。
