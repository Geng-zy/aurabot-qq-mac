// 心智快照与备份文件。
export function createSnapshot({ opts, mind, log, trashDir }) {
  function dailySnapshot() {
    if (opts.memoryDb) return null
    const day = mind.today()
    if (mind._store.get('snapshot.lastDay') === day) return null
    try {
      const file = mind.snapshot({ keep: mind.setting('memory.snapshotKeep'), trashDir })
      mind._store.set('snapshot.lastDay', day)
      log.info('心智快照：', file)
      return file
    } catch (error) {
      log.warn('心智快照失败：', error.message)
      return null
    }
  }

  function backupFiles(prefix = 'mind/') {
    return new Map([[prefix + 'mind.sqlite', mind.backupBytes()]])
  }

  return { dailySnapshot, backupFiles }
}
