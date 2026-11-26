// 备份的路径安全层：所有落盘动作都经过这里。
//
// 从 core/backup.js 拆出来的最底层：它只做一件事——「这个路径还在数据目录里、还是同一个文件」。
// 其余代码（打包、发布、回滚、会话恢复）都建在它上面，所以先把它单独拿出来，
// 让后面继续拆「发布/回滚」时不用在两个文件之间来回看边界检查。
//
// 关键约束（改动前先读）：
//   · 每个路径都要校验真实父目录（realpath）与 inode/创建时间，防止符号链接与换目录；
//   · 校验结果带 key（祖先链上的 id），后续移动/删除前要复查 key 没变。

import { constants, copyFileSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { join, relative } from 'node:path'

export const fileId = (st) => [st.dev, st.ino, st.birthtimeNs].join(':')
export const sameRenamedFile = (before, after) => before.dev === after.dev && before.ino === after.ino
export const unsafePath = (rel) => new Error('不安全或已变化的备份路径：' + rel)
export function dataBoundary(path) {
  const root = realpathSync.native(path)
  const info = lstatSync(root, { bigint: true })
  if (!info.isDirectory()) throw unsafePath(path)
  return { root, id: fileId(info) }
}
export function checkPath(base, rel, { directory = false, create = false } = {}) {
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
export function safeName(name) {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return false
  return name.split('/').every((seg) => seg && seg !== '.' && seg !== '..'
    && (process.platform !== 'win32' || (!/[<>:"|?*\x00-\x1f]|[ .]$/u.test(seg)
      && !/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/iu.test(seg))))
}
export async function openCheckedOutput(data, rel) {
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
export function verifyFile(data, entry) {
  const named = checkPath(data, entry.rel)
  if (named.key !== entry.key) throw unsafePath(entry.rel)
  return named
}
export function removeChecked(data, rel, directory = false) {
  try { rmSync(checkPath(data, rel, { directory }).path, { force: true, recursive: directory }) }
  catch { /* 只清理仍在已校验目录内的暂存。 */ }
}
export function listFiles(base, rel, out = []) {
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
export function moveChecked(source, file, destination, rel, directory = false) {
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
export function runRestoreMoves(run) {
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
