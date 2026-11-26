// 备份用的 ZIP 编解码（写头 / 读目录 / 边解压边校验）。
//
// 从 core/backup.js 搬出来的原因：备份那 1059 行里，字节格式和「备份什么、怎么恢复」混在一起，
// 改格式要翻半个文件。这里只放格式本身与它的上限，策略（哪些文件进包、怎么发布恢复）留在 backup.js。
// 注意：这是**流式**读取者，威胁模型与 core/zip.js 的内存版不同（见那个文件顶部的说明）。

import { crc32, createInflateRaw, inflateRawSync } from 'node:zlib'

/** 没做 zip64：超过 4GB 明确报错，不生成坏文件。 */
export const MAX_ZIP = 0xfffffff0
/** Buffer 和 readFile 的边界。 */
export const MAX_FILE = 2 ** 31 - 1
/** 超过这个大小就不 deflate，直接 store（媒体本来压不动）。 */
export const DEFLATE_MAX = 64 * 1024 * 1024
export const MAX_EXPANDED = 8 * 1024 ** 3
export const MAX_DIRECTORY = 32 * 1024 ** 2
export const MAX_MANIFEST = 8 * 1024 ** 2
/** 备份清单文件名（写进 zip，恢复时按它认版本）。 */
export const MANIFEST = 'aurabot-backup.json'

export const dosTime = (d) => ({ time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() })

export function localHeader(entry) {
  const name = Buffer.from(entry.name)
  const h = Buffer.alloc(30)
  h.writeUInt32LE(0x04034b50, 0)
  h.writeUInt16LE(20, 4)
  h.writeUInt16LE(0x0800, 6) // 文件名是 UTF-8
  h.writeUInt16LE(entry.method, 8)
  h.writeUInt16LE(entry.time, 10)
  h.writeUInt16LE(entry.date, 12)
  h.writeUInt32LE(entry.crc, 14)
  h.writeUInt32LE(entry.packed, 18)
  h.writeUInt32LE(entry.size, 22)
  h.writeUInt16LE(name.length, 26)
  return Buffer.concat([h, name])
}

export function centralHeader(entry) {
  const name = Buffer.from(entry.name)
  const h = Buffer.alloc(46)
  h.writeUInt32LE(0x02014b50, 0)
  h.writeUInt16LE(20, 4)
  h.writeUInt16LE(20, 6)
  h.writeUInt16LE(0x0800, 8)
  h.writeUInt16LE(entry.method, 10)
  h.writeUInt16LE(entry.time, 12)
  h.writeUInt16LE(entry.date, 14)
  h.writeUInt32LE(entry.crc, 16)
  h.writeUInt32LE(entry.packed, 20)
  h.writeUInt32LE(entry.size, 24)
  h.writeUInt16LE(name.length, 28)
  h.writeUInt32LE(entry.offset, 42)
  return Buffer.concat([h, name])
}

/** 打包数据目录，返回 { file, name, files, bytes, skipped }。configOnly = 只带配置/记忆/人格等文本数据，不带媒体、聊天流水和 DSH 会话。 */
/**
 * 打包数据目录。configOnly = 只带配置、心智核心、人格等文本数据，不带画作、表情包这些媒体。
 * captureMind：返回 Map<相对路径, Buffer>，由宿主接上心智核心（没接就不带心智数据）。
 * 拿不到完整的库就让备份失败，不能把缺一半的心智当成功交给管理员。
 */
export async function readExact(file, length, position) {
  const bytes = Buffer.allocUnsafe(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await file.read(bytes, offset, length - offset, position + offset)
    if (!bytesRead) throw new Error('备份文件读取不完整')
    offset += bytesRead
  }
  return bytes
}

/** 只支持 Aurabot 使用的单卷 ZIP32；在分配或解压前核对文件范围。
 *
 * 名字策略（哪些路径能进备份、哪些要拒绝）属于 backup.js 的业务规则，
 * 这里只要求调用方提供一个 checkName 钩子：不合法就让它抛错。
 * @param {FileHandle} fh
 * @param {number} size
 * @param {{checkName?: (name: string, ctx: object) => void}} [policy]
 */
export async function readEntries(fh, size, policy = {}) {
  const checkName = policy.checkName || (() => {})
  if (size < 22 || size > MAX_ZIP) throw new Error('不是有效的备份文件')
  const tailLen = Math.min(size, 22 + 65535)
  const tail = await readExact(fh, tailLen, size - tailLen)
  let end = tailLen - 22
  while (end >= 0 && (tail.readUInt32LE(end) !== 0x06054b50 || end + 22 + tail.readUInt16LE(end + 20) !== tailLen)) end--
  if (end < 0) throw new Error('不是有效的备份文件')
  const count = tail.readUInt16LE(end + 10)
  const dirSize = tail.readUInt32LE(end + 12)
  const dirOffset = tail.readUInt32LE(end + 16)
  if (tail.readUInt32LE(end + 4) || tail.readUInt16LE(end + 8) !== count || !count
      || dirSize < count * 46 || dirSize > MAX_DIRECTORY || dirOffset + dirSize !== size - tailLen + end) {
    throw new Error('备份目录范围无效或超过限制')
  }
  const dir = await readExact(fh, dirSize, dirOffset)
  const entries = []
  const names = new Set()
  let p = 0
  let expanded = 0
  for (let i = 0; i < count; i++) {
    if (p + 46 > dir.length || dir.readUInt32LE(p) !== 0x02014b50) throw new Error('备份文件的目录损坏')
    const nameLen = dir.readUInt16LE(p + 28)
    const next = p + 46 + nameLen + dir.readUInt16LE(p + 30) + dir.readUInt16LE(p + 32)
    if (!nameLen || next > dir.length || dir.readUInt16LE(p + 34)) throw new Error('备份文件的目录损坏')
    const entry = {
      flags: dir.readUInt16LE(p + 8), method: dir.readUInt16LE(p + 10), crc: dir.readUInt32LE(p + 16),
      packed: dir.readUInt32LE(p + 20), size: dir.readUInt32LE(p + 24), offset: dir.readUInt32LE(p + 42),
      name: dir.toString('utf8', p + 46, p + 46 + nameLen),
    }
    const { name, method, packed, size: length, offset, flags } = entry
    const key = process.platform === 'win32' ? name.toLowerCase() : name
    const session = name.startsWith('dsh-sessions/')
    const rel = name.slice(session ? 13 : 5)
    const legacySessionMarker = name === '.restore-sessions-pending.json' || name === 'data/.restore-sessions-pending.json'
    checkName(name, { key, session, rel, legacySessionMarker, names })
    names.add(key)
    expanded += length
    if ((flags & ~0x0808) || (method !== 0 && method !== 8)
        || length > MAX_FILE || expanded > MAX_EXPANDED || offset + 30 + packed > dirOffset
        || (method === 0 && packed !== length)
        || (method === 8 && (length > DEFLATE_MAX || packed > DEFLATE_MAX + 1024 * 1024))
        || (name === MANIFEST && length > MAX_MANIFEST)) {
      throw new Error('备份条目格式无效或超过资源限制')
    }
    entries.push(entry)
    p = next
  }
  if (p !== dir.length) throw new Error('备份文件的目录损坏')

  let dataEnd = 0
  for (const entry of [...entries].sort((a, b) => a.offset - b.offset)) {
    if (entry.offset < dataEnd) throw new Error('备份条目范围重叠')
    const head = await readExact(fh, 30, entry.offset)
    if (head.readUInt32LE(0) !== 0x04034b50 || head.readUInt16LE(6) !== entry.flags
        || head.readUInt16LE(8) !== entry.method || (!(entry.flags & 8)
          && (head.readUInt32LE(14) !== entry.crc || head.readUInt32LE(18) !== entry.packed || head.readUInt32LE(22) !== entry.size))) {
      throw new Error('备份条目头与目录不一致')
    }
    const nameLength = head.readUInt16LE(26)
    entry.start = entry.offset + 30 + nameLength + head.readUInt16LE(28)
    dataEnd = entry.start + entry.packed
    if (!nameLength || dataEnd > dirOffset
        || (await readExact(fh, nameLength, entry.offset + 30)).toString('utf8') !== entry.name) {
      throw new Error('备份条目范围无效')
    }
  }
  return entries
}

/** 校验大条目时边解压边算 CRC，不把 96MiB 媒体整块留在内存。 */
export async function verifyEntryStreaming(fh, entry) {
  const invalid = () => new Error('备份文件校验失败：' + entry.name)
  if (entry.method === 0) {
    await readEntry(fh, entry, { writeFile: async () => {} })
    return
  }
  const inflater = createInflateRaw({ maxOutputLength: Math.max(entry.size, 1) })
  let size = 0
  let checksum = 0
  let failure = null
  inflater.on('data', (chunk) => { size += chunk.length; checksum = crc32(chunk, checksum) })
  inflater.on('error', (error) => { failure = error })
  for (let offset = 0; offset < entry.packed;) {
    const part = await readExact(fh, Math.min(1024 * 1024, entry.packed - offset), entry.start + offset)
    offset += part.length
    if (!inflater.write(part)) await new Promise((resolve) => inflater.once('drain', resolve))
  }
  await new Promise((resolve, reject) => {
    inflater.once('end', resolve)
    inflater.once('error', reject)
    inflater.end()
  })
  if (failure) throw invalid()
  if (size !== entry.size || checksum !== entry.crc) throw invalid()
}

export async function readEntry(fh, entry, output) {
  const invalid = () => new Error('备份文件校验失败：' + entry.name)
  if (output && entry.method === 0) {
    let checksum = 0
    for (let offset = 0; offset < entry.size;) {
      const part = await readExact(fh, Math.min(1024 * 1024, entry.size - offset), entry.start + offset)
      checksum = crc32(part, checksum)
      await output.writeFile(part)
      offset += part.length
    }
    if (checksum !== entry.crc) throw invalid()
    return
  }
  const packed = await readExact(fh, entry.packed, entry.start)
  const data = entry.method === 8 ? inflateRawSync(packed, { maxOutputLength: Math.max(entry.size, 1) }) : packed
  if (data.length !== entry.size || crc32(data) !== entry.crc) throw invalid()
  if (output) await output.writeFile(data)
  else return data
}

