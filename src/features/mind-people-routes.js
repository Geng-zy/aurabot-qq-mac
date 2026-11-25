// 心智关系、遗忘/恢复、惦记事项、权限和本地小模型。

export function registerMindPeopleRoutes({
  route, readBody, getMind, getConfig, parsePerson, legacyPlatform, hub, log, localInstaller,
}) {
  const mindOff = { ok: false, message: '心智核心没起来，看日志里的原因' }

  route('/mind/want/close', async (req) => {
    const mind = getMind()
    if (!mind) return mindOff
    const b = await readBody(req)
    return { ok: mind.mind.motivation.closeWant(String(b.id || ''), 'dropped') }
  })
  route('/mind/permission/decide', async (req) => {
    const mind = getMind()
    if (!mind) return mindOff
    const b = await readBody(req)
    const r = mind.decide(Number(b.n), Boolean(b.yes), 'panel')
    return r ? { ok: true, message: r.granted ? '批准了' : '没批准' } : { ok: false, message: '这条已经处理过了' }
  })
  route('/mind/permission/revoke', async (req) => {
    const mind = getMind()
    if (!mind) return mindOff
    const b = await readBody(req)
    mind.revoke(String(b.key || ''))
    return { ok: true, message: '收回了' }
  })

  route('/mind/local/install', async (req) => {
    if (req?.method !== 'POST') return { ok: false, message: '请从面板发起安装。' }
    const mind = getMind()
    if (!mind) return mindOff
    if (!localInstaller.supported) return { ok: false, message: '一键安装需要 Apple 芯片 Mac。' }
    if (localInstaller.status().running) return { ok: false, message: '已经在装了' }
    const { python, modelDir } = mind.local.status()
    const before = mind.mind.setting('models.localPython')
    localInstaller.install({ python, model: modelDir }).then((result) => {
      if (result.ok && result.python !== python && before === mind.mind.setting('models.localPython')) {
        mind.mind.updateSettings({ 'models.localPython': '' }, 'owner')
      }
    }).catch((error) => log.warn('本地小模型安装状态更新失败：', error.message))
    return { ok: true, message: '正在检查本地环境，只会下载安装缺少的部分。' }
  })
  route('/mind/local/install/status', async () => ({
    ...localInstaller.status(),
    ...(getMind() ? { local: getMind().local.status() } : {}),
  }))
  route('/mind/local/test', async () => {
    const mind = getMind()
    if (!mind) return mindOff
    const c = mind.local.check()
    if (!c.ok) return { ok: false, message: c.reason }
    const t0 = Date.now()
    const out = await mind.local.chat([{ role: 'user', content: '用一句话说说你现在在想什么。' }], { maxTokens: 60 })
    return out ? { ok: true, message: `能用（${((Date.now() - t0) / 1000).toFixed(1)} 秒）：${out.slice(0, 60)}` } : { ok: false, message: '没跑起来：' + (mind.local.status().lastError || '原因不明') }
  })
  route('/mind/act', async (req) => {
    const mind = getMind()
    if (!mind) return mindOff
    const b = await readBody(req)
    const r = await mind.runAction(String(b.id || ''))
    return { ok: Boolean(r?.ok), message: r?.summary || (r?.ok ? '做完了' : '没做成') }
  })

  route('/mind/people', async () => {
    const mind = getMind()
    if (!mind) return mindOff
    const { exclusive, sexualDesire } = mind.mind.identity()
    return { ok: true, list: mind.mind.relations.list(), groups: mind.mind.relations.groups().map((g) => ({ ...g, name: hub?.groupNames?.get?.(String(g.id)) || '' })), exclusive, passionEnabled: sexualDesire }
  })
  route('/mind/people/forget', async (req) => {
    const mind = getMind()
    if (!mind) return mindOff
    const b = await readBody(req)
    const person = parsePerson(b.id)
    if (!person || (person.platform === legacyPlatform && !/^\d+$/.test(person.id))) return { ok: false, message: '要忘掉谁？' }
    if (b.confirm !== true && b.mode === 'delete') return { ok: false, message: '要再确认一次' }
    const id = `${person.platform}:${person.id}`
    const r = mind.forgetPerson(id, String(b.mode || ''), { clear: b.clear === true })
    if (r.ok) log.info(`关系：${id} → ${b.mode}${b.clear ? '（清掉以前的）' : ''}`)
    return r
  })
  route('/mind/followups', async () => (getMind() ? { ok: true, list: getMind().mind.memory.followups() } : mindOff))
  route('/mind/followups/close', async (req) => {
    const mind = getMind()
    if (!mind) return mindOff
    return mind.mind.memory.closeFollowup(String((await readBody(req)).id || ''), 'owner') ? { ok: true, message: '好，不问了' } : { ok: false, message: '没有这件事' }
  })
  route('/mind/people/graph', async () => (getMind() ? { ok: true, ...getMind().mind.peopleGraph(), self: getMind().mind.identity().name || '她' } : mindOff))
  route('/mind/people/forgotten', async () => (getMind() ? { ok: true, list: getMind().mind.forgottenList() } : mindOff))
  route('/mind/people/restore', async (req) => {
    const mind = getMind()
    if (!mind) return mindOff
    return mind.restorePerson((await readBody(req)).id)
  })
  route('/mind/people/edit', async (req) => {
    const mind = getMind()
    if (!mind) return mindOff
    const b = await readBody(req)
    if (!b.id) return { ok: false, message: '要改谁？' }
    const g = mind.mind.relations.edit(String(b.id), b.patch || {})
    return { ok: true, person: g, message: '改好了' }
  })
}
