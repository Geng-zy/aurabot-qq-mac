// 极简 zip 读取：只支持「不压缩」和「deflate」两种（几乎所有 zip 都是这两种），够导入模型用。

import { crc32, inflateRawSync } from 'node:zlib'

function decodeName(bytes, utf8Flag) {
  if (utf8Flag) return bytes.toString('utf8')
  // Windows 上打的中文 zip 文件名多半是 GBK；先试 UTF-8，不合法再按 GBK
  const s = bytes.toString('utf8')
  if (!s.includes('�')) return s
  try { return new TextDecoder('gbk').decode(bytes) } catch { return s }
}

/**
 * 读出 zip 里的文件。
 * @param {Buffer} buf
 * @param {(name: string) => boolean} [want] 只解压想要的文件（省内存）
 * @returns {Array<{name: string, data: Buffer}>}
 */
export function readZip(buf, want = () => true) {
  // 从尾部找「中央目录结束」记录
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是 zip 文件（或者文件不完整）')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = []
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 目录损坏')
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = decodeName(buf.subarray(p + 46, p + 46 + nameLen), flags & 0x800)
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/') || !want(name)) continue
    if (flags & 1) throw new Error(`「${name}」加了密码，解不开`)
    const lNameLen = buf.readUInt16LE(local + 26)
    const lExtraLen = buf.readUInt16LE(local + 28)
    const start = local + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(start, start + compSize)
    let data
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) data = inflateRawSync(raw)
    else throw new Error(`「${name}」用了不支持的压缩方式（${method}），请重新打包成普通 zip`)
    out.push({ name, data })
  }
  return out
}

// ---------- 严格版：给「下载来的第三方 zip」用 ----------
//
// 仓里有三种 zip 读取者，它们服务不同威胁模型，不要合并成一个：
//   1. readZip（本文件上半部分）：内存里宽松解析，只认不压缩/deflate，不校验 CRC、不限制大小。
//      用于模型权重包（python.js / song/studio.js），只需要挑出几个文件。
//   2. readZipStrict（本段）：内存里严格解析——拒绝加密、拒绝路径穿越、限制解压总大小、逐条校验 CRC 与长度。
//      用于社区模块安装（community.js），输入来自网络。
//   3. backup.js 的 readEntries/readEntry：从文件句柄流式读、分块过 CRC、带 4GB/目录大小上限。
//      备份文件可能有几十 MB，不能整块读进内存；而且它要边解边写盘。
// 三者的差别是安全边界，不是代码风格。

/**
 * 路径安全检查：相对、不含反斜杠/NUL、不以盘符开头、没有 . 或 .. 段。
 * @param {string} name
 */
export function safeRelativePath(name) {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return false
  return name.split('/').every((seg) => seg && seg !== '.' && seg !== '..')
}

/**
 * 严格解开一个第三方 zip。
 * @param {Buffer} buf
 * @param {object} [o]
 * @param {(name: string) => boolean} [o.validateName] 路径检查（传 safeRelativePath 即拒绝穿越）
 * @param {number} [o.maxTotalBytes] 解压后总大小上限
 * @returns {Array<{name: string, data: Buffer}>}
 */
export function readZipStrict(buf, { validateName = null, maxTotalBytes = Infinity } = {}) {
  let end = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break }
  if (end < 0) throw new Error('不是有效的 zip')
  const count = buf.readUInt16LE(end + 10)
  let p = buf.readUInt32LE(end + 16)
  const out = []
  let total = 0
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 目录损坏')
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const packed = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    if (flags & 1) throw new Error('zip 不能加密')
    if (name.endsWith('/')) continue
    if (validateName && !validateName(name)) throw new Error(`zip 里有不安全的路径：${name}`)
    if (method !== 0 && method !== 8) throw new Error(`zip 用了不支持的压缩方式：${name}`)
    total += size
    if (total > maxTotalBytes) throw new Error('解压后太大')
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error('zip 文件头损坏')
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + packed)
    // maxOutputLength 必须是有限数：不传就按 Node 默认（否则 Infinity 会抛 RangeError）
    const data = method === 8
      ? (Number.isFinite(maxTotalBytes) ? inflateRawSync(raw, { maxOutputLength: maxTotalBytes }) : inflateRawSync(raw))
      : Buffer.from(raw)
    if (data.length !== size || crc32(data) !== crc) throw new Error(`zip 校验失败：${name}`)
    out.push({ name, data })
  }
  return out
}
