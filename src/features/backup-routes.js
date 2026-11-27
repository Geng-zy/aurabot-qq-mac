// 备份路由（本机 + 云）：只负责 HTTP 编排，归档/暂存/延期/推送状态都在 core 与 host 的调度器里。
//
// 依赖只有两块领域对象：
//   backup = { getJob, setJob, listBackups, pendingRestore, pendingSessions, pendingModules,
//              inspectBackup, createBackup, stageReceivedBackup, stageRestore,
//              cancelRestore, retryPendingSessions, cancelPendingSessions }
//   remote = { getPushJob, nextAt, doPush, cancelPush, listWebdavBackups, downloadWebdavBackup }
// 以前是 19 个平铺参数（host.js 那段依赖清单 36 行），加一个端点就要在两处各加一行。
// 合并的另一个原因：两套路由共用 backupAction / readBody / getConfig，拆成两个文件时这些要各传一遍。

const BACKUP_ZIP_RE = /^aurabot-(?:backup|config)-\d{8}-\d{4,6}(?:-\d{1,3})?(?:-[a-z0-9]{6,})?\.zip$/u

/** 面板看到的云备份设置（令牌/密码只回「有没有」，不回内容）。 */
export function remoteView(r = {}) {
  return {
    enabled: !!r.enabled,
    provider: r.provider === 'webdav' ? 'webdav' : 'gitee',
    owner: r.owner,
    repo: r.repo,
    branch: r.branch,
    time: r.time,
    keep: r.keep,
    autoCreate: r.autoCreate !== false,
    forceOverwrite: !!r.forceOverwrite,
    hasToken: Boolean(r.token),
    webdav: {
      url: r.webdav?.url || '',
      username: r.webdav?.username || '',
      hasPassword: Boolean(r.webdav?.password),
      configOnly: r.webdav?.configOnly === true,
    },
  }
}

export function registerBackupRoutes({
  route, backupAction, readBody, readRaw, query, dataDir, openFolder, log,
  getConfig, setConfig, mergeFromPanel, version, workspaceDirOf, captureMind,
  backup = {}, remote = {},
}) {
  const {
    getJob, setJob, listBackups, pendingRestore, pendingSessions, pendingModules,
    inspectBackup, createBackup, stageReceivedBackup, stageRestore,
    cancelRestore, retryPendingSessions, cancelPendingSessions,
  } = backup
  const {
    getPushJob, nextAt, doPush, cancelPush = () => ({ ok: false, message: '没有在跑的推送' }),
    listWebdavBackups, downloadWebdavBackup,
  } = remote
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

  // ---------- 云备份：定时器与推送任务在 host 的调度器里，这里只读状态、触发、取消 ----------
  route('/backup/remote/state', async () => ({ ok: true, remote: remoteView(getConfig().backup?.remote || {}), job: getPushJob(), nextAt: nextAt() }))

  route('/backup/remote/config', backupAction(async (req) => {
    const patch = { ...(await readBody(req)) }
    if (!patch.token) delete patch.token // 令牌留空 = 沿用旧值
    if (patch.webdav && !patch.webdav.password) delete patch.webdav.password
    setConfig(mergeFromPanel(getConfig(), { backup: { remote: patch } }))
    const r = getConfig().backup.remote
    const where = r.provider === 'webdav' ? (r.webdav?.url || 'WebDAV') : `${r.owner}/${r.repo}`
    log.info(`云备份设置已更新｜${r.enabled ? `每天 ${r.time} 推 ${where}，留 ${r.keep} 份` : '关'}`)
    return { ok: true, message: '存好了', remote: remoteView(r) }
  }))

  route('/backup/push', backupAction(async () => doPush(false)))

  // 推送可能挂在一个 30 分钟超时的 PUT 上；给它一个取消入口，别逼人重启插件。
  route('/backup/remote/cancel', backupAction(async () => cancelPush()))

  route('/backup/remote/list', backupAction(async () => {
    const r = getConfig().backup?.remote || {}
    if (r.provider !== 'webdav') return { ok: false, message: '先把云备份方式切到 WebDAV' }
    try { return await listWebdavBackups(r) } catch (error) { return { ok: false, message: error.message } }
  }))

  route('/backup/remote/restore', backupAction(async (req) => {
    const r = getConfig().backup?.remote || {}
    if (r.provider !== 'webdav') return { ok: false, message: '先把云备份方式切到 WebDAV' }
    const name = String((await readBody(req)).name || '')
    if (!BACKUP_ZIP_RE.test(name)) return { ok: false, message: '备份文件名不对' }
    try {
      const got = await downloadWebdavBackup(r, name)
      const result = await stageReceivedBackup(got.buffer, name)
      log.info(`已从 WebDAV 拉回备份：${name}（${got.buffer.length} 字节）`)
      return result
    } catch (error) {
      return { ok: false, message: error.message }
    }
  }))
}
