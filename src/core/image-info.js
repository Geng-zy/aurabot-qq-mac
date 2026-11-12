// 图片的小工具：类型、尺寸、GIF 帧数、表情包尺寸够不够。纯函数，和平台无关。

/** 偷表情的尺寸兜底（拿到字节、宽高之后再判）。 */
export function stickerSizeOk({ width, height, bytes }, limits = {}) {
  const maxSide = limits.maxSide ?? 520
  if (!(bytes > 0)) return false
  if (!(width > 0) || !(height > 0)) return true // 读不出尺寸就只看体积
  if (width > maxSide || height > maxSide) return false
  const r = width / height
  return r >= 0.75 && r <= 1.33
}

/** 从图片字节里读宽高（PNG / GIF / JPEG / WEBP），读不出返回 0。 */
export function imageSize(buf) {
  try {
    if (!buf || buf.length < 24) return { width: 0, height: 0 }
    if (buf[0] === 0x89 && buf[1] === 0x50) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    if (buf[0] === 0x47 && buf[1] === 0x49) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) {
      const chunk = buf.toString('ascii', 12, 16)
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21)
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
      }
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue }
        const marker = buf[i + 1]
        const len = buf.readUInt16BE(i + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) }
        }
        i += 2 + len
      }
    }
  } catch (error) {}
  return { width: 0, height: 0 }
}

/** GIF 有几帧：数图形控制扩展块，够判断是不是动图。 */
export function gifFrames(buf) {
  if (!buf || buf[0] !== 0x47 || buf[1] !== 0x49) return 0
  let n = 0
  for (let i = 13; i + 2 < buf.length; i++) if (buf[i] === 0x21 && buf[i + 1] === 0xf9 && buf[i + 2] === 4) n++
  return n
}

export function mimeOf(buf) {
  if (!buf || buf.length < 12) return 'application/octet-stream'
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif'
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) return 'image/webp'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  return 'application/octet-stream'
}
