// 面板「保存设置」的副作用编排：合并配置、模型缓存、总开关、模块同步和调试会话。
// HTTP 读取和 overview 仍由宿主负责。

export async function applyPanelSave({
  body, getConfig, setConfig, mergeFromPanel,
  clearReasoningCache, clearVisionCache, startWatchdog, qq, log, mods, hub,
}) {
  const before = getConfig()
  setConfig(mergeFromPanel(before, body))
  const cfg = getConfig()
  const changedModel = before.model.provider !== cfg.model.provider || before.model.model !== cfg.model.model
  if (changedModel) { clearReasoningCache(); clearVisionCache() }
  if (!before.enabled && cfg.enabled) startWatchdog()
  if (before.enabled && !cfg.enabled) qq.stop()
  log.info(`设置已保存｜总开关 ${cfg.enabled ? '开' : '关'}｜试运行 ${cfg.dryRun && !cfg.debug ? '开' : '关'}｜调试 ${cfg.debug ? '开' : '关'}`)
  await mods.sync().catch(() => {})
  let debugNote = ''
  if (cfg.debug) {
    try {
      const d = await hub.ensureDebugSession()
      debugNote = d.created ? '，调试会话已建好' : ''
    } catch (error) {
      log.debug('建调试会话失败：', error.message)
    }
  }
  return { message: '保存好了' + debugNote }
}
