// 一键备份：把数据目录打成一个 zip，换电脑时导入，下次启动替换。
//
// 恢复不能在运行中做：插件内存里的配置和状态随时会写回去，把刚恢复的文件盖掉。所以导入只解到
// .restore/，启动时在读配置之前才换上去，被换掉的文件挪到 backups/pre-restore-*/，随时能找回。

import { randomUUID } from 'node:crypto'
import { open, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { crc32, createInflateRaw, deflateRawSync, inflateRawSync } from 'node:zlib'
import { homedir } from 'node:os'
import { join, parse, relative } from 'node:path'
import { dataDir, dshHome } from './store.js'

/**
 * 旧记忆模块的文件（已由心智核心接管，只剩迁移来源）。备份时当普通文件带上；
 * 恢复一份带着它们的备份时整套一起换，不让新旧两代混在一起。
 */
const MEMORY_FILES = ['memory.sqlite', 'memory.sqlite-wal', 'memory.sqlite-shm', 'memories.json', 'memory-json-fallback.json']

/** 新格式带秒/毫秒和随机后缀，避免同一分钟覆盖；仍兼容旧的 YYYYMMDD-HHmm。 */
const BACKUP_NAME_RE = /^aurabot-(?:backup|config)-\d{8}-\d{4,6}(?:-\d{1,3})?(?:-[a-z0-9]{6,})?\.zip$/u
/** 配置文件和运行时一样接受 UTF-8 BOM，但根节点必须是对象。 */
function parseConfigObject(text) {
  const v = JSON.parse(String(text || '').replace(/^\uFEFF/, ''))
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('配置根节点不是对象')
  return v
}
/** 文件名里的创建时刻；旧格式只有分钟，新格式到毫秒。 */
function backupStamp(name) {
  const m = /^aurabot-(?:backup|config)-(\d{8})-(\d{4,6})(?:-(\d{1,3}))?/.exec(String(name))
  return m ? m[1] + m[2].padEnd(6, '0') + String(m[3] || '0').padStart(3, '0') : ''
}
/**
 * 心智核心的数据目录（相对数据目录）。目录里的文件不直接拷：库由 captureMind 给一份完整的，
 * 快照和 WAL 不带。恢复时库连同 WAL 一起换，不然旧 WAL 会接到新库上把它弄坏。
 */
export const MIND_DIR = 'mind'
const MIND_DB = ['mind.sqlite', 'mind.sqlite-wal', 'mind.sqlite-shm'].map((n) => MIND_DIR + '/' + n)
const inMind = (rel) => rel === MIND_DIR || rel.startsWith(MIND_DIR + '/')

const MANIFEST = 'aurabot-backup.json'
const SCHEMA = 1
const MAX_ZIP = 0xfffffff0 // 没做 zip64：超过 4GB 明确报错，不生成坏文件
const MAX_FILE = 2 ** 31 - 1 // Buffer 和 readFile 的边界
const DEFLATE_MAX = 64 * 1024 * 1024
const MAX_EXPANDED = 8 * 1024 ** 3
const MAX_DIRECTORY = 32 * 1024 ** 2
const MAX_MANIFEST = 8 * 1024 ** 2
const STORE_EXT = /\.(png|jpe?g|gif|webp|mp3|mp4|m4a|ogg|opus|webm|zip|7z|rar|pth|index|onnx|safetensors)$/i
const KEEP_BACKUPS = 10
const KEEP_PRE_RESTORE = 10

/**
 * 不进备份的东西。logs、缓存没有价值；edge-profile 是浏览器资料，登录态绑定这台电脑，
 * 带过去也用不了。模块库模块不打包，恢复后按名单重新下载。
 */
const SKIP = ['backups', '.restore', '.restore-sessions', '.restore-pending.json', '.restore-sessions-pending.json', '.restore-stage-id', '.restore-publish.json', '.restore-modules.json', 'logs', 'tmp', 'voice-cache', 'voice-rvc', 'archive-cache', '.aurabot-cache']
// 仅配置备份：媒体不进包，但保留体积很小的聊天流水和当前工作区 DSH 会话
// 旧版的截图库仍可能留在数据目录，继续排除在仅配置备份之外。
const CONFIG_ONLY_SKIP = ['imagegen', 'stickers']
const skipped = (rel) => SKIP.some((s) => rel === s || rel.startsWith(s + '/')) || rel.split('/').includes('node_modules') || rel.endsWith('.tmp') || rel === 'memory.sqlite-shm' || rel.startsWith('memory.sqlite.migrating') || rel.startsWith('.restore-stage-')

// 旧版生活推进的暂存可能仍在数据目录。只在导出时排除，历史归档仍可导入。
const LIFE_UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
const LEGACY_LIFE_TEMP = [
  new RegExp(`^modules-data/life-advance/state-v2\\.json(?:\\.before-restore\\.(?:seq-)?\\d+-${LIFE_UUID}\\.bak)?\\.tmp-${LIFE_UUID}$`, 'u'),
  new RegExp(`^life-advance\\.state-v2\\.stage\\.${LIFE_UUID}\\.[a-f0-9]{64}\\.[a-f0-9]{64}$`, 'u'),
  /^life-advance\.state-v2\.aborted$/u,
]

const fileId = (st) => [st.dev, st.ino, st.birthtimeNs].join(':')
// Windows 可能在重用文件名时沿用旧创建时间，移动前后只比对卷和文件编号。
const sameRenamedFile = (before, after) => before.dev === after.dev && before.ino === after.ino
const unsafePath = (rel) => new Error('不安全或已变化的备份路径：' + rel)

function dataBoundary(path) {
  const root = realpathSync.native(path)
  const info = lstatSync(root, { bigint: true })
  if (!info.isDirectory()) throw unsafePath(path)
  return { root, id: fileId(info) }
}

function checkPath(base, rel, { directory = false, create = false } = {}) {
  if (rel ? !safeName(rel) : !directory) throw unsafePath(rel)
  const root = lstatSync(base.root, { bigint: true })
  if (!root.isDirectory() || fileId(root) !== base.id || relative(base.root, realpathSync.native(base.root))) {
    throw unsafePath(rel)
  }
  const parts = rel ? rel.split('/') : []
  const target = join(base.root, ...parts)
  const ids = [base.id]
  let path = base.root
  let info = root
  for (const [index, part] of parts.entries()) {
    path = join(path, part)
    const isDir = directory || index < parts.length - 1
    info = lstatSync(path, { bigint: true, throwIfNoEntry: false })
    if (!info && create && isDir) {
      try { mkdirSync(path) } catch (error) { if (error.code !== 'EEXIST') throw error }
      info = lstatSync(path, { bigint: true })
    }
    if (!info) return { path: target, info: null, key: null }
    if (isDir ? !info.isDirectory() : !info.isFile()) throw unsafePath(rel)
    ids.push(fileId(info))
  }
  if (relative(path, realpathSync.native(path))) throw unsafePath(rel)
  return { path, info, key: ids.join('/'), parentKey: ids.slice(0, -1).join('/') }
}

async function walk(base, rel, out, skippedFiles, market = [], extraSkip = [], parentKey, prefixLength = 0) {
  const dir = checkPath(base, rel, { directory: true })
  if (!dir.info || (parentKey && dir.parentKey !== parentKey)) throw unsafePath(rel)
  const items = await readdir(dir.path, { withFileTypes: true })
  if (checkPath(base, rel, { directory: true }).key !== dir.key) throw unsafePath(rel)
  for (const item of items) {
    const path = rel ? rel + '/' + item.name : item.name
    const entryName = path.slice(prefixLength)
    if (skipped(entryName) || extraSkip.some((s) => entryName === s || entryName.startsWith(s + '/')) || item.isSymbolicLink()) continue
    try {
      if (item.isDirectory()) {
        if (/^modules\/[^/]+$/.test(entryName) && checkPath(base, path + '/' + SOURCE_FILE).info) {
          market.push(item.name)
          continue
        }
        await walk(base, path, out, skippedFiles, market, extraSkip, dir.key, prefixLength)
      } else if (item.isFile()) {
        const entry = checkPath(base, path)
        if (!entry.info || entry.parentKey !== dir.key) throw unsafePath(path)
        out.push({ rel: path, key: entry.key, id: fileId(entry.info) })
      }
    } catch {
      skippedFiles.push(entryName)
    }
  }
}

async function readBackupFile(base, entry) {
  const verify = () => {
    const actual = checkPath(base, entry.rel)
    if (actual.key !== entry.key) throw unsafePath(entry.rel)
    return actual.path
  }
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
  const file = await open(verify(), flags)
  try {
    const before = await file.stat({ bigint: true })
    if (!before.isFile() || fileId(before) !== entry.id) throw unsafePath(entry.rel)
    verify()
    if (before.size > BigInt(MAX_FILE)) throw new Error('备份文件过大')
    const data = Buffer.allocUnsafe(Number(before.size))
    let pos = 0
    while (pos < data.length) {
      const { bytesRead } = await file.read(data, pos, data.length - pos, pos)
      if (!bytesRead) throw unsafePath(entry.rel)
      pos += bytesRead
    }
    const after = await file.stat({ bigint: true })
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      throw unsafePath(entry.rel)
    }
    verify()
    return { data, mtime: before.mtime }
  } finally { await file.close() }
}

const backupsDir = () => dataDir('backups')
const stageDir = () => dataDir('.restore')
const sessionStage = () => dataDir('.restore-sessions')
const sessionMarker = () => dataDir('.restore-sessions-pending.json')
const pendingFile = () => dataDir('.restore-pending.json')
const modulesFile = () => dataDir('.restore-modules.json')
const SOURCE_FILE = '.aurabot-source.json'

/** DSH 存会话的目录名：工作区路径里的分隔符换成 -，其余特殊字符写成 ~十六进制。 */
export function sessionDirName(cwd) {
  const body = [...String(cwd).replace(/[\\/]+$/, '')].map((ch) => {
    if (/[\\/:]/.test(ch)) return '-'
    return /[A-Za-z0-9._-]/.test(ch) ? ch : '~' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
  }).join('').replace(/-{2,}/g, '-').replace(/^-+/, '')
  return `--${body.slice(0, 251)}--`
}

function safeName(name) {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return false
  return name.split('/').every((seg) => seg && seg !== '.' && seg !== '..'
    && (process.platform !== 'win32' || (!/[<>:"|?*\x00-\x1f]|[ .]$/u.test(seg)
      && !/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/iu.test(seg))))
}

const dosTime = (d) => ({ time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() })

function localHeader(entry) {
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

function centralHeader(entry) {
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
export async function createBackup({ version = '', workspaceDir = '', now = new Date(), onProgress = () => {}, captureMind = null, configOnly = false } = {}) {
  const root = dataDir()
  await mkdir(root, { recursive: true })
  const data = dataBoundary(root)
  checkPath(data, 'backups', { directory: true, create: true })
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').slice(0, 19)
  const name = `aurabot-${configOnly ? 'config' : 'backup'}-${stamp}-${randomUUID().slice(0, 8)}.zip`
  const finalRel = 'backups/' + name
  const tmpRel = finalRel + '.' + randomUUID() + '.tmp'
  const final = checkPath(data, finalRel).path
  const tmp = checkPath(data, tmpRel).path
  const market = []
  const walked = []
  const skippedFiles = []
  await walk(data, '', walked, skippedFiles, market, configOnly ? CONFIG_ONLY_SKIP : [])
  // 心智库在同一个同步临界区取完整字节，后续异步打包只读这份；目录里的快照和 WAL 不带
  const memoryFiles = new Map()
  if (typeof captureMind === 'function') {
    for (const [rel, bytes] of captureMind()) { checkPath(data, rel); memoryFiles.set(rel, bytes) }
  }
  const files = walked.filter(({ rel }) => !inMind(rel) && !LEGACY_LIFE_TEMP.some((pattern) => pattern.test(rel)))
  const queue = files.map((entry) => ({ base: data, entry, name: 'data/' + entry.rel }))
  for (const [rel, captured] of memoryFiles) queue.push({ name: 'data/' + rel, captured })
  const sessionFiles = []
  if (workspaceDir && existsSync(dshHome())) {
    const home = dataBoundary(dshHome())
    const sessionRel = 'sessions/' + sessionDirName(workspaceDir)
    if (checkPath(home, sessionRel, { directory: true }).info) {
      await walk(home, sessionRel, sessionFiles, skippedFiles, [], [], undefined, sessionRel.length + 1)
      for (const entry of sessionFiles) {
        queue.push({ base: home, entry, name: 'dsh-sessions/' + entry.rel.slice(sessionRel.length + 1) })
      }
    }
  }
  const total = queue.length
  const fh = await open(checkPath(data, tmpRel).path, 'wx', 0o600)
  let tempKey
  const entries = []
  let offset = 0
  const put = async (entryName, data, at) => {
    const method = data.length <= DEFLATE_MAX && !STORE_EXT.test(entryName) ? 8 : 0
    const body = method === 8 ? deflateRawSync(data) : data
    const { time, date } = dosTime(at)
    const entry = { name: entryName, method, time, date, crc: crc32(data), packed: body.length, size: data.length, offset }
    const head = localHeader(entry)
    if (offset + head.length + body.length > MAX_ZIP) throw new Error('数据超过 4GB，一个备份放不下')
    await fh.write(head)
    await fh.write(body)
    offset += head.length + body.length
    entries.push(entry)
  }
  try {
    const temporary = checkPath(data, tmpRel)
    if (!temporary.info || fileId(temporary.info) !== fileId(await fh.stat({ bigint: true }))) throw unsafePath(tmpRel)
    tempKey = temporary.key
    let done = 0
    let bytes = 0
    for (const { base, entry, name: entryName, captured } of queue) {
      if (captured && captured.length > MAX_FILE) throw new Error('心智数据库过大，无法完整备份')
      const contents = captured ? { data: captured, mtime: now } : await readBackupFile(base, entry).catch(() => null)
      if (contents) {
        if (bytes + contents.data.length > MAX_EXPANDED) throw new Error('备份展开大小超过限制')
        await put(entryName, contents.data, contents.mtime)
        bytes += contents.data.length
      } else {
        skippedFiles.push(entryName.slice(entryName.indexOf('/') + 1))
      }
      onProgress({ done: ++done, total })
      await new Promise((r) => setImmediate(r))
    }
    const sessions = entries.filter((entry) => entry.name.startsWith('dsh-sessions/')).length
    const manifest = { schema: SCHEMA, app: 'aurabot', version, createdAt: now.toISOString(), configOnly: Boolean(configOnly), dataDir: root, home: homedir(), workspaceDir, market, sessions, platform: process.platform, files: entries.length, bytes, skipped: skippedFiles, excluded: configOnly ? CONFIG_ONLY_SKIP : [] }
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2))
    if (manifestBytes.length > MAX_MANIFEST || bytes + manifestBytes.length > MAX_EXPANDED) {
      throw new Error('备份清单或展开大小超过限制')
    }
    await put(MANIFEST, manifestBytes, now)
    if (entries.length > 0xffff) throw new Error('文件太多，一个备份放不下')
    const directorySize = entries.reduce((sum, entry) => sum + 46 + Buffer.byteLength(entry.name), 0)
    if (directorySize > MAX_DIRECTORY || offset + directorySize + 22 > MAX_ZIP) throw new Error('备份目录或文件过大')
    const central = Buffer.concat(entries.map(centralHeader))
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(entries.length, 8)
    end.writeUInt16LE(entries.length, 10)
    end.writeUInt32LE(central.length, 12)
    end.writeUInt32LE(offset, 16)
    await fh.write(Buffer.concat([central, end]))
    await fh.close()
    if (checkPath(data, tmpRel).key !== tempKey) throw unsafePath(tmpRel)
    // 先在临时文件上验完，再原子发布；中断不会留下未经校验的正式 ZIP。
    try { await inspectBackupFile(tmp, name) }
    catch (error) { throw new Error('备份验证失败，没有发布这次文件：' + error.message) }
    checkPath(data, finalRel)
    await rename(tmp, final)
    const pruned = pruneLocalBackups()
    return { file: final, name, files: entries.length - 1, bytes, skipped: skippedFiles, market, sessions, configOnly: Boolean(configOnly), pruned }
  } catch (error) {
    await fh.close().catch(() => {})
    try {
      if (tempKey && checkPath(data, tmpRel).key === tempKey) await rm(tmp, { force: true })
    } catch { /* 文件身份改变时保留待管理员核对。 */ }
    throw error
  }
}

async function readExact(file, length, position) {
  const bytes = Buffer.allocUnsafe(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await file.read(bytes, offset, length - offset, position + offset)
    if (!bytesRead) throw new Error('备份文件读取不完整')
    offset += bytesRead
  }
  return bytes
}

/** 只支持 Aurabot 使用的单卷 ZIP32；在分配或解压前核对文件范围。 */
async function readEntries(fh, size) {
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
    if (names.has(key) || !safeName(name)
        || (name !== MANIFEST && !legacySessionMarker && (!session && (!name.startsWith('data/') || skipped(rel))))) throw unsafePath(name)
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
async function verifyEntryStreaming(fh, entry) {
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

async function readEntry(fh, entry, output) {
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

let restoreInProgress = false

async function withRestoreStage(run) {
  if (restoreInProgress) throw new Error('另一个备份正在暂存')
  restoreInProgress = true
  try { return await run() } finally { restoreInProgress = false }
}

async function openCheckedOutput(data, rel) {
  const file = await open(checkPath(data, rel).path, 'wx', 0o600)
  try {
    const opened = await file.stat({ bigint: true })
    const named = checkPath(data, rel)
    if (!opened.isFile() || opened.nlink !== 1n || !named.info || fileId(named.info) !== fileId(opened)) {
      throw unsafePath(rel)
    }
    return { file, key: named.key }
  } catch (error) {
    await file.close()
    throw error
  }
}

function verifyFile(data, entry) {
  const named = checkPath(data, entry.rel)
  if (named.key !== entry.key) throw unsafePath(entry.rel)
  return named
}

function removeChecked(data, rel, directory = false) {
  try { rmSync(checkPath(data, rel, { directory }).path, { force: true, recursive: directory }) }
  catch { /* 只清理仍在已校验目录内的暂存。 */ }
}

function publishStage(data, job) {
  const plan = [
    ['.restore', 'data', true],
    ['.restore-sessions', 'sessions', true],
    ['.restore-pending.json', 'pending.json', false],
    ['.restore-sessions-pending.json', 'sessions-marker', false],
    ['.restore-stage-id', 'stage-id', false],
  ].map(([rel, name, directory]) => ({
    rel, name, directory,
    current: checkPath(data, rel, { directory }),
    incoming: checkPath(data, job + '/' + name, { directory }),
  }))
  const journal = { job, phase: 'prepared', at: Date.now(), steps: plan.map(({ rel, name, directory, current }) => ({ rel, name, directory, hadCurrent: Boolean(current.info) })) }
  writeFileSync(checkPath(data, '.restore-publish.json').path, JSON.stringify(journal), { mode: 0o600 })
  try {
    runRestoreMoves((move) => {
      for (const { rel, name, directory, current, incoming } of plan) {
        if (current.info) move(data, { rel, key: current.key }, data, job + '/old-' + name, directory)
        if (incoming.info) move(data, { rel: job + '/' + name, key: incoming.key }, data, rel, directory)
      }
    })
    journal.phase = 'published'
    writeFileSync(checkPath(data, '.restore-publish.json').path, JSON.stringify(journal), { mode: 0o600 })
    removeChecked(data, '.restore-publish.json')
  } catch (error) {
    // 进程内 runRestoreMoves 已经回滚；清掉日志，避免下次启动重复回滚已恢复的旧目录。
    try { removeChecked(data, '.restore-publish.json') } catch {}
    throw error
  }
}

/** 启动/取消/新导入前，把上次中断的发布回滚到旧版本；已发布成功的只清理旧目录。 */
function recoverPublish(data) {
  const journalPath = checkPath(data, '.restore-publish.json')
  if (!journalPath.info) return
  let journal = null
  try { journal = JSON.parse(readFileSync(journalPath.path, 'utf8')) } catch { removeChecked(data, '.restore-publish.json'); return }
  const job = String(journal?.job || '')
  if (!job || !/^\.restore-stage-[a-f0-9-]+\.tmp$/.test(job)) { removeChecked(data, '.restore-publish.json'); return }
  if (journal.phase === 'published') {
    removeChecked(data, job, true)
    removeChecked(data, '.restore-publish.json')
    return
  }
  const stepped = []
  for (const step of [...(journal.steps || [])].reverse()) {
    const rel = String(step.rel || '')
    const name = String(step.name || '')
    if (!rel || !name) continue
    const directory = Boolean(step.directory)
    try {
      const current = checkPath(data, rel, { directory })
      const old = checkPath(data, job + '/old-' + name, { directory })
      if (current.info && old.info) {
        removeChecked(data, rel, directory)
        moveChecked(dataBoundary(dataDir()), { rel: job + '/old-' + name, key: old.key }, data, rel, directory)
        stepped.push(rel)
      } else if (!current.info && old.info) {
        moveChecked(dataBoundary(dataDir()), { rel: job + '/old-' + name, key: old.key }, data, rel, directory)
        stepped.push(rel)
      } else if (!step.hadCurrent && current.info) {
        removeChecked(data, rel, directory)
        stepped.push(rel)
      }
    } catch (error) {
      throw Object.assign(new Error('上次恢复发布中断，回滚失败：' + rel + '；' + error.message), { code: 'RESTORE_ROLLBACK_FAILED' })
    }
  }
  removeChecked(data, job, true)
  removeChecked(data, '.restore-publish.json')
}

async function stageBackup(path, received) {
  const flags = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (received ? (constants.O_NOFOLLOW ?? 0) : 0)
  const fh = await open(path, flags)
  let data
  let job
  let keepJob = false
  try {
    const opened = await fh.stat({ bigint: true })
    if (!opened.isFile() || opened.size > BigInt(MAX_ZIP)) throw new Error('不是有效的备份文件')
    if (received && fileId(verifyFile(received.data, received).info) !== fileId(opened)) throw unsafePath(received.rel)
    const entries = await readEntries(fh, Number(opened.size))
    const head = entries.find((entry) => entry.name === MANIFEST)
    if (!head) throw new Error('这不是 Aurabot 的备份文件')
    if (!entries.some((entry) => entry.name === 'data/config.json')) throw new Error('备份里没有配置文件')
    const configEntry = entries.find((entry) => entry.name === 'data/config.json')
    try { parseConfigObject((await readEntry(fh, configEntry)).toString('utf8')) } catch { throw new Error('备份里的 config.json 损坏或根节点不是对象') }
    const manifest = JSON.parse((await readEntry(fh, head)).toString('utf8'))
    if (manifest.schema !== SCHEMA || manifest.app !== 'aurabot') throw new Error('这个备份的格式认不出来，先更新插件')
    const { createdAt, version, dataDir: oldData, home, workspaceDir, platform, market = [], sessions = 0 } = manifest
    if ([oldData, home, workspaceDir].some((value) => value !== undefined && typeof value !== 'string')
        || !Array.isArray(market) || market.some((id) => typeof id !== 'string')) throw new Error('备份清单格式无效')

    await mkdir(dataDir(), { recursive: true })
    data = dataBoundary(dataDir())
    recoverPublish(data)
    job = '.restore-stage-' + randomUUID() + '.tmp'
    mkdirSync(checkPath(data, job, { directory: true }).path, { mode: 0o700 })
    const stageId = randomUUID()
    mkdirSync(checkPath(data, job + '/data', { directory: true, create: true }).path, { recursive: true })
    mkdirSync(checkPath(data, job + '/sessions', { directory: true, create: true }).path, { recursive: true })
    writeFileSync(checkPath(data, job + '/data/.restore-stage-id').path, stageId, { mode: 0o600 })
    writeFileSync(checkPath(data, job + '/sessions/.restore-stage-id').path, stageId, { mode: 0o600 })
    writeFileSync(checkPath(data, job + '/stage-id').path, stageId, { mode: 0o600 })
    let files = 0
    for (const entry of entries) {
      if (entry === head || entry.name === '.restore-sessions-pending.json' || entry.name === 'data/.restore-sessions-pending.json') continue
      const session = entry.name.startsWith('dsh-sessions/')
      const rel = job + '/' + (session ? 'sessions/' : 'data/') + entry.name.slice(session ? 13 : 5)
      checkPath(data, rel.slice(0, rel.lastIndexOf('/')), { directory: true, create: true })
      const { file, key } = await openCheckedOutput(data, rel)
      try { await readEntry(fh, entry, file) } finally { await file.close() }
      verifyFile(data, { rel, key })
      files++
    }
    const current = await fh.stat({ bigint: true })
    if (opened.size !== current.size || opened.mtimeNs !== current.mtimeNs || opened.ctimeNs !== current.ctimeNs) {
      throw new Error('备份文件在读取期间已变化')
    }
    const pending = job + '/pending.json'
    const { file, key } = await openCheckedOutput(data, pending)
    try {
      await file.writeFile(JSON.stringify({ at: Date.now(), files, createdAt, version, dataDir: oldData, home, workspaceDir, platform, market, sessions, stageId }, null, 2))
    } finally { await file.close() }
    verifyFile(data, { rel: pending, key })
    publishStage(data, job)
    return { ok: true, files, createdAt, version, platform, market, sessions, skipped: manifest.skipped || [] }
  } catch (error) {
    keepJob = error.code === 'RESTORE_ROLLBACK_FAILED'
    throw error
  } finally {
    if (job && !keepJob) removeChecked(data, job, true)
    await fh.close()
  }
}

/** 校验备份并暂存，下次启动才换上去。 */
export function stageRestore(path) {
  return withRestoreStage(() => stageBackup(path))
}

function listFiles(base, rel, out = []) {
  const dir = checkPath(base, rel, { directory: true })
  if (!dir.info) throw unsafePath(rel)
  for (const item of readdirSync(dir.path, { withFileTypes: true })) {
    const child = rel + '/' + item.name
    if (item.isDirectory()) listFiles(base, child, out)
    else {
      const file = checkPath(base, child)
      if (!file.info || file.info.nlink !== 1n) throw unsafePath(child)
      out.push({ rel: child, key: file.key })
    }
  }
  return out
}

function moveChecked(source, file, destination, rel, directory = false) {
  const parent = rel.slice(0, Math.max(0, rel.lastIndexOf('/')))
  checkPath(destination, parent, { directory: true, create: true })
  const from = checkPath(source, file.rel, { directory })
  const to = checkPath(destination, rel, { directory })
  if (from.key !== file.key || to.info) throw unsafePath(rel)
  let copied = false
  try {
    renameSync(from.path, to.path)
  } catch (error) {
    if (directory || error.code !== 'EXDEV') throw error
    if (checkPath(source, file.rel).key !== file.key || checkPath(destination, rel).info) throw unsafePath(rel)
    copyFileSync(from.path, to.path, constants.COPYFILE_EXCL)
    if (checkPath(source, file.rel).key !== file.key) throw unsafePath(file.rel)
    rmSync(from.path)
    copied = true
  }
  const moved = checkPath(destination, rel, { directory })
  if (!moved.info || (!copied && !sameRenamedFile(from.info, moved.info))) throw unsafePath(rel)
  return { rel, key: moved.key }
}

function runRestoreMoves(run) {
  const moved = []
  const move = (source, file, destination, rel, directory = false) => {
    const placed = moveChecked(source, file, destination, rel, directory)
    moved.push({ source, file, destination, placed, directory })
  }
  try {
    run(move)
  } catch (error) {
    const failed = []
    for (const step of moved.reverse()) {
      try { moveChecked(step.destination, step.placed, step.source, step.file.rel, step.directory) }
      catch { failed.push(step.file.rel) }
    }
    if (failed.length) {
      const rollback = new Error('恢复中断，无法安全回退：' + failed.join(', '), { cause: error })
      rollback.code = 'RESTORE_ROLLBACK_FAILED'
      throw rollback
    }
    throw error
  }
}

function finalConfig(data, file, info, root, workspaceDir) {
  const original = readFileSync(verifyFile(data, file).path, 'utf8').replace(/^\uFEFF/, '')
  const esc = (s) => JSON.stringify(s).slice(1, -1)
  const adjusted = info.dataDir && info.dataDir !== root ? original.replaceAll(esc(info.dataDir), esc(root)) : original
  const parsed = parseConfigObject(adjusted)
  // Restoring an archive must not restore an earlier owner's authorization revision.
  const revoked = Object.hasOwn(parsed, 'ownerAuthorization')
  if (revoked) delete parsed.ownerAuthorization
  if (workspaceDir) return JSON.stringify({ ...parsed, workspaceDir }, null, 2)
  if (revoked) return JSON.stringify(parsed, null, 2)
  return adjusted === original ? null : adjusted
}

function preparedFile(data, rel, content) {
  writeFileSync(checkPath(data, rel).path, content, { flag: 'wx', mode: 0o600 })
  return { rel, key: checkPath(data, rel).key }
}

/** 只处理上次因目标外盘离线而留下的会话暂存；不重放普通配置。 */
function resumePendingSessions() {
  const root = dataDir()
  if (!existsSync(root)) return 0
  const data = dataBoundary(root)
  const markerRel = '.restore-sessions-pending.json'
  const marker = checkPath(data, markerRel)
  if (!marker.info) return 0
  let info = null
  try { info = JSON.parse(readFileSync(marker.path, 'utf8')) } catch { return 0 }
  if (!info?.workspaceDir) return 0
  let target = String(info.workspaceDir)
  if (info.home && target.toLowerCase().startsWith(String(info.home).toLowerCase())) target = homedir() + target.slice(String(info.home).length)
  if (!existsSync(parse(target).root)) return 0
  const userHome = homedir()
  const dshRoot = dshHome()
  const underRoot = (r) => target === r || target.startsWith(r + '/')
  if (!existsSync(target) && !underRoot(userHome) && !underRoot(dshRoot)) return 0
  mkdirSync(dshRoot, { recursive: true })
  const home = dataBoundary(dshRoot)
  const directory = 'sessions/' + sessionDirName(target)
  const files = listFiles(data, '.restore-sessions').filter((file) => !file.rel.endsWith('/.restore-stage-id'))
  const sessionIdPath = checkPath(data, '.restore-sessions/.restore-stage-id')
  if (sessionIdPath.info && !info.stageId) throw new Error('旧版延期标记与新版会话暂存混用；请先取消或重新导入原 ZIP')
  if (info.stageId && sessionIdPath.info && readFileSync(sessionIdPath.path, 'utf8') !== info.stageId) throw new Error('延期会话暂存与任务标记不一致；请重新导入原 ZIP')
  if (!files.length) { removeChecked(data, markerRel); removeChecked(data, '.restore-sessions', true); return 0 }
  mkdirSync(target, { recursive: true })
  runRestoreMoves((move) => {
    for (const file of files) {
      const rel = directory + '/' + file.rel.slice('.restore-sessions/'.length)
      checkPath(home, rel)
      if (!checkPath(home, rel).info) move(data, file, home, rel)
    }
  })
  removeChecked(data, '.restore-sessions', true)
  removeChecked(data, markerRel)
  return files.length
}

/** 启动时、读配置之前应用暂存备份。 */
export function applyPendingRestore(now = Date.now()) {
  if (existsSync(dataDir())) recoverPublish(dataBoundary(dataDir()))
  const resumed = resumePendingSessions()
  if (resumed || checkPath(dataBoundary(dataDir()), '.restore-sessions-pending.json').info) return resumed
  if (restoreInProgress) throw new Error('另一个备份正在暂存')
  const root = dataDir()
  if (!existsSync(root)) return 0
  const data = dataBoundary(root)
  const pendingRel = '.restore-pending.json'
  const pending = checkPath(data, pendingRel)
  if (!pending.info) return 0
  const info = JSON.parse(readFileSync(pending.path, 'utf8'))
  const checkStage = (rel) => {
    const p = checkPath(data, rel)
    if (!p.info || !info.stageId) return
    if (readFileSync(p.path, 'utf8') !== info.stageId) throw new Error('恢复暂存来自不同备份任务，已拒绝混用；请重新导入原 ZIP')
  }
  checkStage('.restore/.restore-stage-id')
  checkStage('.restore-sessions/.restore-stage-id')
  const keep = 'backups/pre-restore-' + now
  const files = listFiles(data, '.restore').filter((file) => !file.rel.endsWith('/.restore-stage-id')).map((file) => ({ file, rel: file.rel.slice('.restore/'.length) }))
  const config = files.find(({ rel }) => rel === 'config.json')
  if (!config) throw unsafePath('config.json')
  const restoreMemory = files.some(({ rel }) => rel === 'memory.sqlite' || rel === 'memories.json')
  const restoreMind = files.some(({ rel }) => rel === MIND_DIR + '/mind.sqlite')
  const targets = new Set(files.map(({ rel }) => rel))
  if (restoreMemory) for (const rel of MEMORY_FILES) targets.add(rel)
  if (restoreMind) for (const rel of MIND_DB) targets.add(rel)
  const modulesRel = '.restore-modules.json'
  if (info.market?.length) targets.add(modulesRel)

  // 全批预检后才挪动文件，拒绝目标和留底路径中的链接及非预期文件类型。
  const originals = new Map()
  for (const rel of targets) {
    const current = checkPath(data, rel)
    if (checkPath(data, keep + '/' + rel).info) throw unsafePath(rel)
    if (current.info) originals.set(rel, { rel, key: current.key })
  }
  const sessions = planSessionRestore(data, info)
  const stagedDir = checkPath(data, '.restore-sessions', { directory: true })
  const stagedSessions = stagedDir.info ? listFiles(data, '.restore-sessions').filter((file) => !file.rel.endsWith('/.restore-stage-id')) : []
  const sessionMissing = Boolean(sessions && !sessions.target && stagedSessions.length)
  const configText = finalConfig(data, config.file, info, root, sessions?.target)
  const job = '.restore-apply-' + randomUUID() + '.tmp'
  mkdirSync(checkPath(data, job, { directory: true }).path, { mode: 0o700 })
  let keepJob = false
  try {
    if (configText !== null) config.file = preparedFile(data, job + '/config.json', configText)
    const modules = info.market?.length ? preparedFile(data, job + '/modules.json', JSON.stringify(info.market)) : null
    runRestoreMoves((move) => {
      const saveOriginal = (rel) => {
        const current = originals.get(rel)
        if (current) move(data, current, data, keep + '/' + rel)
      }
      if (restoreMemory) for (const rel of MEMORY_FILES) saveOriginal(rel)
      // 心智库整个换：旧的库连同 WAL 一起挪开留底
      if (restoreMind) for (const rel of MIND_DB) saveOriginal(rel)
      for (const { file, rel } of files) {
        if ((!restoreMemory || !MEMORY_FILES.includes(rel)) && (!restoreMind || !MIND_DB.includes(rel))) saveOriginal(rel)
        move(data, file, data, rel)
      }
      if (sessions?.target) {
        mkdirSync(sessions.target, { recursive: true })
        for (const { file, rel } of sessions.files) {
          if (!checkPath(sessions.home, rel).info) move(data, file, sessions.home, rel)
        }
      }
      if (modules) {
        saveOriginal(modulesRel)
        move(data, modules, data, modulesRel)
      }
      if (!sessionMissing) move(data, { rel: pendingRel, key: pending.key }, data, job + '/committed.json')
    })
    // 普通数据已经提交；目标工作区缺失时只保留会话暂存和独立标记，下次启动不再重放配置。
    if (sessionMissing) {
      const marker = checkPath(data, '.restore-sessions-pending.json')
      writeFileSync(marker.path, JSON.stringify({ workspaceDir: info.workspaceDir, home: info.home, stageId: info.stageId || '', at: now }), { mode: 0o600 })
      removeChecked(data, pendingRel)
    }
    if (sessions?.target || !stagedSessions.length) removeChecked(data, '.restore-sessions', true)
    removeChecked(data, '.restore', true) // 普通数据已提交；会话有独立暂存和标记
    removeChecked(data, '.restore-stage-id')
    prunePreRestore()
    return files.length
  } catch (error) {
    keepJob = error.code === 'RESTORE_ROLLBACK_FAILED'
    throw error
  } finally {
    if (!keepJob) removeChecked(data, job, true)
  }
}

/** 会话按归档工作区放回 DSH 的 sessions 目录，已有的同名会话保留。 */
function planSessionRestore(data, info) {
  if (!info.workspaceDir || !checkPath(data, '.restore-sessions', { directory: true }).info) return null
  let target = info.workspaceDir
  if (info.home && target.toLowerCase().startsWith(info.home.toLowerCase())) target = homedir() + target.slice(info.home.length)
  if (!existsSync(parse(target).root)) return { target: null }
  // 缺失的工作区只允许在用户主目录下创建，不能凭备份清单在任意路径 mkdir。
  const userHome = homedir()
  const dshRoot = dshHome()
  const underRoot = (root) => target === root || target.startsWith(root + '/')
  if (!existsSync(target) && !underRoot(userHome) && !underRoot(dshRoot)) return { target: null }
  const homeRoot = dshRoot
  mkdirSync(homeRoot, { recursive: true })
  const home = dataBoundary(homeRoot)
  const directory = 'sessions/' + sessionDirName(target)
  const files = listFiles(data, '.restore-sessions').filter((file) => !file.rel.endsWith('/.restore-stage-id')).map((file) => {
    const rel = directory + '/' + file.rel.slice('.restore-sessions/'.length)
    checkPath(home, rel)
    return { file, rel }
  })
  return { target, home, files }
}

/** 恢复后还没下载的模块库模块。 */
export function pendingModules() {
  try { return JSON.parse(readFileSync(modulesFile(), 'utf8')) } catch (error) { return [] }
}

export function setPendingModules(list) {
  if (list.length) writeFileSync(modulesFile(), JSON.stringify(list))
  else rmSync(modulesFile(), { force: true })
}

export function cancelRestore() {
  try { if (existsSync(dataDir())) recoverPublish(dataBoundary(dataDir())) } catch {}
  if (restoreInProgress) throw new Error('另一个备份正在暂存')
  rmSync(stageDir(), { recursive: true, force: true })
  rmSync(sessionStage(), { recursive: true, force: true })
  rmSync(pendingFile(), { force: true })
  rmSync(sessionMarker(), { force: true })
  rmSync(sessionStage(), { recursive: true, force: true })
  try { rmSync(join(backupsDir(), 'incoming.zip'), { force: true }) } catch {}
}

export function pendingRestore() {
  try { return JSON.parse(readFileSync(pendingFile(), 'utf8')) } catch (error) { return null }
}

/** 面板显示：外盘暂时不在时留下的待迁入会话。 */
export function pendingSessions() {
  let info = null
  try { info = JSON.parse(readFileSync(sessionMarker(), 'utf8')) } catch { return null }
  if (!info || typeof info !== 'object') return null
  const dir = checkPath(dataBoundary(dataDir()), '.restore-sessions', { directory: true })
  const files = dir.info ? listFiles(dataBoundary(dataDir()), '.restore-sessions').filter((file) => !file.rel.endsWith('/.restore-stage-id')) : []
  let target = String(info.workspaceDir || '')
  if (info.home && target.toLowerCase().startsWith(String(info.home).toLowerCase())) target = homedir() + target.slice(String(info.home).length)
  return { target, remaining: files.length, at: info.at || 0 }
}

/** 面板「继续恢复」：外盘已挂回时只迁入剩余会话。 */
export function retryPendingSessions() {
  if (restoreInProgress) throw new Error('另一个备份正在暂存')
  return resumePendingSessions()
}

/** 面板「取消等待」：只清延期会话，不动已提交的普通数据。 */
export function cancelPendingSessions() {
  if (restoreInProgress) throw new Error('另一个备份正在暂存')
  rmSync(sessionMarker(), { force: true })
  rmSync(sessionStage(), { recursive: true, force: true })
}

/** 本机备份只留最近 10 份，按修改时间从新到旧；上传中的 incoming.zip 不动。 */
export function pruneLocalBackups(keep = KEEP_BACKUPS) {
  const dir = backupsDir()
  let names = []
  try { names = readdirSync(dir).filter((n) => BACKUP_NAME_RE.test(n)) } catch { return 0 }
  const files = names.map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs, stamp: backupStamp(name) })).sort((a, b) => b.stamp.localeCompare(a.stamp) || b.at - a.at || b.name.localeCompare(a.name))
  let removed = 0
  for (const { name } of files.slice(Math.max(0, Math.max(1, Number(keep) || KEEP_BACKUPS)))) {
    try { rmSync(join(dir, name), { force: true }); removed++ } catch {}
  }
  return removed
}

/** 恢复前留底目录也只留最近 10 份，避免每次恢复都堆一份完整旧目录。 */
export function prunePreRestore(keep = KEEP_PRE_RESTORE) {
  const dir = backupsDir()
  let names = []
  try { names = readdirSync(dir).filter((n) => /^pre-restore-\d+$/.test(n)) } catch { return 0 }
  const dirs = names.map((name) => ({ name })).sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
  let removed = 0
  for (const { name } of dirs.slice(Math.max(1, Number(keep) || KEEP_PRE_RESTORE))) {
    try { rmSync(join(dir, name), { recursive: true, force: true }); removed++ } catch {}
  }
  return removed
}

/** 只读校验任意一个候选 zip；发布前用在临时文件上。 */
async function inspectBackupFile(full, label) {
  const file = String(label || full)
  const fh = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const st = await fh.stat({ bigint: true })
    if (!st.isFile() || st.size > BigInt(MAX_ZIP)) throw new Error('不是有效的备份文件')
    const entries = await readEntries(fh, Number(st.size))
    const head = entries.find((entry) => entry.name === MANIFEST)
    if (!head) throw new Error('这不是 Aurabot 的备份文件')
    if (!entries.some((entry) => entry.name === 'data/config.json')) throw new Error('备份里没有配置文件')
    const manifest = JSON.parse((await readEntry(fh, head)).toString('utf8'))
    if (manifest.schema !== SCHEMA || manifest.app !== 'aurabot') throw new Error('备份清单格式认不出来')
    const configEntry = entries.find((entry) => entry.name === 'data/config.json')
    try { parseConfigObject((await readEntry(fh, configEntry)).toString('utf8')) } catch { throw new Error('备份里的 config.json 损坏或根节点不是对象') }
    let bytes = 0
    for (const entry of entries) {
      if (entry === head) continue
      if (entry.size > 8 * 1024 * 1024) await verifyEntryStreaming(fh, entry)
      else await readEntry(fh, entry)
      bytes += entry.size
    }
    return {
      name: file,
      createdAt: manifest.createdAt || '',
      version: manifest.version || '',
      configOnly: manifest.configOnly === true,
      platform: manifest.platform || '',
      files: entries.length - 1,
      bytes,
      sessions: Number(manifest.sessions) || 0,
      market: Array.isArray(manifest.market) ? manifest.market : [],
      skipped: Array.isArray(manifest.skipped) ? manifest.skipped : [],
      verified: true,
    }
  } finally { await fh.close() }
}

/** 只读校验一份本机备份：目录、CRC、清单和可恢复文件数，不改动 .restore。 */
export async function inspectBackup(name) {
  const file = String(name || '')
  if (!BACKUP_NAME_RE.test(file)) throw new Error('备份文件名不对')
  return inspectBackupFile(join(backupsDir(), file), file)
}

export function listBackups() {
  try {
    return readdirSync(backupsDir()).filter((n) => n.endsWith('.zip') && n !== 'incoming.zip').map((name) => {
      const st = statSync(join(backupsDir(), name))
      return { name, bytes: st.size, at: st.mtimeMs, createdAt: backupStamp(name) }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.at - a.at || b.name.localeCompare(a.name))
  } catch (error) { return [] }
}

/** 上传和远端下载共用受保护的落盘及暂存流程。 */
export function stageReceivedBackup(buf, name = 'incoming.zip') {
  return withRestoreStage(async () => {
    if (!Buffer.isBuffer(buf) || !buf.length || buf.length > MAX_ZIP) throw new Error('备份文件大小无效')
    if (name !== 'incoming.zip' && !BACKUP_NAME_RE.test(name)) {
      throw new Error('备份文件名不对')
    }
    await mkdir(dataDir(), { recursive: true })
    const data = dataBoundary(dataDir())
    checkPath(data, 'backups', { directory: true, create: true })
    const rel = 'backups/' + name
    const target = checkPath(data, rel)
    const temporary = 'backups/.receive-' + randomUUID() + '.tmp'
    const { file, key } = await openCheckedOutput(data, temporary)
    try {
      try {
        await file.writeFile(buf)
        await file.sync()
      } finally { await file.close() }
      const source = verifyFile(data, { rel: temporary, key })
      if (checkPath(data, rel).key !== target.key) throw unsafePath(rel)
      // 同名不同内容不覆盖已有备份：先把新包留在私有临时文件里，确认没有占用再提交。
      if (target.info) {
        if (name !== 'incoming.zip') {
          // WebDAV 取消后重试：字节完全一致时复用已存在的归档，不再覆盖。
          let same = false
          try { same = readFileSync(target.path).equals(buf) } catch {}
          if (!same) throw new Error('已经有同名备份，不会覆盖：' + name)
          const existing = verifyFile(data, { rel, key: target.key })
          const staged = await stageBackup(existing.path, { data, rel, key: existing.key })
          pruneLocalBackups()
          return staged
        }
        removeChecked(data, rel) // incoming.zip 是本次上传缓存，允许用新包替换；用户命名的备份不覆盖
      }
      renameSync(source.path, target.path)
      const published = checkPath(data, rel)
      if (!published.info || !sameRenamedFile(source.info, published.info)) throw unsafePath(rel)
      try {
        const staged = await stageBackup(published.path, { data, rel, key: published.key })
        pruneLocalBackups()
        return staged
      } catch (error) {
        // 校验失败的上传包不要留在 backups/ 里反复被列表/清理看到。
        try { if (checkPath(data, rel).key === published.key) removeChecked(data, rel) } catch {}
        throw error
      }
    } finally {
      try {
        if (checkPath(data, temporary).key === key) removeChecked(data, temporary)
      } catch { /* 身份变化时保留供核对。 */ }
    }
  })
}
