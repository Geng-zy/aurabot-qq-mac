// 心智快照与备份文件。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function createSnapshot({ opts, mind, log, trashDir }) {
  function dailySnapshot() {
    if (opts.memoryDb) return null
    const day = mind.today()
    if (mind._store.get('snapshot.lastDay') === day) return null
    try {
      const file = mind.snapshot({ keep: mind.setting('memory.snapshotKeep') })
      mind._store.set('snapshot.lastDay', day)
      log.info('心智快照：', file)
      return file
    } catch (error) {
      log.warn('心智快照失败：', error.message)
      return null
    }
  }

  function backupFiles(prefix = 'mind/') {
    const files = new Map([[prefix + 'mind.sqlite', mind.backupBytes()]])
    // 删除账本不进 SQLite 快照；不带它，换机恢复后已删除的记忆会复活。
    const log = opts.dir && join(opts.dir, 'deletions.jsonl')
    try { if (log && existsSync(log)) files.set(prefix + 'deletions.jsonl', readFileSync(log)) } catch (error) { /* 下次备份再试 */ }
    return files
  }

  return { dailySnapshot, backupFiles }
}
