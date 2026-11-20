// 心智适配器启动/关闭：迁移旧数据、同步人格、快照、定时器、资源回收。
export function createLifecycle({ opts, log, mind, local, localEmbedding, migrateLegacy, replayDeletionsAfterRestore, outreach, resolveOwnerAbsence, syncPersona, importLegacySocial, inferTraits, dailySnapshot, encodeTick, bodyTick, innerTick, inner, drain, isClosed, setClosed }) {
  let timer = null
  let encodeTimer = null
  let sleepTimer = null
  let innerTimer = null

  async function start() {
    if (opts.legacyDir) {
      try {
        await migrateLegacy(mind, opts.legacyDir, log)
      } catch (error) {
        log.warn('旧数据迁移失败（下次启动再试）：', error.message)
      }
    }
    if (isClosed()) return
    await replayDeletionsAfterRestore()
    if (isClosed()) return
    outreach.noteContact(mind.lastOwnerMessageAt())
    resolveOwnerAbsence(outreach.lastContact())
    syncPersona('migration')
    try { importLegacySocial() } catch (error) { log.warn('旧的人物印象没并进关系：', error.message) }
    inferTraits().catch((error) => log.warn('从人格卡推特质失败（下次启动再试）：', error.message))
    dailySnapshot()
    timer = setInterval(dailySnapshot, 3600000)
    timer.unref?.()
    encodeTimer = setInterval(() => { Promise.resolve(encodeTick()).catch((error) => log.warn('记忆编码出错：', error.message)) }, 60000)
    encodeTimer.unref?.()
    sleepTimer = setInterval(() => { bodyTick().catch((error) => log.warn('身体推进出错：', error.message)) }, 60000)
    sleepTimer.unref?.()
    innerTimer = setInterval(() => {
      innerTick().catch((error) => log.warn('内心活动出错：', error.message))
      local.idleCheck()
      if (opts.heavyBusy?.()) local.stop()
    }, 30000)
    innerTimer.unref?.()
  }

  let closing = false
  async function close() {
    if (closing) return
    closing = true
    setClosed()
    inner.abort()
    for (const t of [timer, encodeTimer, sleepTimer, innerTimer]) if (t) clearInterval(t)
    timer = encodeTimer = sleepTimer = innerTimer = null
    try { await Promise.race([Promise.resolve(drain?.()).catch(() => {}), new Promise((r) => setTimeout(r, 5000))]) } catch {}
    try { local.stop() } catch {}
    localEmbedding.close?.()
    mind.close()
  }

  return { start, close }
}
