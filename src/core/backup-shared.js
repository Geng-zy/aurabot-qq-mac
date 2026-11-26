// 云备份里「多个后端都要用」的东西：测试钩子、令牌打码、保留计划、文件名规则。
//
// 从 core/backup-push.js 拆出来的第一块：WebDAV 与 Gitee 两条推送链都要用这些，
// 放在这里两边都 import，不用让别人从 push 里反向拿。

import { inspectBackup } from './backup.js'

export const GIT_TIMEOUT = 30 * 60 * 1000 // 推大包给足半小时，别让慢网把备份推一半掐死
export const SPLIT_MAX_DEFAULT = 95 * 1024 * 1024 // Gitee 服务端单文件拒收 100MB，分卷留点余量
export const MARKER = '.aurabot-backup-marker' // 备份仓标记：中转目录与远端仓库根都有它
/** owner/repo 白名单：Gitee 本来就只允许这些字符，这里收紧掉 @ : / ? # 空格等能改 URL 语义的字符。 */
export const NAME_RE = /^[A-Za-z0-9_.-]+$/
/** 分支白名单：再拒掉 .. 与 - 开头，防 refspec/选项注入。 */
export const BRANCH_RE = /^[A-Za-z0-9._/-]+$/
/** 云备份 zip：完整备份与仅配置备份（WebDAV 可只传后者）。 */
export const BACKUP_ZIP_RE = /^aurabot-(?:backup|config)-\d{8}-\d{4,6}(?:-\d{1,3})?(?:-[a-z0-9]{6,})?\.zip$/u

export async function validateCandidate(name) {
  // 测试用假 git / 假 HTTP 时不会真的碰归档；真实推送必须验证。
  if (pushHooks.spawn || pushHooks.fetch) return { verified: true }
  const info = await inspectBackup(name)
  if (!info.verified) throw new Error('备份未通过可恢复性校验：' + name)
  return info
}

// 测试钩子：测试注入假 spawn / fetch，不打真网络不真跑 git（对齐测试钩子模式）；splitMax 调小测分卷
export const pushHooks = { spawn: null, fetch: null, splitMax: null }

/** 输出里的令牌换成 ***，别把凭证写进日志和面板。 */
export function redact(text, token) {
  const s = String(text ?? '')
  if (!token) return s
  return s.split(token).join('***')
}

/** 保留 N 份的淘汰计划：输入归档根下的文件夹名（一份备份一个文件夹），倒序留前 N 个。纯函数方便测试。 */
export function prunePlan(dirs, keep, preferred = '') {
  const stamp = (d) => { const m = /-(\d{8})-(\d{4,6})(?:-(\d{1,3}))?/.exec(d); return m ? m[1] + m[2].padEnd(6, '0') + String(m[3] || 0).padStart(3, '0') : '' }
  const valid = dirs.filter((d) => /^aurabot-(?:backup|config)-\d{8}-\d{4,6}(?:-\d{1,3})?(?:-[a-z0-9]{6,})?$/.test(d)).sort((a, b) => stamp(b).localeCompare(stamp(a)) || b.localeCompare(a))
  const n = Math.min(365, Math.max(1, Number(keep) || 10))
  // 显式推送的旧包也要计入最终保留集合，不能先被淘汰再写回导致多一份。
  const keepSet = new Set(valid.includes(preferred) ? [preferred] : [])
  for (const d of valid) { if (keepSet.size >= n) break; keepSet.add(d) }
  return { keep: valid.filter((d) => keepSet.has(d)), drop: valid.filter((d) => !keepSet.has(d)) }
}
