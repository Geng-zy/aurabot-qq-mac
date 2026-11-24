// 发文件/发图的路径与大小策略：宿主目录、面板额外目录和本机文件校验。
// 这里不碰网关，只负责把“能不能发”判断清楚。

import { existsSync, statSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve } from 'node:path'

export const FILE_TIMEOUT_MS = 120_000
export const FILE_BASE64_MAX = 30 * 1024 * 1024

export const isExternalFile = (s) => /^(https?:\/\/|base64:\/\/)/i.test(s)
export const fileLabel = (name, src) => String(name || '').trim() || basename(src.split(/[?#]/)[0]) || '文件'
export const fileRootsOf = (cfg, workspaceDirOf) => [workspaceDirOf(cfg), ...(Array.isArray(cfg?.files?.dirs) ? cfg.files.dirs : [])]
  .filter(Boolean)
  .map((d) => { try { return resolve(String(d)) } catch (error) { return '' } })
  .filter(Boolean)

export function insideRoots(file, roots) {
  let p
  try { p = resolve(file) } catch (error) { return false }
  return roots.some((root) => {
    const rel = relative(root, p)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}

/** 发文件、发图共用的一套检查：绝对路径、存在、是文件、在允许的目录里、不超过大小上限。 */
export function checkSendableFile(cfg, file, workspaceDirOf) {
  const src = String(file ?? '').trim()
  if (!src) throw new Error('要发哪个文件？')
  const external = isExternalFile(src)
  const maxBytes = Math.max(1, Number(cfg.files.maxMB) || 50) * 1024 * 1024
  let size = 0
  if (!external) {
    if (!isAbsolute(src)) throw new Error('要发本机文件得给绝对路径')
    if (!existsSync(src)) throw new Error(`找不到这个文件：${src}`)
    const st = statSync(src)
    if (!st.isFile()) throw new Error(`这不是文件：${src}`)
    size = st.size
    const roots = fileRootsOf(cfg, workspaceDirOf)
    if (roots.length && !insideRoots(src, roots)) throw new Error('这个文件不在允许发送的目录里（面板「聊天」页 → 发文件 可以加目录）')
    if (size > maxBytes) throw new Error(`文件太大（${(size / 1024 / 1024).toFixed(1)} MB），上限 ${Math.round(maxBytes / 1024 / 1024)} MB`)
  }
  return { src, external, size, maxBytes }
}
