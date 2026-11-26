export function createAttentionQueue({ MAX_MESSAGE_IMAGES, RANK, askModel, attentionBlocked, attentionPriority, attentionQueue, attentionRetryTimers, bump, busy, defaultModel, dsh, flushing, getConfig, getMind, groupBuf, groupEngagedRun, groupInterjects, groupKey, groupMusts, groupPrompt, groupRefs, isBusy, isDisposed, isOwner, isSessionBackoff, lastSpeaker, log, pending, pushToSession, release, running, secretaryLogs, secretaryStats, secretaryStatsFile, stickerStash, targetModel, turnEpochs, writeJson }) {
  function enqueue(chat, content, senderId, wantVoice, mode = 'must', extra = {}) {
    const m = getConfig().merge
    const p = pending.get(chat.chatId) || { chat, texts: [], images: [], observations: [], senders: new Set(), wantVoice: false, timer: null, firstAt: Date.now(), mode, count: 0 }
    p.chat = chat
    p.count++
    if ((RANK[mode] || 3) > (RANK[p.mode] || 3)) p.mode = mode
    for (const c of content) {
      if (c.type === 'text') p.texts.push(c.text)
      else if (c.type === 'image' && p.images.length < MAX_MESSAGE_IMAGES) p.images.push(c)
    }
    if (extra.stickerPick) p.stickerPick = (p.stickerPick || 0) + extra.stickerPick
    if (chat.kind === 'private' && senderId && extra.observedText) p.observations.push({ speaker: senderId, text: extra.observedText, replyId: extra.replyId })
    if (senderId) p.senders.add(String(senderId))
    if (mode === 'must' && senderId && getMind()?.mustReplyOwner?.(chat.chatId, senderId)) p.mustReply = true
    if (mode === 'must' && chat.kind === 'group' && senderId && !isOwner(getConfig(), senderId, chat.chatId)) p.nonOwnerCall = true
    p.wantVoice = p.wantVoice || wantVoice
    pending.set(chat.chatId, p)
    clearTimeout(p.timer)
    if (!m.enabled) return flush(chat.chatId)
    // 群里大家一来一回说得慢，多等一会儿把一段话攒齐
    const group = chat.kind === 'group'
    const wait = (group ? m.groupWaitSec : m.waitSec) * 1000
    const max = (group ? m.groupMaxSec : m.maxSec) * 1000
    const left = Math.max(0, max - (Date.now() - p.firstAt))
    p.timer = setTimeout(() => flush(chat.chatId), Math.min(wait, left))
    p.timer.unref?.()
  }

  function scheduleAttentionRetry(chatId, delay = 30_000) {
    if (isDisposed() || attentionRetryTimers.has(chatId)) return
    const timer = setTimeout(() => {
      attentionRetryTimers.delete(chatId)
      if (!isDisposed() && pending.get(chatId)?.waiting) flush(chatId).catch(() => {})
    }, delay)
    timer.unref?.()
    attentionRetryTimers.set(chatId, timer)
  }

  /** 可选的群聊秘书闸：用便宜模型先判断这段值不值得叫主模型；关着时零影响。 */
  function recordSecretary(chatId, allowed, reason = '') {
    const at = Date.now()
    const list = secretaryLogs.get(chatId) || []
    list.push({ at, allowed: Boolean(allowed), reason: String(reason || '').slice(0, 160) })
    secretaryLogs.set(chatId, list.slice(-20))
    try {
      const row = secretaryStats[chatId] || { allowed: 0, blocked: 0, lastAt: 0, days: {} }
      const day = new Date(at).toISOString().slice(0, 10)
      row.days = row.days || {}
      const today = row.days[day] || { allowed: 0, blocked: 0 }
      if (allowed) { row.allowed += 1; today.allowed += 1 } else { row.blocked += 1; today.blocked += 1 }
      row.days[day] = today
      row.days = Object.fromEntries(Object.entries(row.days).sort(([a], [b]) => b.localeCompare(a)).slice(0, 30))
      row.lastAt = at
      secretaryStats[chatId] = row
      writeJson(secretaryStatsFile, secretaryStats)
    } catch (error) { log.debug('秘书统计写入失败：', error.message) }
  }

  async function secretaryVeto(p) {
    const base = getConfig().chat?.secretary
    const sec = base?.groups?.[p.chat.chatId] ? { ...base, ...base.groups[p.chat.chatId] } : base
    if (!sec?.enabled || p.chat.kind !== 'group' || p.mode === 'must') return false
    const model = sec.provider && sec.model ? { provider: sec.provider, model: sec.model } : (targetModel(p.chat) || defaultModel(dsh, getConfig()))
    if (!model) return false
    const recent = (groupBuf.get(groupKey(p.chat.chatId)) || []).slice(-Math.max(1, Number(sec.maxRecent) || 20))
      .map((x) => `${x.nick || x.uid}: ${x.text || '（图片/表情）'}`)
    const text = [...recent, ...p.texts].filter(Boolean).join('\n').slice(0, 6000)
    try {
      const out = await askModel(dsh, {
        cfg: getConfig(), model,
        system: '你是群聊接话判断器。只根据这段聊天判断她此刻接一句是否自然、有价值。不要回复聊天内容。只输出 JSON：{"should_reply":true} 或 {"should_reply":false}。被明确叫到必须 true；没人叫她、话题接不上、刷屏或重复时 false。',
        text, maxTokens: 80, reasoningEffort: 'low', module: 'chat-secretary', signal: AbortSignal.timeout(8000), retryEmpty: false,
      })
      const raw = String(out || '').trim()
      const start = raw.indexOf('{'); const end = raw.lastIndexOf('}')
      if (start >= 0 && end > start) {
        const blocked = JSON.parse(raw.slice(start, end + 1)).should_reply === false
        recordSecretary(p.chat.chatId, !blocked, blocked ? '秘书判断不接' : '秘书判断可以接')
        return blocked
      }
    } catch (error) {
      log.debug('群聊秘书判断失败，按原逻辑继续：', error.message)
      recordSecretary(p.chat.chatId, true, '判断失败，放行：' + error.message)
    }
    return false
  }

  async function flush(chatId) {
    if (isDisposed()) return
    const p = pending.get(chatId)
    if (!p) return
    if (flushing.has(chatId)) { p.waiting = true; return }
    flushing.add(chatId)
    try {
    clearTimeout(p.timer)
    // 「她挑」的提示统一在这里补：私聊、群聊、插话三条路都要带上
    const hint = p.stickerPick ? '\n\n' + stickerStash.hint(p.stickerPick) : ''
    // 私聊：她这一轮还在跑（想 / 调工具），新消息直接 steer 进当前这一轮，像在 DSH 界面里插话一样（#7）
    if (isBusy(chatId) && p.chat.kind === 'private' && running.has(chatId) && !turnEpochs.get(chatId)?.st?.rewriting) {
      pending.delete(chatId)
      if (p.count > 1) log.info(`${chatId}：合并了 ${p.count} 条消息一起插给她`)
      const content = [{ type: 'text', text: p.texts.join('\n') + hint }, ...p.images]
      const query = p.observations.map((x) => x.text).join('\n')
      const [first, ...rest] = [...p.senders]
      try {
        flushing.delete(chatId) // 已经进入这一轮，后续消息应走 steer，而不是被互斥挡在外面
        await pushToSession(p.chat, content, first, { wantVoice: p.wantVoice, extraSenders: rest, queryText: query, observations: p.observations, mustReply: p.mustReply, steer: true })
      } catch (error) {
        bump('errors')
        log.error(`插话进 DSH 失败（${chatId}）：`, error.message)
      }
      return
    }
    // 她还在回上一段：先攒着，回完了再交（release 会叫 flush）
    if (isBusy(chatId)) {
      p.waiting = true
      scheduleAttentionRetry(chatId, 35_000)
      return
    }
    // 心智核心：单一注意力——她正在别的聊天里回话，这一段先等着，回完再看（管理员的可以插队）
    if (attentionBlocked(chatId, p)) {
      p.waiting = true
      attentionQueue.set(chatId, { at: Date.now(), priority: attentionPriority(chatId, p) })
      // 兜底：那边卡住没 release，过一会儿再看一眼
      scheduleAttentionRetry(chatId)
      return
    }
    attentionQueue.delete(chatId)
    pending.delete(chatId)
    if (await secretaryVeto(p)) {
      // 判断为不接：把这段标成已读，避免下一条消息又把同一段重复交给她。
      for (const x of groupBuf.get(groupKey(chatId)) || []) x.fed = true
      log.debug(`${chatId}：群聊秘书判断这次不接`)
      return
    }
    if (p.count > 1) log.info(`${chatId}：合并了 ${p.count} 条消息一起交给她`)
    let content
    if (p.chat.kind === 'group') {
      const gkey = groupKey(p.chat.chatId)
      groupEngagedRun.set(gkey, p.mode === 'engaged' ? (groupEngagedRun.get(gkey) || 0) + 1 : 0)
      if (p.mode === 'interject' || p.mode === 'engaged') {
        const arr = (groupInterjects.get(gkey) || []).filter((t) => Date.now() - t < 3600_000)
        arr.push(Date.now())
        groupInterjects.set(gkey, arr)
      }
      // 必回也按小时记账：这段里只要有群友（非管理员）@/叫到她就记一次；管理员触发的不计入（管理员除外）
      if (p.mode === 'must' && p.nonOwnerCall) {
        const arr = (groupMusts.get(gkey) || []).filter((t) => Date.now() - t < 3600_000)
        arr.push(Date.now())
        groupMusts.set(gkey, arr)
      }
      // 上次会话建不起来时留下的那段（已经标成交给她了）：这次接在前面一起给，编号接着往下排
      const refOffset = Math.max(0, ...Object.keys(p.retryRefs || {}).map(Number))
      const gp = await groupPrompt(p.chat, p.mode, p.images, refOffset)
      if (isDisposed()) return
      if (p.retryRefs) groupRefs.set(gkey, { ...p.retryRefs, ...groupRefs.get(gkey) })
      if (gp.speakers.length) lastSpeaker.set(chatId, [...p.senders].pop() || gp.speakers.at(-1))
      const fresh = [{ type: 'text', text: gp.text + hint }, ...gp.images]
      content = p.retryContent ? [...p.retryContent, ...fresh] : fresh
      p.query = [p.retryQuery, gp.query].filter(Boolean).join('\n')
      p.observations = [...(p.retryObservations || []), ...gp.observations]
      p.speakers = [...new Set([...(p.retrySpeakers || []), ...gp.speakers])]
      p.autoReply = gp.autoReply
    } else {
      content = [{ type: 'text', text: p.texts.join('\n') + hint }, ...p.images]
    }
    busy.set(chatId, Date.now())
    flushing.delete(chatId) // 后续消息由 isBusy/steer 处理，不再占用准备阶段的互斥
    try {
      const [first, ...rest] = [...p.senders]
      const query = p.query ?? (p.observations.length ? p.observations.map((x) => x.text).join('\n') : p.texts.map((t) => t.replace(/^【私聊】[^：]*：/, '')).join('\n'))
      await pushToSession(p.chat, content, first, { wantVoice: p.wantVoice, extraSenders: rest, queryText: query, observations: p.observations, speakers: p.speakers, autoReply: p.autoReply, mindDirect: p.chat.kind === 'private' || p.mode === 'must', mustReply: p.mustReply })
    } catch (error) {
      if (isSessionBackoff(error)) {
        // 会话建不起来、在冷却：这段原文和图片都留着，下一条消息来时一起重试（不设定时器）
        busy.delete(chatId)
        getMind()?.endTurn?.(chatId)
        retainSessionMessages(chatId, p, content)
        log.info(`${chatId}：${error.message}`)
        return
      }
      if (!error.aurabotTurnReleased) release(chatId)
      bump('errors')
      log.error(`转进 DSH 失败（${chatId}）：`, error.message)
    }
    } finally { flushing.delete(chatId) }
  }

  /** 会话冷却时把这段留下：群聊的已经标成交给她了，要连内容带编号一起留；期间又来的消息并进来。 */
  function retainSessionMessages(chatId, p, content) {
    if (p.chat.kind === 'group') {
      p.retryContent = content
      p.retryQuery = p.query
      p.retryObservations = p.observations
      p.retrySpeakers = p.speakers
      p.retryRefs = groupRefs.get(groupKey(p.chat.chatId)) || {}
      p.images = []
    }
    const next = pending.get(chatId)
    if (next) {
      clearTimeout(next.timer)
      p.texts.push(...next.texts)
      if (p.chat.kind === 'private') p.observations.push(...next.observations)
      p.images = [...p.images, ...next.images]
      for (const sender of next.senders) p.senders.add(sender)
      p.count += next.count
      p.wantVoice ||= next.wantVoice
      p.stickerPick = (p.stickerPick || 0) + (next.stickerPick || 0)
    }
    p.waiting = false
    p.timer = null
    pending.set(chatId, p)
  }

  /** 她这一轮说完了（或者没说）：放开，把这期间攒下的消息交给她。 */
  return { enqueue, flush, scheduleAttentionRetry, recordSecretary }
}

/**
 * 单一注意力（心智核心的「一次只回一个聊天」）的排序与放行规则。
 *
 * 从 hub.js 搬出来的原因：这几条规则是纯策略（谁的优先级高、谁在排队、回完该放谁），
 * 却和 hub 的 40 多个共享状态混在一起，改动时没人敢动。现在它只依赖 6 个入口，可以直接测。
 *
 * @param {object} d
 * @param {(p: object) => boolean} d.ownerIn 这条待回复里有没有管理员
 * @param {() => object|null} d.getMind 心智核心（拿 attention 设置）
 * @param {Map<string, object>} d.attentionQueue 等待中的聊天
 * @param {Map<string, object>} d.busy 正在回复的聊天（chatId → runToken）
 * @param {Map<string, object>} d.pending 每个聊天待合并的消息
 * @param {(chatId: string) => void} d.flush 把某个聊天放行
 * @param {boolean} d.isBusy 有没有聊天正在回（system:* 不算）
 * @param {() => boolean} d.isDisposed
 */
export function createAttentionRanking({ ownerIn, getMind, attentionQueue, busy, pending, flush, isBusy, isDisposed }) {
  /** 优先级：管理员 > 私聊 > 必须回 > 普通。 */
  function priority(chatId, p) {
    if (ownerIn(p)) return 3
    if (p?.chat?.kind === 'private') return 2
    if (p?.mustReply) return 1
    return 0
  }

  /** 单一注意力开着时，别的聊天正在回就先压住；管理员的消息（ownerCuts）不受限。 */
  function blocked(chatId, p) {
    let a = null
    try { a = getMind()?.attention?.() } catch {}
    if (!a?.single) return false
    if (a.ownerCuts && ownerIn(p)) return false
    return [...busy.keys()].some((k) => k !== chatId && !k.startsWith('system:') && isBusy(k))
  }

  /** 她回完一个聊天：看看谁在等（管理员的先，其次先来的）。 */
  function drain() {
    if (!attentionQueue.size || isDisposed()) return
    if ([...busy.keys()].some((k) => !k.startsWith('system:') && isBusy(k))) return
    const waiting = [...attentionQueue.entries()].filter(([id]) => pending.get(id)?.waiting)
    attentionQueue.clear()
    for (const [id, item] of waiting) attentionQueue.set(id, item)
    if (!waiting.length) return
    waiting.sort((a, b) => b[1].priority - a[1].priority || a[1].at - b[1].at)
    const next = waiting[0][0]
    attentionQueue.delete(next)
    const p = pending.get(next)
    if (p) p.waiting = false
    flush(next)
  }

  return { priority, blocked, drain }
}
