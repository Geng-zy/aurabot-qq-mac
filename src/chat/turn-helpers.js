// 戳回去、静默、一轮投递入口和后台发送的排队辅助。

export function createTurnHelpers({
  getConfig, channelOf, chatInfo, lastPoker, lastSpeaker, captureStore, log,
  groupEngaged, groupEngagedRun, groupKey, currentPromptSources, outputSources, outputScope,
  deliverTurn, turnSendLocks, sendSegments,
}) {
  async function pokeBack(chatId) {
    const cfg = getConfig()
    if (channelOf(chatId)?.caps?.poke === false) return
    const info = chatInfo(chatId)
    const group = info.kind === 'group' ? info.id : ''
    const target = group ? lastPoker.get(chatId) || lastSpeaker.get(chatId) : info.id
    if (!target) return
    if (cfg.debug || !cfg.enabled || cfg.dryRun || captureStore.getStore()) return log.info(`试运行（没真戳）→ ${chatId}：戳了戳 ${target}`)
    try {
      await channelOf(chatId).poke(chatId, target)
      log.info(`${chatId}：她戳了戳 ${target}`)
      return true
    } catch (error) {
      log.debug('戳一戳失败：', error.message)
    }
  }

  function silenceTurn(chatId) {
    log.info(`${chatId}：她选择不说话`)
    const info = chatInfo(chatId)
    if (info.kind === 'group') {
      groupEngaged.delete(groupKey(chatId))
      groupEngagedRun.delete(groupKey(chatId))
    }
  }

  function deliver(chatId, text, opts = {}) {
    const active = currentPromptSources()
    const current = opts.sources || active || outputSources.get(chatId)
    const sources = current && { ...current, system: new Map(current.system), memory: [...current.memory] }
    return outputScope.run({ chatId, sources, delivered: [], queued: 0, simulated: 0, journal: opts.own ? 'own' : 'external', blocked: false, allowPromptEcho: false }, () => deliverTurn(chatId, text, opts))
  }

  async function whenTurnIdle(chatId) {
    const gate = turnSendLocks.get(chatId)
    if (gate) await gate.catch(() => {})
  }

  async function sendBackground(chatId, message, note, opts = {}) {
    const gate = turnSendLocks.get(chatId)
    if (gate) await gate.catch(() => {})
    return sendSegments(chatId, message, note, { ...opts, system: true })
  }

  return { pokeBack, silenceTurn, deliver, whenTurnIdle, sendBackground }
}
