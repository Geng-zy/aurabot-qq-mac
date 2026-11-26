// 云备份的 WebDAV 后端：设置校验、建文件夹、列目录、下载、上传。
//
// 从 core/backup-push.js 拆出来：Gitee（git）那条链和 WebDAV 只是共用「打码/保留计划/文件名规则」，
// 互相之间没有调用关系，混在一个 469 行的文件里只能靠注释分界。

import { readFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './store.js'
import { BACKUP_ZIP_RE, pushHooks, redact, validateCandidate } from './backup-shared.js'

function webdavSettings(r) {
  const w = r.webdav || {}
  const raw = String(w.url || '').trim()
  if (!raw) throw new Error('先在面板填 WebDAV 服务器地址（例如 https://dav.jianguoyun.com/dav/）')
  let u
  try { u = new URL(raw) } catch { throw new Error('WebDAV 地址格式不对，要填完整的 http(s) 地址') }
  if (!/^https?:$/.test(u.protocol)) throw new Error('WebDAV 地址必须以 http:// 或 https:// 开头')
  if (u.username || u.password) throw new Error('WebDAV 地址里不要写用户名密码，填到下面的两栏里')
  if (u.search || u.hash) throw new Error('WebDAV 地址只填服务器地址，不要带 ? 或 #')
  const username = String(w.username || '').trim()
  const password = String(w.password || '')
  if (!username || !password) throw new Error('先在面板填 WebDAV 用户名和密码/应用授权码')
  let base = raw.replace(/\/+$/, '')
  // 坚果云 WebDAV 的根是 /dav/；填成 https://dav.jianguoyun.com/ 时自动补上，避免 MKCOL 410
  if (u.hostname.toLowerCase() === 'dav.jianguoyun.com' && (u.pathname === '/' || u.pathname === '')) base += '/dav'
  // 兼容以前填到 aurabot-backups 的写法；否则在服务器根下自动建这个固定文件夹
  const folder = /\/aurabot-backups$/i.test(new URL(base).pathname) ? base + '/' : base + '/aurabot-backups/'
  return { base, folder, username, password, auth: 'Basic ' + Buffer.from(username + ':' + password).toString('base64') }
}

async function ensureWebdavFolder(r) {
  const s = webdavSettings(r)
  const res = await webdavFetch(s.folder, { method: 'MKCOL', headers: { authorization: s.auth }, timeout: 15000, password: s.password })
  // 201 = 新建成功；405 = 已存在；200 = 有些服务端直接返回成功
  if (res.ok || res.status === 405) return s
  if (res.status === 401 || res.status === 403) throw new Error('WebDAV 用户名或密码/应用授权码不对（HTTP ' + res.status + '）')
  if (res.status === 409) throw new Error('WebDAV 服务器地址不对：父目录不存在，检查地址是否填到了正确的云盘根目录')
  if (res.status === 410) throw new Error('WebDAV 服务器地址不对（HTTP 410）：坚果云要填 https://dav.jianguoyun.com/dav/，不是只填域名根目录')
  throw new Error('WebDAV 自动创建 aurabot-backups 文件夹失败（HTTP ' + res.status + '）：检查账号有没有写权限')
}

async function webdavFetch(url, { method = 'GET', headers = {}, body, timeout = 15000, password = '' } = {}) {
  const doFetch = pushHooks.fetch || fetch
  try {
    return await doFetch(url, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(timeout) })
  } catch (error) {
    throw new Error(redact('WebDAV 连不上：' + (error?.message || error), password))
  }
}

async function webdavList(folder, auth, password) {
  const res = await webdavFetch(folder, {
    method: 'PROPFIND',
    headers: { authorization: auth, depth: '1', 'content-type': 'application/xml; charset=utf-8' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>',
    timeout: 15000,
    password,
  })
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('WebDAV 用户名或密码/应用授权码不对（HTTP ' + res.status + '）')
    if (res.status === 404) throw new Error('WebDAV 上找不到 aurabot-backups 文件夹，检查服务器地址或权限')
    throw new Error('WebDAV 列目录失败（HTTP ' + res.status + '）')
  }
  let text = ''
  try { text = await res.text() } catch { return [] }
  const names = new Set()
  for (const m of text.matchAll(/<(?:[A-Za-z0-9_-]+:)?href[^>]*>([^<]+)</gi)) {
    let href = m[1].replace(/&amp;/g, '&')
    try { href = decodeURIComponent(href) } catch { /* 保留原样 */ }
    const name = href.split('/').filter(Boolean).pop() || ''
    if (BACKUP_ZIP_RE.test(name)) names.add(name)
  }
  return [...names]
}

/** 面板「从 WebDAV 恢复」：列出远端备份文件名。 */
export async function listWebdavBackups(r) {
  const s = await ensureWebdavFolder(r)
  const names = await webdavList(s.folder, s.auth, s.password)
  return { ok: true, files: names.sort().reverse() }
}

/** 面板「从 WebDAV 恢复」：下载指定 zip 到内存。 */
export async function downloadWebdavBackup(r, name) {
  const file = String(name || '')
  if (!BACKUP_ZIP_RE.test(file)) throw new Error('备份文件名不对')
  const s = await ensureWebdavFolder(r)
  const res = await webdavFetch(s.folder + encodeURIComponent(file), {
    headers: { authorization: s.auth },
    timeout: 30 * 60 * 1000,
    password: s.password,
  })
  if (!res.ok) throw new Error('WebDAV 下载失败（HTTP ' + res.status + '）：检查文件是否还在、账号有没有读权限')
  let buf
  try { buf = Buffer.from(await res.arrayBuffer()) } catch (error) { throw new Error('WebDAV 下载内容读不出来：' + redact(error.message, s.password)) }
  if (!buf.length) throw new Error('WebDAV 下载到的文件是空的')
  return { name: file, buffer: buf }
}

export async function pushBackupWebdav(r, { onLog = () => {}, sourceName = '' } = {}) {
  const { folder, password, auth } = await ensureWebdavFolder(r)
  const dir = join(dataDir('backups'))
  const all = existsSync(dir) ? readdirSync(dir).filter((n) => BACKUP_ZIP_RE.test(n)).sort().reverse() : []
  let name = String(sourceName || '')
  if (name) {
    if (!BACKUP_ZIP_RE.test(name)) throw new Error('要上传的备份文件名不对')
    if (!all.includes(name)) throw new Error('本机 backups 里找不到要上传的备份：' + name)
  } else {
    const re = r.webdav?.configOnly === true ? /^aurabot-config-/ : /^aurabot-backup-/
    name = all.find((n) => re.test(n)) || ''
  }
  if (!name) throw new Error('还没有备份文件：先「立即备份」一次，或等每天到点自动打包')
  await validateCandidate(name)
  const full = join(dir, name)
  let buf
  try { buf = await readFile(full) } catch (error) { throw new Error('读不了最新备份文件：' + redact(error.message, password)) }
  onLog({ out: `上传 ${name}（${Math.round(buf.length / 1024)} KB）到 WebDAV…` })
  const put = await webdavFetch(folder + encodeURIComponent(name), {
    method: 'PUT',
    headers: { authorization: auth, 'content-type': 'application/zip' },
    body: buf,
    timeout: 30 * 60 * 1000,
    password,
  })
  if (!put.ok) throw new Error('WebDAV 上传失败（HTTP ' + put.status + '）：检查地址是不是文件夹、账号有没有写权限')
  let dropped = 0
  let kept = 1
  let warning = ''
  try {
    const remote = await webdavList(folder, auth, password)
    const keep = Math.max(1, Math.round(Number(r.keep) || 10))
    const prefix = name.startsWith('aurabot-config-') ? 'aurabot-config-' : 'aurabot-backup-'
    const sorted = [...new Set([name, ...remote.filter((n) => n.startsWith(prefix))])].sort().reverse()
    // 刚上传的这份一定保留，其余按文件名从新到旧补足 keep，再删不在集合里的。
    const keepSet = new Set([name])
    for (const n of sorted) { if (keepSet.size >= keep) break; keepSet.add(n) }
    kept = keepSet.size
    const old = sorted.filter((n) => !keepSet.has(n))
    for (const oldName of old) {
      const del = await webdavFetch(folder + encodeURIComponent(oldName), {
        method: 'DELETE', headers: { authorization: auth }, timeout: 15000, password,
      })
      if (del.ok) dropped++
      else warning = '上传成功，但旧备份 ' + oldName + ' 没删掉（HTTP ' + del.status + '）'
    }
  } catch (error) {
    warning = '上传成功，但清理旧备份失败：' + redact(error.message, password)
  }
  const keep = Math.max(1, Math.round(Number(r.keep) || 10))
  return {
    ok: true,
    name,
    folder,
    parts: 1,
    kept,
    dropped,
    message: `已上传 ${name} 到 WebDAV（远端保留最近 ${keep} 份${dropped ? '，清了 ' + dropped + ' 份旧的' : ''}）${warning ? '；' + warning : ''}`,
  }
}
