// 本机备份恢复路由：只负责 HTTP 编排，实际归档/暂存/延期状态仍在 core/backup.js。
// 云备份路由留在 host.js（它和定时器、推送任务状态耦合）。

export function registerBackupRestoreRoutes({
  route, backupAction, readBody, readRaw, query, dataDir, openFolder, log,
  getConfig, version, workspaceDirOf, captureMind,
  getJob, setJob,
  listBackups, pendingRestore, pendingSessions, pendingModules,
  inspectBackup, createBackup, stageReceivedBackup, stageRestore,
  cancelRestore, retryPendingSessions, cancelPendingSessions,
}) {
  route('/backup/state', async () => ({
    ok: true,
    job: getJob(),
    list: listBackups(),
    pending: pendingRestore(),
    deferredSessions: pendingSessions(),
    modules: pendingModules(),
    dir: dataDir('backups'),
  }))

  route('/backup/verify', async (req) => {
    try {
      const body = await readBody(req).catch(() => ({}))
      return { ok: true, ...(await inspectBackup(String(body?.name || query(req).name || ''))) }
    } catch (error) { return { ok: false, message: error.message } }
  })

  route('/backup/create', backupAction(async () => {
    if (getJob()?.running) return { ok: false, message: '上一个备份还在打包' }
    setJob({ running: true, done: 0, total: 0 })
    createBackup({
      version,
      workspaceDir: workspaceDirOf(getConfig()),
      captureMind: captureMind(),
      onProgress: (p) => setJob({ ...getJob(), ...p }),
    })
      .then((result) => { setJob({ running: false, result }); log.info(`备份完成：${result.name}，${result.files} 个文件`) })
      .catch((error) => { setJob({ running: false, error: error.message }); log.error('备份失败：', error.message) })
    return { ok: true, message: '开始打包了' }
  }))

  route('/backup/open', backupAction(async () => openFolder(dataDir('backups'))))

  route('/backup/upload', backupAction(async (req) => {
    const buf = await readRaw(req, 2 * 1024 * 1024 * 1024 - 1)
    if (!buf.length) return { ok: false, message: '文件是空的' }
    try { return await stageReceivedBackup(buf) } catch (error) { return { ok: false, message: error.message } }
  }))

  route('/backup/restore-path', backupAction(async (req) => {
    const path = String((await readBody(req)).path || '').trim().replace(/^"|"$/g, '')
    if (!path) return { ok: false, message: '填备份文件的完整路径' }
    try { return await stageRestore(path) } catch (error) { return { ok: false, message: error.message } }
  }))

  route('/backup/cancel', backupAction(async () => {
    try { cancelRestore(); return { ok: true, message: '取消了' } } catch (error) { return { ok: false, message: error.message } }
  }))

  route('/backup/sessions/retry', backupAction(async () => {
    try {
      const n = retryPendingSessions()
      return n ? { ok: true, files: n, message: `补回了 ${n} 个会话` } : { ok: false, message: '工作区还没挂回，或者没有待迁入的会话' }
    } catch (error) { return { ok: false, message: error.message } }
  }))

  route('/backup/sessions/cancel', backupAction(async () => {
    try { cancelPendingSessions(); return { ok: true, message: '取消了等待中的会话恢复' } } catch (error) { return { ok: false, message: error.message } }
  }))
}
