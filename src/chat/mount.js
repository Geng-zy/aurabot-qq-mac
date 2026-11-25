export function createMount({ CHAT_STYLE_INSTRUCTION, CODE_INSTRUCTION, DIRECT_REPLY_INSTRUCTION, MARKER_INSTRUCTION, agentFor, assertActive, buildTools, busy, cleanText, contextProviders, currentPromptSources, getConfig, hooks, isBusy, isDisposed, isGuestSafeTool, isPrivilegedQqTool, levelFor, log, map, mounted, mounts, outputSources, ownerAuthorizationRevision, ownerLabel, purgeScope, pushToSession, release, running, saveMap, sendText, sessionKey, slowNoticeSent, slowTimers, sourcesFor, toolDisposers, toolScope, toolsGeneration, turnSendersAllOwner, turnState }) {
  async function ensureDebugSession() {
    const cfg = getConfig()
    if (!cfg.debug) return { ok: false, message: '没开调试模式' }
    if (!cfg.ownerQQ) return { ok: false, message: '还没填管理员 QQ' }
    const chat = { kind: 'private', chatId: `private:${cfg.ownerQQ}`, userId: String(cfg.ownerQQ), groupId: '', nickname: ownerLabel() }
    const before = map().chats[chat.chatId]
    const existed = Boolean(before && ((before.sessions && before.sessions.debug) || (before.mode || 'live') === 'debug'))
    const r = await agentFor(chat)
    if (!existed) log.info(`调试会话建好了：${r.sessionId.slice(-8)}（在左侧栏「Aurabot · QQ」里打开就能直接跟她说话）`)
    // 空会话在 DSH 侧栏里是看不见的：第一次建出来、或者之前那条还没开过场，就让她先打个招呼（来自原项目 a6c2220）。
    // 调试模式下这一轮只进日志，不发 QQ、不写进心智
    const entry = map().chats[chat.chatId]
    if (!entry?.debugSeeded && !isBusy(chat.chatId)) {
      const stillDebugging = () => !isDisposed() && getConfig().debug && String(getConfig().ownerQQ) === chat.userId
      const reservation = Date.now()
      busy.set(chat.chatId, reservation)
      pushToSession(chat, [{ type: 'text', text: '（调试模式刚开始，这条只有你们俩在面板和侧栏里看得到。轻轻打个招呼，一句话就好。）' }], String(cfg.ownerQQ), {
        internal: true,
        assertAuthorized: () => { if (!stillDebugging()) throw new Error('调试模式已切换') },
      }).then(() => {
        const m = map()
        const saved = m.chats[chat.chatId]
        if (stillDebugging() && saved?.sessionId === r.sessionId && saved.mode === 'debug') {
          saved.debugSeeded = true
          saveMap(m)
        }
      }).catch((error) => {
        if (!isDisposed() && busy.get(chat.chatId) === reservation) release(chat.chatId)
        log.debug('调试会话开场白失败：', error.message)
      })
    }
    return {
      ok: true, sessionId: r.sessionId, created: !existed,
      message: existed ? '调试会话已经在了：左侧栏没看到就刷新一下 DSH 页面；也可以直接用下面的「调试对话」说话' : '建好了一条调试会话，已经让她先打了个招呼：左侧栏「Aurabot · QQ」里刷新一下就能看到',
    }
  }

  /** 这个聊天要用的模型：管理员按聊天指定的 > 面板里选的全局模型（或 DSH 默认），扩展模块还可以再按聊天改。 */
  function unmount(rec) {
    mounts.delete(rec)
    toolScope.releaseAgent(rec.agent)
    for (const off of rec.offs.splice(0).reverse()) {
      try { if (typeof off === 'function') off() } catch (error) { log.warn('注销会话挂载失败：', error.message) }
    }
  }

  function mount(agent, chat, level) {
    assertActive()
    const sid = sessionKey(agent.session?.id ?? agent.id)
    const tools = level !== 'chat' && typeof buildTools === 'function' ? buildTools({ chat, level, sessionId: sid }) : []
    const denied = (() => { try { return hooks?.deniedTools?.() || [] } catch { return [] } })()
    // Purge 把宿主维护工具注册成全局工具，社交预设也会继承。只有完整权限的管理员私聊可以用它们。
    const configAtMount = getConfig()
    const ownerMaintenance = chat.kind === 'private' && level === 'full' && levelFor(configAtMount, chat) === 'full'
    const maintenanceRevision = ownerMaintenance ? ownerAuthorizationRevision(configAtMount) : ''
    const maintenanceBot = configAtMount.botQQ
    const maintenance = ownerMaintenance ? [] : purgeScope.toolNames(agent)
    // 模块（重）启动代际也进 key：热重载后工具名通常不变，但工具对象是旧实例的闭包（issue #73），
    // 只比名字会一直 return，会话里永远用旧实现/旧状态；带上代际就整套重挂。
    let gen = 0
    try { gen = typeof toolsGeneration === 'function' ? Number(toolsGeneration()) || 0 : 0 } catch { gen = 0 }
    const maintenanceKey = ownerMaintenance ? `owner:${maintenanceBot}:${maintenanceRevision}` : maintenance.join(',')
    const toolsKey = tools.map((t) => t.name).sort().join(',') + '|' + denied.join(',') + '|' + maintenanceKey + '|gen:' + gen
    const prev = mounted.get(sid)
    // 工具清单变了（比如面板里开了生图）就整套重挂；同一个 agent 且没变就别动（改工具会让前缀缓存失效）
    if (prev && prev.agent === agent && prev.chatId === chat.chatId && prev.toolsKey === toolsKey) return
    if (prev) unmount(prev)
    const offs = []
    // 联动工具是给 DSH 其他会话用的，她自己的 QQ 会话里不该有（陌生人的会话更不行）
    if (denied.length) {
      try { offs.push(agent.ctx.tools.restrict({ deny: denied })) } catch (error) { log.debug('屏蔽联动工具：', error.message) }
    }
    if (maintenance.length) {
      try { offs.push(agent.ctx.tools.restrict({ deny: maintenance })) } catch (error) { log.warn('屏蔽宿主维护工具失败：', error.message) }
    }
    {
      for (const tool of tools) {
        try {
          // 慢工具（生图 / 翻唱……）卡超过 1.5 秒就先发一条提示：不让管理员以为她没收到（issue #74）。
          // 包装只加在挂给 agent 的这份工具上；面板里直接调工具（host 路由）照旧。
          const execute = async (args, exec) => {
            const state = turnState.get(sid)
            if (state?.rewriting || state?.recovering) return { ok: false, message: '这一步只重写回复正文' }
            if (state) state.retry = null
            if (isPrivilegedQqTool(tool.name) && !turnSendersAllOwner(sid)) return { ok: false, message: '只有管理员开口时才能使用这个工具。' }
            return tool.execute(args, exec)
          }
          let reg = { ...tool, execute }
          if (tool.slow) {
            const { slow, ...base } = tool
            const notice = typeof slow === 'string' ? slow : '好，我这就去做，做完跟你说一声。'
            reg = {
              ...base,
              async execute(args, exec) {
                let fired = false
                const token = running.get(chat.chatId)
                const isCurrent = () => !isDisposed() && token !== undefined && running.get(chat.chatId) === token
                const timer = setTimeout(() => {
                  slowTimers.delete(timer)
                  if (fired) return
                  fired = true
                  if (!isCurrent()) return
                  if (slowNoticeSent.has(sid)) return
                  slowNoticeSent.add(sid)
                  sendText(chat.chatId, notice, undefined, [], undefined, { isCurrent }).catch((error) => log.debug('慢工具提示没发出去：', error.message))
                }, 1500)
                slowTimers.set(timer, sid)
                timer.unref?.()
                try {
                  return await execute(args, exec)
                } finally {
                  clearTimeout(timer)
                  slowTimers.delete(timer)
                }
              },
            }
          }
          // 注册表里如果残留同名工具（旧 agent 作用域/旧版泄漏），先把我们记着的旧 disposer 清掉再注册
          const dkey = sid + '|' + tool.name
          const stale = toolDisposers.get(dkey)
          if (stale) { try { stale() } catch {} toolDisposers.delete(dkey) }
          const off = agent.ctx.tools.register(reg)
          toolDisposers.set(dkey, off)
          offs.push(() => { toolDisposers.delete(dkey); try { off() } catch {} })
        } catch (error) {
          log.warn(`工具 ${tool.name} 挂不上：`, error.message)
        }
      }
    }
    try {
      offs.push(agent.ctx.systemPrompt.context({
        name: 'aurabot-context',
        order: 905,
        text: () => {
          const parts = []
          const active = currentPromptSources()
          const sources = active?.chatId === chat.chatId ? active : sourcesFor(chat.chatId)
          for (const p of contextProviders || []) {
            try {
              const t = p({ chat, sessionId: sid, publicOnly: sources.publicOnly === true, userText: sources.userText })
              if (t) parts.push(t)
            } catch {}
          }
          if (chat.kind !== 'system') {
            const cfg = getConfig()
            parts.push(CHAT_STYLE_INSTRUCTION)
            if (cfg.chat?.thinkingGuard !== false) parts.push(CODE_INSTRUCTION, DIRECT_REPLY_INSTRUCTION)
            if (cfg.chat?.replyMarker) parts.push(MARKER_INSTRUCTION)
          }
          const text = cleanText(parts.join('\n\n'))
          sources.context = text
          outputSources.set(chat.chatId, sources)
          return text
        },
      }))
    } catch (error) {
      log.debug('挂上下文失败：', error.message)
    }
    if (chat.kind !== 'system' && !ownerMaintenance && level !== 'group-full') {
      offs.push(toolScope.restrictGuest(agent))
    }
    if (typeof agent.ctx.tools.guard === 'function') {
      const localNames = new Set(tools.map((tool) => tool.name))
      offs.push(agent.ctx.tools.guard((exec) => {
        const name = String(exec?.name || '')
        if (purgeScope.isTool(name)) {
          const current = getConfig()
          if (!ownerMaintenance || levelFor(current, chat) !== 'full' || current.botQQ !== maintenanceBot
            || ownerAuthorizationRevision(current) !== maintenanceRevision) return '宿主维护工具仅限完整权限的管理员私聊。'
          return
        }
        if (ownerMaintenance || localNames.has(name)) return
        if (chat.kind === 'group' && level === 'group-full' && turnSendersAllOwner(sid)) return
        if (chat.kind !== 'system' && !isGuestSafeTool(name)) return '当前会话没有本机或宿主工具权限。'
      }))
    }
    if (chat.kind === 'group' && level === 'group-full') {
      toolScope.openGate(sid, agent)
      toolScope.applyGate(sid, false) // 先收起，管理员开口那一轮再放开
    }
    const rec = { agent, chatId: chat.chatId, offs, toolsKey }
    mounted.set(sid, rec)
    mounts.add(rec)
  }

  // ---------- 发到 QQ ----------
  return { ensureDebugSession, unmount, mount }
}
