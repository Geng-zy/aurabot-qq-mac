// 收到图片的下载、缩小和动图说明。

import { gifFrames, mimeOf } from '../core/image-info.js'
import { findFfmpeg, findSharp, shrinkImage, shrinkWithSharp } from '../core/img.js'

export function createImageTools({
  getConfig, channelOf, segmentBytes, log, maxImageBytes, maxMessageImages, modelImageBytes,
}) {
  const animatedNote = (imgs) => {
    const n = imgs.filter((img) => img.frames > 1).length
    return n ? `（其中 ${n} 张是动图，你看到的可能只是其中一帧，别说它是静态的，也别编没看到的动作）` : ''
  }

  async function fitForModel(buf) {
    if (buf.length <= modelImageBytes) return buf
    const ffmpeg = findFfmpeg(getConfig().local?.ffmpegPath || '')
    const small = (ffmpeg ? await shrinkImage(buf, 2048, ffmpeg) : null) || await shrinkWithSharp(await findSharp(), buf, 2048)
    if (!small || small.length > modelImageBytes) throw new Error(`图片 ${Math.round(buf.length / 1048576)}MB 缩不下来`)
    return small
  }

  async function imagesOf(msg) {
    const out = []
    for (const seg of [...msg.stickers, ...msg.images].slice(0, maxMessageImages)) {
      try {
        const raw = await segmentBytes(seg, channelOf(msg.chatId), { maxBytes: maxImageBytes, allowLocal: false })
        const frames = gifFrames(raw)
        const buf = await fitForModel(raw)
        const mime = mimeOf(buf)
        if (!mime.startsWith('image/')) continue
        out.push({ data: buf.toString('base64'), mediaType: mime, frames })
      } catch (error) {
        log.debug('图片下载失败：', error.message)
      }
    }
    return out
  }

  return { animatedNote, fitForModel, imagesOf }
}
