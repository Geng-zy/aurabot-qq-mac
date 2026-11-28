// 设置的读写与校验：默认值解析、只能管理员改的项、时区校验、年龄锚点。
// 从 mind/index.js 抽出来：那边是心智各层的装配，这一支只碰 settings 与参数表。

export function createSettings({ store, now, resolveSettings, paramOf, clampParam, validTimeZone, getMemory }) {
  function savedSettings() {
    return store.get('settings', {})
  }
  function settings() {
    return resolveSettings(savedSettings())
  }
  function setting(key) {
    return settings()[key]
  }
  /**
   * 改设置。by='owner' 才能改 ownerOnly 的项；她自己（by='self'）改不了。
   * 年龄会同时记下设置的时间，之后每过一次生日自动加一岁。
   */
  function updateSettings(patch, by = 'owner') {
    const saved = savedSettings()
    const next = { ...saved }
    const excerpts = setting('memory.ownerEverydayExcerpts')
    const changed = []
    for (const [key, value] of Object.entries(patch || {})) {
      const p = paramOf(key)
      if (!p) continue
      if (p.ownerOnly && by !== 'owner') throw new Error(`「${p.label}」只能由管理员设置`)
      if (key === 'identity.timezone' && !validTimeZone(value)) throw new Error('时区不认识：' + value)
      next[key] = clampParam(p, value)
      changed.push(key)
    }
    // 全部校验通过后才提交，设置和年龄锚点在同一个事务里。
    store.tx(() => {
      if (changed.includes('identity.age')) store.set('identity.ageSetAt', now())
      store.set('settings', next)
      if (next['memory.ownerEverydayExcerpts'] !== excerpts) getMemory().touchAudience()
    })
    return changed
  }
  function resetSetting(key) {
    const saved = savedSettings()
    const previous = setting(key)
    delete saved[key]
    const next = resolveSettings(saved)
    store.tx(() => {
      store.set('settings', saved)
      if (key === 'memory.ownerEverydayExcerpts' && next[key] !== previous) getMemory().touchAudience()
    })
  }

  const tz = () => setting('identity.timezone')


  return { savedSettings, settings, setting, updateSettings, resetSetting, tz }
}
