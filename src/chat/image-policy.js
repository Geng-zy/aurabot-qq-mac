// 本机图片发送边界：管理员私聊之外，只允许工作区、面板额外目录和插件数据目录。

import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { insideRoots, fileRootsOf } from './file-policy.js'

export function localImageBlocked(chatId, src, { getConfig, chatInfo, workspaceDirOf, dataDir }) {
  const cfg = getConfig()
  const info = chatInfo(chatId)
  const owner = String(cfg.platforms?.[info.platform]?.ownerQQ || cfg.ownerQQ || '')
  if (info.kind === 'private' && info.id === owner) return false
  const s = String(src ?? '').trim()
  if (!isAbsolute(s) && !/^file:/i.test(s)) return false
  try {
    return !insideRoots(/^file:/i.test(s) ? fileURLToPath(s) : s, [...fileRootsOf(cfg, workspaceDirOf), dataDir()])
  } catch { return true }
}
