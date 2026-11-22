// 表情近似去重：用 sharp（DSH 自带则复用）算 64 位 dHash；没有 sharp 时返回空串，退回 MD5。
import { findSharp } from '../core/img.js'

let sharpPromise = null
async function getSharp() {
  if (!sharpPromise) sharpPromise = findSharp().catch(() => null)
  return sharpPromise
}

export async function dHash(buf) {
  const sharp = await getSharp()
  if (typeof sharp !== 'function' || !Buffer.isBuffer(buf) || !buf.length) return ''
  try {
    const { data } = await sharp(buf).resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true })
    let value = 0n
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const left = data[y * 9 + x]
        const right = data[y * 9 + x + 1]
        if (left > right) value |= 1n << BigInt(y * 8 + x)
      }
    }
    return value.toString(16).padStart(16, '0')
  } catch { return '' }
}

export function dHashDistance(a, b) {
  if (!a || !b) return 64
  let x = BigInt('0x' + a) ^ BigInt('0x' + b)
  let n = 0
  while (x) { n += Number(x & 1n); x >>= 1n }
  return n
}

export async function toWebP(buf, quality = 88) {
  const sharp = await getSharp()
  if (typeof sharp !== 'function' || !Buffer.isBuffer(buf) || !buf.length) return null
  try {
    const out = await sharp(buf).webp({ quality, effort: 4 }).toBuffer()
    return Buffer.isBuffer(out) && out.length ? out : null
  } catch { return null }
}
