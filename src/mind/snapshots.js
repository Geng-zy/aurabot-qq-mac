// 快照与备份：存一份 mind.sqlite 到 dir/snapshots/，按保留份数把旧的移到废纸篓（不直接删）。
// 从 mind/index.js 抽出来：这一支只碰文件与 store.snapshot。

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export function createSnapshots({ store, opts, now }) {
  /** 存一份快照到 dir/snapshots/，按保留份数清理旧的（移到 trashDir，不直接删）。 */
  function snapshot({ keep = 10, trashDir } = {}) {
    if (opts.memoryDb) throw new Error('内存数据库不做快照')
    const dir = join(opts.dir, 'snapshots')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
    const target = join(dir, `mind-${stamp}.sqlite`)
    store.snapshot(target)
    const files = readdirSync(dir).filter((f) => /^mind-.*\.sqlite$/.test(f)).sort()
    const old = files.slice(0, Math.max(0, files.length - keep))
    for (const f of old) {
      if (trashDir) {
        mkdirSync(trashDir, { recursive: true })
        renameSync(join(dir, f), join(trashDir, f))
      } else {
        rmSync(join(dir, f), { force: true })
      }
    }
    // 废纸篓里的旧快照也只留 10 份，避免长期累积。
    if (trashDir && existsSync(trashDir)) {
      const trashed = readdirSync(trashDir).filter((f) => /^mind-.*\.sqlite$/.test(f)).sort()
      for (const f of trashed.slice(0, Math.max(0, trashed.length - 10))) rmSync(join(trashDir, f), { force: true })
    }
    return target
  }
  /** 给外部备份用：整个数据库的完整字节。 */
  function backupBytes() {
    return store.bytes()
  }
  /** 导出一份完整数据（同快照，放到指定位置）。 */
  function exportTo(target) {
    return store.snapshot(target)
  }


  return { snapshot, backupBytes, exportTo }
}
