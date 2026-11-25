export function createRunSubagentTurn({ assertActive, capabilitiesOf, disposeActivation, getConfig, getMind, optionalService, resolveTarget, subagentParent, subagentParentChat, subagentRuns }) {
  return async function runSubagentTurn(name, title, prompt, { timeoutMs = 600000, moduleId = '', source = null } = {}) {
    assertActive()
    // 权限边界（一审 #177）：① 调用模块必须在 module.json 的 capabilities 里声明 plugin-internals；
    // ② 必须带「管理员开口」的来源（source.kind='owner' + 管理员私聊 chatId）；
    // ③ 定时任务这类没人应答的场合，只有 config.subagentBackground=true 才放行；都没有就拒绝（无人应答 = 拒绝）。
    const caps = typeof capabilitiesOf === 'function' ? capabilitiesOf(moduleId) : []
    if (!moduleId || !Array.isArray(caps) || !caps.includes('plugin-internals')) {
      throw Object.assign(new Error(`模块「${moduleId || '未声明'}」没有 plugin-internals 能力，不能用子智能体委派（在 module.json 的 capabilities 里声明）`), { code: 'CAPABILITY_REQUIRED' })
    }
    const c = getConfig()
    const ownerQQ = String(c.ownerQQ || '')
    const ownerChat = source && source.kind === 'owner' ? String(source.chatId || '') : ''
    const fromOwner = Boolean(ownerQQ) && ownerChat === `private:${ownerQQ}`
    const fromBackground = Boolean(source && source.kind === 'system') && c.subagentBackground === true
    if (!fromOwner && !fromBackground) {
      throw Object.assign(new Error('子智能体委派要管理员开口：source 必须是管理员私聊，或打开「后台子智能体」开关（没人应答时一律拒绝）'), { code: 'OWNER_REQUIRED' })
    }
    const subagents = optionalService('subagents')
    if (!subagents || typeof subagents.startActivation !== 'function') {
      throw Object.assign(new Error('宿主没有 subagents 委派服务（需要较新的 DSH）'), { code: 'SUBAGENT_UNAVAILABLE' })
    }
    // rc.2 的具名子智能体服务同时采用扁平参数。rc.1 的服务需要 request 包装。
    const namedService = typeof subagents.namesOf === 'function'
    const parent = await subagentParent()
    // 调度父会话没有模型请求记录。DSH 会从创建参数继承选模，因此每次委派显式传入 AuraBot 的模型。
    const agentOptions = namedService ? await resolveTarget(subagentParentChat) : null
    assertActive()
    const ac = new AbortController()
    subagentRuns.add(ac)
    const limit = Math.min(2_147_483_647, Math.max(5000, Number(timeoutMs) || 600000))
    const timer = setTimeout(() => ac.abort(Object.assign(new Error(`子智能体超时（${Math.round(limit / 1000)} 秒）`), { code: 'SUBAGENT_TIMEOUT' })), limit)
    let rejectOnAbort
    const aborted = new Promise((_, reject) => {
      rejectOnAbort = () => reject(ac.signal.reason)
      ac.signal.addEventListener('abort', rejectOnAbort, { once: true })
    })
    let activation = null
    try {
      const task = {
        prompt: [{ type: 'text', text: String(prompt) }], parent, agentPreset: 'aurabot-subagent',
        ...(agentOptions ? { agentOptions } : {}),
      }
      const starting = Promise.resolve().then(() => {
        ac.signal.throwIfAborted()
        return subagents.startActivation({
          ...(namedService ? task : { request: task }),
          provider: 'spawn',
          label: String(title || name || '任务').slice(0, 80),
          signal: ac.signal,
          delivery: 'caller',
        })
      }).then((started) => {
        if (ac.signal.aborted) {
          disposeActivation(started)
          throw ac.signal.reason
        }
        activation = started
        return started
      })
      const started = await Promise.race([starting, aborted])
      // 新服务的 signal 只保证创建阶段取消，创建成功后的超时要 dispose 精确的 activation。
      const r = await Promise.race([started.result, aborted])
      if (r && r.error) throw new Error(`子智能体执行失败：${r.error}`)
      // 新版 DSH 用 stopReason 标记结果，非正常完成时 output 可能是不完整的过程内容。
      if (r && typeof r === 'object' && 'stopReason' in r && r.stopReason !== 'completed') {
        throw Object.assign(new Error(`子智能体没有正常完成（${r.stopReason}）`), { code: 'SUBAGENT_INCOMPLETE' })
      }
      // 兼容旧版字符串/包装对象；有类型的消息块只接受 text，绝不递归读取 reasoning 或工具块。
      const collect = (v, out = []) => {
        if (v == null || out.length >= 200) return out
        if (typeof v === 'string') { if (v.trim()) out.push(v); return out }
        if (Array.isArray(v)) {
          // 最终消息仍带工具调用时，旁边的文字可能只是工具执行前的过程说明。
          if (v.some((block) => block && (block.type === 'tool-call' || block.type === 'tool_use'))) return out
          for (const x of v) collect(x, out)
          return out
        }
        if (typeof v === 'object') {
          if ('type' in v) {
            if (v.type === 'text' && typeof v.text === 'string') collect(v.text, out)
          } else if (typeof v.text === 'string') collect(v.text, out)
          else for (const k of ['content', 'output', 'summary', 'message', 'result']) if (k in v) collect(v[k], out)
        }
        return out
      }
      const parts = collect(r)
      if (!parts.length) throw Object.assign(new Error('子智能体没有可用的最终文字'), { code: 'SUBAGENT_EMPTY_OUTPUT' })
      return namedService ? parts.join('\n') : parts.at(-1)
    } finally {
      clearTimeout(timer)
      ac.signal.removeEventListener('abort', rejectOnAbort)
      subagentRuns.delete(ac)
      disposeActivation(activation)
    }
  }
}
