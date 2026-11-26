// 表情包文件的安全路径解析：只接受「纯文件名 + 图片扩展名」，否则返回空串。
//
// 从 features/stickers.js 搬出来的原因：core/media.js 也要按 md5 找表情文件，
// 而 core 不该反向依赖一个 460 行的功能模块。这里只留纯规则，目录由调用方给。

import { basename, join } from 'node:path'

/**
 * @param {string} dir 表情包目录
 * @param {{file?: string}} item 表情记录
 * @returns {string} 可读的绝对路径；文件名不合法时返回 ''
 */
export function stickerFileIn(dir, item) {
  const file = String(item?.file || '')
  if (!file || basename(file) !== file || !/\.(?:png|jpe?g|gif|webp)$/i.test(file)) return ''
  return join(dir, file)
}
