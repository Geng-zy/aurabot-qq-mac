// 通用知识库：data/knowledge/raw 与 notes 下的 Markdown/文本，按当前会话提供检索和阅读。
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { dataDir } from '../core/store.js'

const TEXT_EXT = new Set(['.md', '.txt'])
const MAX_FILE = 2 * 1024 * 1024

function root() { return dataDir('knowledge') }
function rawDir() { return join(root(), 'raw') }
function notesDir() { return join(root(), 'notes') }
function ensure() { mkdirSync(rawDir(), { recursive: true }); mkdirSync(notesDir(), { recursive: true }) }

function files(dir, out = [], depth = 0) {
  if (depth > 6) return out
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) files(full, out, depth + 1)
    else if (e.isFile() && TEXT_EXT.has(extname(e.name).toLowerCase())) out.push(full)
  }
  return out
}

function snippet(text, q, max = 240) {
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1
  const start = Math.max(0, at < 0 ? 0 : at - 80)
  return text.slice(start, start + max).replace(/\s+/g, ' ').trim()
}

function safePath(rel) {
  const name = String(rel || '').trim()
  if (!name || name.includes('\0') || name.includes('..') || name.startsWith('/') || name.startsWith('\\')) return null
  const full = resolve(root(), name)
  if (!full.startsWith(root() + sep)) return null
  return full
}

function declaredScope(text) {
  const m = /^---\s*\n([\s\S]*?)\n---/u.exec(String(text || ''))
  if (!m) return ''
  const line = m[1].split(/\r?\n/).find((x) => /^\s*(scope|visibility)\s*:/i.test(x))
  return line ? line.replace(/^\s*(scope|visibility)\s*:\s*/i, '').trim().replace(/^['"]|['"]$/g, '') : ''
}
function scopeOf(text) {
  return declaredScope(text) || 'all'
}
function scopeAllows(scope, chatId) {
  if (!scope || scope === 'all') return true
  const id = String(chatId || '')
  if (scope === id) return true
  if (scope === 'private') return /:private:/i.test(id)
  if (scope === 'group') return /:group:/i.test(id)
  return false
}

export function createKnowledge() {
  ensure()
  function search(query, { limit = 5, offset = 0, chatId = '', admin = false } = {}) {
    const q = String(query || '').trim()
    if (!q) return []
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return files(rawDir()).concat(files(notesDir())).map((file) => {
      let text = ''
      try { if (statSync(file).size > MAX_FILE) return null; text = readFileSync(file, 'utf8') } catch { return null }
      if (!admin && !scopeAllows(scopeOf(text), chatId)) return null
      const hay = (basename(file) + '\n' + text).toLowerCase()
      const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0)
      if (!score) return null
      return { path: relative(root(), file), title: basename(file, extname(file)), score, snippet: snippet(text, q) }
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(Math.max(0, Number(offset) || 0), Math.max(0, Number(offset) || 0) + Math.max(1, Math.min(50, Number(limit) || 5)))
  }

  function read(rel, { offset = 0, limit = 12000, chatId = '', admin = false } = {}) {
    const full = safePath(rel)
    if (!full || !existsSync(full)) return null
    try {
      if (!statSync(full).isFile() || statSync(full).size > MAX_FILE) return null
      const text = readFileSync(full, 'utf8')
      if (!admin && !scopeAllows(scopeOf(text), chatId)) return null
      const start = Math.max(0, Math.min(text.length, Number(offset) || 0))
      const len = Math.max(1, Math.min(30000, Number(limit) || 12000))
      return { path: rel, text: text.slice(start, start + len), total: text.length, truncated: start + len < text.length }
    } catch { return null }
  }

  function createNote(title, content, { scope = 'all', folder = '' } = {}) {
    const name = String(title || '').trim().replace(/[\\/:*?"<>|\0]/g, '-').slice(0, 60) || 'note'
    const body = String(content || '').trim()
    if (!body) return { ok: false, message: '笔记内容不能为空' }
    const declared = declaredScope(body)
    const sc = String(declared || scope || 'all').trim()
    if (!sc) return { ok: false, message: '导入文件的 scope 为空，请明确指定可见范围' }
    if (!/^(all|private|group|[a-z0-9_-]+:(?:private|group):[a-z0-9_-]+)$/i.test(sc)) return { ok: false, message: 'scope 要写 all、private、group 或 渠道:private/group:id' }
    const parts = String(folder || '').split('/').map((x) => x.trim().replace(/[\\:*?"<>|\0]/g, '-')).filter((x) => x && x !== '.' && x !== '..').slice(0, 6)
    ensure()
    const dir = parts.length ? join(notesDir(), ...parts) : notesDir()
    mkdirSync(dir, { recursive: true })
    let file = join(dir, name + '.md')
    for (let n = 2; existsSync(file); n++) file = join(dir, `${name}-${n}.md`)
    const text = `---\nscope: ${sc}\n---\n\n${body}${body.endsWith('\n') ? '' : '\n'}`
    if (Buffer.byteLength(text) > MAX_FILE) return { ok: false, message: '笔记超过 2MB，没有写入' }
    writeFileSync(file, text, 'utf8')
    return { ok: true, path: relative(root(), file), message: `已写入 ${relative(root(), file)}` }
  }

  function list() {
    return files(rawDir()).concat(files(notesDir())).map((file) => {
      let text = ''
      try { if (statSync(file).size > MAX_FILE) return null; text = readFileSync(file, 'utf8') } catch { return null }
      return { path: relative(root(), file), title: basename(file, extname(file)), scope: scopeOf(text), bytes: Buffer.byteLength(text) }
    }).filter(Boolean).sort((a, b) => a.path.localeCompare(b.path))
  }

  function rename(rel, title) {
    const full = safePath(rel)
    if (!full || !existsSync(full) || !statSync(full).isFile()) return { ok: false, message: '找不到这个知识库文件' }
    const name = String(title || '').trim().replace(/[\\/:*?"<>|\0]/g, '-').slice(0, 80)
    if (!name) return { ok: false, message: '新文件名不能为空' }
    const ext = extname(full) || '.md'
    const target = join(dirname(full), name.replace(/\.(md|txt)$/i, '') + ext)
    if (target === full) return { ok: true, path: rel }
    if (existsSync(target)) return { ok: false, message: '已经有同名文件了' }
    try { renameSync(full, target); return { ok: true, path: relative(root(), target) } } catch (error) { return { ok: false, message: error.message } }
  }

  function remove(rel) {
    const full = safePath(rel)
    if (!full || !existsSync(full) || !statSync(full).isFile()) return { ok: false, message: '找不到这个知识库文件' }
    try { unlinkSync(full); return { ok: true, path: rel } } catch (error) { return { ok: false, message: error.message } }
  }

  function setScope(rel, scope) {
    const full = safePath(rel)
    if (!full || !existsSync(full) || !statSync(full).isFile()) return { ok: false, message: '找不到这个知识库文件' }
    const sc = String(scope || 'all').trim()
    if (!/^(all|private|group|[a-z0-9_-]+:(?:private|group):[a-z0-9_-]+)$/i.test(sc)) return { ok: false, message: 'scope 要写 all、private、group 或 渠道:private/group:id' }
    let text = ''
    try { text = readFileSync(full, 'utf8') } catch (error) { return { ok: false, message: error.message } }
    const m = /^---\s*\n([\s\S]*?)\n---\n?/u.exec(text)
    if (m) {
      const body = m[1].split(/\r?\n/).filter((x) => !/^\s*(scope|visibility)\s*:/i.test(x))
      text = '---\n' + [...body, `scope: ${sc}`].join('\n') + '\n---\n' + text.slice(m[0].length)
    } else text = `---\nscope: ${sc}\n---\n\n` + text
    writeFileSync(full, text, 'utf8')
    return { ok: true, path: rel, scope: sc }
  }

  return { root, rawDir, notesDir, search, read, createNote, list, setScope, remove, rename }
}
