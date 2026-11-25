// 面板核心：概览、用量、保存设置、调试会话和首次向导完成。

export function registerPanelCoreRoutes({
  route, readBody, query, getConfig, setConfig, overview, usageReport, applyPanelSave, mergeFromPanel,
  clearReasoningCache, clearVisionCache, startWatchdog, qq, log, mods, hub,
}) {
  route('/state', async () => overview())
  route('/usage', async (req) => ({ ok: true, ...usageReport({ range: query(req).range || '7' }) }))

  route('/save', async (req) => {
    const saved = await applyPanelSave({
      body: await readBody(req),
      getConfig,
      setConfig,
      mergeFromPanel,
      clearReasoningCache,
      clearVisionCache,
      startWatchdog,
      qq,
      log,
      mods,
      hub,
    })
    return { ...(await overview()), message: saved.message }
  })

  route('/debug/session', async () => {
    try { return await hub.ensureDebugSession() } catch (error) { return { ok: false, message: error.message } }
  })

  route('/setup/done', async (req) => {
    const cfg = getConfig()
    const body = await readBody(req)
    if (!cfg.botQQ || !cfg.ownerQQ || cfg.botQQ === cfg.ownerQQ) return { ok: false, message: '先填好不同的机器人 QQ 和你的 QQ' }
    if (body.existingConnection && !(cfg.enabled && qq.ready())) return { ok: false, message: 'QQ 网关还没通过机器人号核对，请先连接并核对后再进入面板' }
    setConfig({ ...cfg, setupDone: true })
    log.info('首次使用向导完成')
    return { ...(await overview()), message: '设置完成，大肥鱼可以上线啦' }
  })
}
