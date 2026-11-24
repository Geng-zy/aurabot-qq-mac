// 心智设置：读取、保存、重置和立即整理；向量 Key 跟端点绑定。

export function registerMindSettingsRoutes({ route, readBody, getMind, getConfig, clearEmbedKey }) {
  const mindOff = { ok: false, message: '心智核心没起来，看日志里的原因' }
  const norm = (v) => String(v || '').replace(/\/+$/, '')

  route('/mind/settings', async () => {
    const mind = getMind()
    if (!mind) return mindOff
    const { GROUPS, PARAMS } = await import('../mind/params.js')
    return { ok: true, groups: GROUPS, params: PARAMS, values: mind.mind.settings(), saved: mind.mind.savedSettings() }
  })

  route('/mind/settings/save', async (req) => {
    const mind = getMind()
    if (!mind) return mindOff
    const b = await readBody(req)
    try {
      const beforeUrl = norm(mind.mind.setting('memory.embedUrl'))
      const changed = mind.mind.updateSettings(b.patch || {}, 'owner')
      const afterUrl = norm(mind.mind.setting('memory.embedUrl'))
      if (beforeUrl !== afterUrl && getConfig().mind?.embedKey) clearEmbedKey()
      return { ok: true, changed, values: mind.mind.settings(), saved: mind.mind.savedSettings() }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })

  route('/mind/settings/reset', async (req) => {
    const mind = getMind()
    if (!mind) return mindOff
    const b = await readBody(req)
    const beforeUrl = norm(mind.mind.setting('memory.embedUrl'))
    mind.mind.resetSetting(String(b.key || ''))
    const afterUrl = norm(mind.mind.setting('memory.embedUrl'))
    if (beforeUrl !== afterUrl && getConfig().mind?.embedKey) clearEmbedKey()
    return { ok: true, values: mind.mind.settings(), saved: mind.mind.savedSettings() }
  })

  route('/mind/sleep', async () => {
    const mind = getMind()
    if (!mind) return mindOff
    const report = await mind.mind.sleep()
    return { ok: true, report, message: '整理完了' }
  })
}
