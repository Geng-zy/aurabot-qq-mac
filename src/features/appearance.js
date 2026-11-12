// 她的形象：主人导入的几张参考图（她长什么样），以后她画自己（自拍、她的样子、合照里有她）时照着画。
// 图存在 dir 里，删掉的移到废纸篓；另存一份文字描述（看图写的或主人自己写的），
// 生图服务不支持参考图、或者这次还有别的参考图时，靠这段文字让她画得像自己。

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { mimeOf } from '../core/image-info.js'

export const MAX_APPEARANCE = 8
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
const NAME_RE = /^look-[0-9a-f]{12}\.(png|jpg|webp|gif)$/

/**
 * @param {{ dir: string, trashDir: string, shrink?: (buf: Buffer) => Promise<Buffer>, now?: () => number }} o
 */
export function createAppearance({ dir, trashDir, shrink = async (b) => b, now = Date.now }) {
  const metaFile = () => join(dir, 'appearance.json')
  const meta = () => {
    try { const m = JSON.parse(readFileSync(metaFile(), 'utf8')); return m && typeof m === 'object' ? m : {} } catch { return {} }
  }
  const saveMeta = (m) => { mkdirSync(dir, { recursive: true }); writeFileSync(metaFile(), JSON.stringify(m, null, 2)) }

  /** 现在有哪些（主图排第一，其余按导入先后）。 */
  function list() {
    if (!existsSync(dir)) return []
    const m = meta()
    const files = readdirSync(dir).filter((f) => NAME_RE.test(f))
      .map((f) => ({ file: f, at: m.added?.[f] || statSync(join(dir, f)).mtimeMs, bytes: statSync(join(dir, f)).size }))
      .sort((a, b) => a.at - b.at)
    const primary = files.find((f) => f.file === m.primary) ? m.primary : files[0]?.file || ''
    return files.map((f) => ({ ...f, primary: f.file === primary })).sort((a, b) => Number(b.primary) - Number(a.primary) || a.at - b.at)
  }

  /** 导入一张（同一张图不重复存；最多 MAX_APPEARANCE 张）。 */
  async function add(buf) {
    if (!Buffer.isBuffer(buf) || !buf.length) throw new Error('是空的')
    const type = String(mimeOf(buf))
    if (!EXT[type]) throw new Error('只认 PNG、JPG、WebP、GIF 图片')
    if (list().length >= MAX_APPEARANCE) throw new Error(`最多 ${MAX_APPEARANCE} 张，先删掉几张`)
    let out = buf
    try { out = (await shrink(buf)) || buf } catch {}
    const t = String(mimeOf(out))
    const name = `look-${createHash('sha256').update(buf).digest('hex').slice(0, 12)}.${EXT[t] || EXT[type]}`
    if (list().some((f) => f.file === name)) return { ok: true, file: name, duplicate: true }
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name), out)
    const m = meta()
    m.added = { ...(m.added || {}), [name]: now() }
    if (!m.primary) m.primary = name
    saveMeta(m)
    return { ok: true, file: name }
  }

  /** 删一张：移到废纸篓，不直接删。 */
  function remove(file) {
    if (!NAME_RE.test(String(file)) || !existsSync(join(dir, file))) return { ok: false, message: '没有这张' }
    mkdirSync(trashDir, { recursive: true })
    renameSync(join(dir, file), join(trashDir, `aurabot-appearance-${now()}-${file}`))
    const m = meta()
    if (m.added) delete m.added[file]
    if (m.primary === file) m.primary = ''
    saveMeta(m)
    return { ok: true, message: '移到废纸篓了' }
  }

  /** 设成主图（只能交一张参考图的生图服务用它）。 */
  function setPrimary(file) {
    if (!list().some((f) => f.file === file)) return { ok: false, message: '没有这张' }
    saveMeta({ ...meta(), primary: file })
    return { ok: true }
  }

  /** 读一张的字节（面板预览用）；名字不对返回 null。 */
  function read(file) {
    if (!NAME_RE.test(String(file)) || !existsSync(join(dir, file))) return null
    return readFileSync(join(dir, file))
  }

  /** 生图要用的参考图：主图在前，最多 n 张。 */
  function buffers(n = MAX_APPEARANCE) {
    return list().slice(0, n).map((f) => readFileSync(join(dir, f.file)))
  }

  /** 文字描述（看图写的或主人自己写的）。 */
  const description = () => String(meta().description || '')
  function setDescription(text, by = 'owner') {
    saveMeta({ ...meta(), description: String(text || '').trim().slice(0, 1200), describedBy: by, describedAt: now() })
    return { ok: true }
  }

  return { list, add, remove, setPrimary, read, buffers, description, setDescription, dir }
}

/** 让看得懂图的模型看这几张，写一段画画用的外貌描述。 */
export const DESCRIBE_SYSTEM = '下面几张图都是同一个角色（她）。写一段用来画她的外貌描述：发型发色、眼睛、脸型、身材、常穿的衣服和配饰、整体风格和画风。只写看得出来的、几张图里一致的特征，不写背景和姿势，不编。一段中文，200 字以内，只输出描述本身。'
