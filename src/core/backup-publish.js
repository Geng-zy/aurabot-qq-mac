// 恢复的发布事务：把暂存好的 .restore 换上去，换失败就回滚，进程中途死掉也能在下次启动时收拾。
//
// 从 core/backup.js 拆出来的第三刀。这一段的危险点是**中途断电**：所以每次发布前先写
// .restore-publish.json 日志，成功才删；启动时先看日志决定「继续回滚」还是「只清旧目录」。
// 它只依赖路径安全层（backup-fs.js）和 node 内置，与打包、会话恢复互不牵扯。

import { readFileSync, writeFileSync } from 'node:fs'
import { checkPath, dataBoundary, moveChecked, removeChecked, runRestoreMoves } from './backup-fs.js'
import { dataDir } from './store.js'

/** 同一时间只允许一个恢复在暂存/发布。 */
let restoreInProgress = false

/** 有恢复正卡在暂存或发布中吗（给取消/重试这些入口做互斥判断）。 */
export const restoreBusy = () => restoreInProgress


export async function withRestoreStage(run) {
  if (restoreInProgress) throw new Error('另一个备份正在暂存')
  restoreInProgress = true
  try { return await run() } finally { restoreInProgress = false }
}

export function publishStage(data, job) {
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
export function recoverPublish(data) {
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

