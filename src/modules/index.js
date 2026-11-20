// 内置模块清单（按启动顺序）。每个模块的说明见各自文件开头；写法和接口见 API.md。

import stickers from './stickers/index.js'
import imagegen from './imagegen/index.js'
import song from './song/index.js'
import video from './video/index.js'

export const BUILTINS = [stickers, imagegen, song, video]
