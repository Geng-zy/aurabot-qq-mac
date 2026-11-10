// 内置模块清单（按启动顺序）。每个模块的说明见各自文件开头；写法和接口见 API.md。

import stickers from './stickers/index.js'
import voice from './voice/index.js'
import qqTools from './qq-tools/index.js'
import qqApi from './qq-api/index.js'
import imagegen from './imagegen/index.js'
import diary from './diary/index.js'
import qzoneSocial from './qzone-social/index.js'
import bili from './bili/index.js'
import song from './song/index.js'
import profile from './profile/index.js'
import contacts from './contacts/index.js'
import video from './video/index.js'

export const BUILTINS = [stickers, voice, qqTools, qqApi, imagegen, diary, qzoneSocial, bili, song, profile, contacts, video]
