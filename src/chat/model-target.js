export function createModelTarget({ availableModels, controller, defaultModel, dsh, getConfig, hooks, log, pickReasoningEffort, resolveChatModel }) {
  function targetModel(chat) {
    const cfg = getConfig()
    const t = defaultModel(dsh, cfg)
    let sel = t ? { provider: t.provider, model: t.model, reasoningEffort: cfg.model.reasoningEffort || '' } : null
    // 管理员按聊天指定的模型（私聊 QQ 号 > 群号 > 所有私聊 / 所有群默认）；没指定或指定的模型已不存在就用上面的
    try {
      const r = resolveChatModel(cfg, chat, typeof availableModels === 'function' ? availableModels() : null)
      if (r) sel = { provider: r.provider, model: r.model, reasoningEffort: r.reasoningEffort || cfg.model.reasoningEffort || '' }
    } catch {}
    if (hooks?.model && chat) {
      try {
        const r = hooks.model(sel, chat)
        if (r && r.provider && r.model) sel = { reasoningEffort: '', ...r }
      } catch {}
    }
    return sel
  }
  /**
   * 想要的思考强度要先按模型能力收敛：没有推理元数据的模型（本地 Ollama、部分手写 provider）
   * 只要收到 reasoningEffort 就会被 DSH 整轮拒掉（UNSUPPORTED_REASONING_EFFORT），
   * 等于这个模型直接没法用。不支持就不传这个参数，让 DSH 用模型自己的默认。
   */
  async function resolveTarget(chat) {
    const t = targetModel(chat)
    if (!t) return null
    const effort = await pickReasoningEffort(dsh, t.provider, t.model, t.reasoningEffort)
    return { provider: t.provider, model: t.model, ...(effort ? { reasoningEffort: effort } : {}) }
  }

  /** 让聊天会话用面板里选的模型和思考强度；只改这个会话，不改 DSH 的默认模型。 */
  function applyModel(agent, target) {
    try {
      if (!target) return false
      const sel = { provider: target.provider, model: target.model }
      if (target.reasoningEffort) sel.reasoningEffort = target.reasoningEffort
      // agent.model.select 只作用于当前会话。旧宿主用控制器内部的会话选择接口。
      if (typeof agent.model?.select === 'function') agent.model.select(sel)
      else {
        const agents = controller().agents
        if (typeof agents?.selectForNextRequest === 'function') agents.selectForNextRequest(agent, sel)
        else agent.session.append('model/selection', sel)
      }
      return true
    } catch (error) {
      log.debug('设置会话模型失败（用默认）：', error.message)
      return false
    }
  }

  return { targetModel, resolveTarget, applyModel }
}
