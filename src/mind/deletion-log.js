// 删除记录：删了什么写进 deletions 表与 deletions.jsonl，重启后按这份记录把删除落实到库里。
// 从 mind/index.js 抽出来：这一支只碰「删除记录」本身（记忆那一侧由 memory 负责）。

import { appendFileSync, existsSync, readFileSync } from 'node:fs'

export function createDeletionLog({ store, getMemory, forgetPerson, historyOfPerson, place, log, now, deletionLog }) {
  function recordDeletion(id, kind) {
    writeDeletion(id, kind, true)
    store.prep('INSERT OR REPLACE INTO deletions (id, kind, at) VALUES (?, ?, ?)').run(String(id), String(kind), now())
  }
  function writeDeletion(id, kind, deleted) {
    if (deletionLog) appendFileSync(deletionLog, JSON.stringify({ id, kind, at: now(), deleted }) + '\n', { mode: 0o600, flush: true })
  }
  function applyDeletionLog() {
    if (!deletionLog || !existsSync(deletionLog)) return
    const last = new Map()
    for (const line of readFileSync(deletionLog, 'utf8').split('\n')) {
      if (!line) continue
      try {
        const row = JSON.parse(line)
        if (row.id && row.kind) last.set(JSON.stringify([row.kind, row.id]), row)
      } catch { log.warn('跳过一条损坏的删除日志') }
    }
    const recorded = new Set(deletions().map((row) => JSON.stringify([row.kind, row.id])))
    const pending = [...last].filter(([key, row]) => row.deleted && !recorded.has(key)).map(([, row]) => row)
    getMemory().applyDeletions(pending.filter((row) => row.kind === 'episode'))
    for (const row of last.values()) if (row.kind === 'private') getMemory().setPrivateOnly(row.id, row.deleted, { record: false })
    for (const row of last.values()) if (row.kind === 'share-revoked') getMemory().revokeShare(row.id, { record: false })
    for (const row of pending.filter((item) => item.kind === 'person')) {
      const windows = [...new Set(historyOfPerson(row.id).filter((window) => place(window).kind === 'private'))]
      forgetPerson(row.id, { windows })
    }
  }
  function historyOfPerson(id) {
    return store.prep('SELECT DISTINCT window FROM perception WHERE who = ?').all(id).map((row) => row.window)
  }
  function deletions() {
    return store.prep('SELECT id, kind, at FROM deletions').all()
  }

  return { recordDeletion, writeDeletion, applyDeletionLog, deletions }
}
