export function createDeliverTurn({ audienceRevision, blockSessionPrivacy, bubbleDelay, capOutboundText, chatInfo, cleanOutboundSegments, cleanOutboundText, cleaningFor, dataDir, failStore, getConfig, groupKey, groupRefs, guardReply, hooks, isDisposed, localImageBlocked, log, mood, outputScope, parseReply, pause, polishChatProse, sendImage, sendSticker, sendText, sendVoice, silenceTurn, stickers, turnSendLocks, workspaceDirOf, getMind, recordReply, pokeBack }) {
  return async function deliverTurn(chatId, text, opts = {}) {
    const mind = getMind()
    const scope = outputScope.getStore()
    const revision = audienceRevision(chatId)
    const current = () => !isDisposed() && audienceRevision(chatId) === revision && (opts.isCurrent?.() ?? true)
    if (!current()) return
    const cfg = getConfig()
    text = cleanOutboundText(text, cleaningFor(chatId))
    if (text.trim() && hooks?.reply) {
      try {
        const next = await hooks.reply(text, { chatId, userText: opts.userText || '' })
        if (next === null) return log.info(`${chatId}：扩展模块拦下了这次回复`)
        if (typeof next === 'string') text = next
      } catch (error) {
        log.warn('扩展模块改写回复出错：', error.message)
      }
    }
    if (!current()) return
    const guard = opts.own && cfg.chat?.thinkingGuard !== false
    if (guard) text = guardReply(text)
    text = cleanOutboundText(text, { ...cleaningFor(chatId), onPromptDecision: (allow) => { outputScope.getStore().allowPromptEcho = allow } })
    const r = parseReply(text, cleaningFor(chatId))
    if (r.silent) return silenceTurn(chatId)
    let items = r.items
    if (opts.own) items = items.map((item) => {
      if (item.code || !['text', 'voice'].includes(item.kind)) return item
      return { ...item, value: polishChatProse(item.value, opts.userText, cfg.chat?.clicheFilters || []) }
    })
    // 分条发出的中间段（chat.everyStep）：只发她当时说的原话，不做语音转换、不补表情、不按概率改形态，
    // 免得一段闲聊被拆成语音条和表情乱入。标签、markdown 图片照旧解析。
    const interim = Boolean(opts.interim) || items.some((item) => item.code)
    // 对方明确要语音、她却只打了字：整段改成语音发（模型偶尔会忘，这里兜底）
    if (!interim && opts.wantVoice && cfg.voice.enabled && !items.some((i) => i.kind === 'voice')) {
      const spoken = items.filter((i) => i.kind === 'text').map((i) => i.value).join('，')
      if (spoken && spoken.length <= 300) items = [{ kind: 'voice', value: spoken }, ...items.filter((i) => i.kind !== 'text')]
    }
    // 短回复按概率整条变语音
    const texts = items.filter((i) => i.kind === 'text')
    if (!interim && cfg.voice.enabled && items.length === texts.length && texts.length > 0) {
      const all = texts.map((t) => t.value).join('，')
      if (all.length <= cfg.voice.autoMaxChars && Math.random() < cfg.voice.autoChance * mood().voice) items = [{ kind: 'voice', value: all }]
    }
    const inGroup = chatInfo(chatId).kind === 'group'
    // 群里别刷屏：一段最多 3 条
    if (inGroup && items.length > 3) items = items.slice(0, 3)
    // 按概率补一张表情（群里已经有两条以上就不补了）
    if (!interim && cfg.stickers.enabled && !items.some((i) => i.kind === 'sticker') && !(inGroup && items.length >= 2) && Math.random() < cfg.stickers.autoChance * mood().sticker) {
      const pick = stickers.pickForReply(texts.map((t) => t.value).join(' '))
      if (pick) items.push({ kind: 'sticker', value: pick })
    }
    if (hooks?.items) {
      try {
        const next = await hooks.items(items, { chatId, text, userText: opts.userText || '' })
        if (next === null) return log.info(`${chatId}：扩展模块拦下了这次回复`)
        if (Array.isArray(next)) items = next
      } catch (error) {
        log.warn('扩展模块改写回复出错：', error.message)
      }
    }
    if (guard) items = items.flatMap((item) => {
      if (item.code || !['text', 'voice'].includes(item.kind)) return [item]
      const value = guardReply(item.value)
      return value ? [{ ...item, value }] : []
    })
    // 钩子改写后仍走同一个清洗，保留每条的语音/引用元数据。
    items = cleanOutboundSegments(items.map((item) => ({
      type: ['text', 'voice'].includes(item.kind) ? 'text' : item.kind,
      data: { text: item.value }, item,
    })), { ...cleaningFor(chatId), allowPromptEcho: false, onPromptDecision: (allow) => { outputScope.getStore().allowPromptEcho = allow } })
      .map((seg) => seg.type === 'text' ? { ...seg.item, value: seg.data.text } : seg.item)
    if (!items.length) return silenceTurn(chatId)
    const visible = items.filter((item) => ['text', 'voice'].includes(item.kind)).map((item) => item.value).join('\n')
    const blocked = visible && await mind?.checkOutgoingPrivacy?.(chatId, visible, opts.userText)
    if (!current()) return
    if (blocked) {
      log.warn(`${chatId}：回复可能转述了私密经历，已拦下`)
      blockSessionPrivacy(chatId)
      return silenceTurn(chatId)
    }
    items = capOutboundText(items, (item) => ['text', 'voice'].includes(item.kind) ? item.value : undefined,
      (item, value) => ({ ...item, value }))
    outputScope.getStore().checkedText = new Set(items.filter((item) => ['text', 'voice'].includes(item.kind)).map((item) => item.value))
    // 一段只有一个人明确 @ / 引用她时，第一条回复引用并 @ 那个人；多人同时叫她不猜。
    // 模型明确选了引用编号时尊重它，不再自动引用另一条。
    const refs = inGroup ? groupRefs.get(groupKey(chatId)) || {} : {}
    const explicit = items.some((item) => item.replyTo)
    const firstSendable = items.findIndex((item) => item.kind === 'text' || item.kind === 'voice' || item.kind === 'image' || (item.kind === 'sticker' && cfg.stickers.enabled && Boolean(item.value && typeof item.value === 'object' ? item.value : stickers.match(item.value))))
    const feedIndex = opts.feed ? items.findLastIndex(({ kind }) => kind === 'text' || kind === 'voice') : -1
    const missedAt = [] // 写了 @ 却没对上群里人的名字
    const failures = []
    let unconfirmed = items.length
    let releaseTurnSend
    const turnSendGate = new Promise((resolve) => { releaseTurnSend = resolve })
    turnSendLocks.set(chatId, turnSendGate)
    try {
    await failStore.run(failures, async () => {
      for (let i = 0; i < items.length; i++) {
        if (!current()) return
        const it = items[i]
        scope.feed = i === feedIndex ? opts.feed : undefined
        const receipts = scope.delivered.length + scope.queued + scope.simulated
        const selected = it.replyTo ? refs[it.replyTo] : (!explicit && i === firstSendable ? opts.autoReply : null)
        const replyId = selected?.mid
        // 她自己引用了 @ 她的人就照常 @；自动回复只有一个人说话时才有（#160）
        const userId = selected && (selected.direct || opts.autoReply?.uid === selected.uid) ? selected.uid : undefined
        if (it.replyTo && !replyId) log.debug(`${chatId}：引用的编号 ${it.replyTo} 对不上，正常发`)
        const sendOptions = { isCurrent: current, allowQueue: !opts.confirmDelivery }
        if (it.kind === 'text') await sendText(chatId, it.value, replyId, missedAt, userId, { ...sendOptions, literalCode: it.code })
        else if (it.kind === 'voice') {
          if (cfg.voice.enabled) await sendVoice(chatId, it.value, replyId, userId, sendOptions)
          else await sendText(chatId, it.value, replyId, missedAt, userId, sendOptions)
        } else if (it.kind === 'sticker') await sendSticker(chatId, it.value, replyId, userId, sendOptions)
        else if (it.kind === 'poke') {
          if (!opts.simulate && await pokeBack(chatId)) scope.delivered.push({ kind: 'poke' })
        }
        else if (it.kind === 'image') {
          if (localImageBlocked(chatId, it.value, { getConfig, chatInfo, workspaceDirOf, dataDir })) log.warn(`${chatId}：回复里的本机图片不在允许的目录里，没发`)
          else await sendImage(chatId, it.value, replyId, userId, sendOptions)
        }
        if (scope.delivered.length + scope.queued + scope.simulated > receipts) unconfirmed--
        if (i < items.length - 1 && !opts.simulate) await pause(bubbleDelay(items[i + 1].kind === 'text' ? items[i + 1].value : '') * mood().delay)
      }
    })
    } finally {
      releaseTurnSend()
      if (turnSendLocks.get(chatId) === turnSendGate) turnSendLocks.delete(chatId)
    }
    if (isDisposed()) return
    const delivered = scope.delivered.length > 0
    if ((scope.blocked || opts.confirmDelivery) && !delivered) return silenceTurn(chatId)
    if (opts.simulate) return items
    if (delivered) recordReply(chatId, scope.delivered, opts)
    return { missedAt, failed: failures.length, errors: failures, delivered, queued: scope.queued, simulated: scope.simulated, unconfirmed }
  }
}
