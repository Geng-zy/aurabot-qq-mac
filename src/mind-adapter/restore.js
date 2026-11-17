// 恢复备份后，把恢复前删掉的记忆在新库里再删一遍。
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export function createRestore({ opts, mind, mem, log }) {
  async function replayDeletionsAfterRestore() {
    const dir = opts.legacyDir ? join(opts.legacyDir, 'backups') : ''
    if (!dir || !existsSync(dir)) return 0
    const done = new Set(mind._store.get('restore.replayed', []))
    const found = readdirSync(dir).filter((d) => /^pre-restore-\d+$/.test(d) && !done.has(d) && existsSync(join(dir, d, 'mind', 'mind.sqlite')))
    let n = 0
    for (const d of found.sort((a, b) => statSync(join(dir, a)).mtimeMs - statSync(join(dir, b)).mtimeMs)) {
      try {
        const { DatabaseSync } = await import('node:sqlite')
        const db = new DatabaseSync(join(dir, d, 'mind', 'mind.sqlite'), { readOnly: true })
        try {
          n += mem.applyDeletions(db.prepare('SELECT id, kind, at FROM deletions').all())
        } finally {
          db.close()
        }
        done.add(d)
      } catch (error) {
        log.warn('恢复后重放删除失败：', error.message)
      }
    }
    mind._store.set('restore.replayed', [...done])
    if (n) log.info(`恢复备份后，把之前删掉的 ${n} 条记忆再删了一遍`)
    return n
  }
  return { replayDeletionsAfterRestore }
}
