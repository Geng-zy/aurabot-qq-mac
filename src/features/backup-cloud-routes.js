// 云备份面板路由：设置、状态、列表和从 WebDAV 拉回。
// 真正的推送任务和每日定时器仍留在 host.js，避免把任务状态拆散。

const BACKUP_ZIP_RE = /^aurabot-(?:backup|config)-\d{8}-\d{4,6}(?:-\d{1,3})?(?:-[a-z0-9]{6,})?\.zip$/u

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

export function registerBackupCloudRoutes({
  route, backupAction, readBody, getConfig, setConfig, mergeFromPanel, log,
  getPushJob, nextAt, doPush, cancelPush = () => ({ ok: false, message: '没有在跑的推送' }), listWebdavBackups, downloadWebdavBackup, stageReceivedBackup,
}) {
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
