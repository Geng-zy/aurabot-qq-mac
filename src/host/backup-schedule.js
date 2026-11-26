// 云备份的定时器：每天到点自动打包，并把最新备份推到 Gitee / WebDAV。
// 从 host.js 拆出来的原因：它自带状态（job / timer / dueAt）和失败重排，跟组合根混在一起时
// setConfig、路由、dispose 三处都要伸手进来，改一处要读三个地方。
//
// 契约：pushJob 的形状（{ running, ok, error, result, at }）与 nextAt 的 ISO 时间
// 是面板 /backup/cloud/status 的返回字段，不能改（docs/REFACTOR-PLAN.md §1.1 第 4 条）。

/**
 * @param {object} d
 * @param {() => object} d.getConfig
 * @param {object} d.log
 * @param {() => boolean} d.alive 插件是否还在（unload 之后不再排下一轮）
 * @param {() => object|null} d.getBackupJob 打包任务的当前状态（和推送互斥用）
 * @param {Function} d.createBackup 打包
 * @param {Function} d.pushBackup 推送
 * @param {() => (() => object)|null} d.captureMind 打包时附带心智核心数据
 * @param {(cfg: object) => string} d.workspaceDirOf
 * @param {string} d.version
 */
export function createBackupScheduler({ getConfig, log, alive, getBackupJob, createBackup, pushBackup, captureMind, workspaceDirOf, version }) {
  let pushJob = null // { running, ok, error, result, at }
  let pushTimer = null
  let pushDueAt = null

  const nextAt = () => (pushDueAt === null ? null : new Date(pushDueAt).toISOString())
  const getPushJob = () => pushJob

  const doPush = async (pack) => {
    if (pushJob?.running) return { ok: false, message: '上一次推送还没跑完' }
    if (getBackupJob()?.running) return { ok: false, message: '正在打包，等这轮打包完再推' }
    pushJob = { running: true, pack: !!pack, at: Date.now() }
    try {
      const remote = getConfig().backup?.remote || {}
      const configOnly = remote.provider === 'webdav' && remote.webdav?.configOnly === true
      let sourceName = ''
      if (pack || configOnly) {
        const result = await createBackup({ version, workspaceDir: workspaceDirOf(getConfig()), captureMind: captureMind(), configOnly })
        sourceName = result.name
        log.info(`${configOnly ? '仅配置' : ''}云备份打包完成：${result.name}，${result.files} 个文件`)
      }
      const r = await pushBackup(remote, { version, sourceName })
      pushJob = { running: false, ok: true, result: r, at: Date.now() }
      log.info(`云备份推送完成：${r.message}`)
    } catch (error) {
      pushJob = { running: false, ok: false, error: error.message, at: Date.now() }
      log.error('云备份推送失败：', error.message)
    } finally {
      schedule() // 打包+推送耗时不定，跑完重排到下一天
    }
    return pushJob.ok
      ? { ok: true, message: pushJob.result.message || '备份已推送' }
      : { ok: false, message: '推送失败：' + pushJob.error }
  }

  /** 重排下一次推送：正常按配置的时间，撞上正在打包/推送时 60 秒后再看。 */
  function schedule(retryMs = 0) {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
    pushDueAt = null
    const r = getConfig().backup?.remote
    if (!r?.enabled || !alive()) return
    const now = Date.now()
    const next = new Date(now)
    if (retryMs) next.setTime(now + retryMs)
    else {
      const [hh, mm] = String(r.time || '03:30').split(':').map(Number)
      next.setHours(hh, mm, 0, 0)
      if (next.getTime() <= now) next.setDate(next.getDate() + 1)
    }
    pushDueAt = next.getTime()
    pushTimer = setTimeout(() => {
      pushTimer = null
      pushDueAt = null
      if (!alive()) return
      if (getBackupJob()?.running || pushJob?.running) schedule(60_000)
      else void doPush(true)
    }, pushDueAt - now)
    pushTimer.unref?.()
  }

  /** 插件卸载时收尾：别留悬空回调。 */
  function dispose() {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
    pushDueAt = null
  }

  return { doPush, schedule, nextAt, getPushJob, dispose }
}
