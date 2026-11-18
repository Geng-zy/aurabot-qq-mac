// 内心活动：走神、想事、自己去做一件事、后台模型预算。
import { AsyncLocalStorage } from 'node:async_hooks'
import { estimateTokens } from '../mind/budget.js'

export function createInner({ mind, opts, now, log, isClosed, debug, local, checkOutreach: checkOutreachFn }) {
  let lastChatAt = 0
  let activityVersion = 0
  const actionContext = new AsyncLocalStorage()
  let doing = null
  let innerRunning = false

  function noteChatActivity() {
    lastChatAt = now()
    activityVersion++
  }

  function canThink() {
    return !isClosed() && !doing && opts.getConfig()?.enabled !== false && !debug() && !opts.foregroundBusy?.() && mind.setting('attention.inner') !== false
      && now() - lastChatAt >= (Number(mind.setting('attention.afterChatMinutes')) || 0) * 60000
      && !mind.body.state({ persist: false }).asleep
  }

  async function innerTick() {
    if (innerRunning || !canThink()) return null
    innerRunning = true
    try { return await thinkWhenIdle() } finally { innerRunning = false }
  }

  async function thinkWhenIdle() {
    const version = activityVersion
    const canCommit = () => activityVersion === version && canThink()
    const b = mind.body.state()
    const at = now()
    checkOutreachFn()
    const st = mind._store.get('inner.clock', { nextAt: 0, lastAt: 0 })
    if (at < st.nextAt) return null
    mind.inner.idleTick(st.lastAt ? Math.min(60, (at - st.lastAt) / 60000) : 0.5)
    const f = mind.feeling()
    const base = Number(mind.setting('attention.thoughtGapMinutes')) || 3
    let gap = base * (f.mood.a > 0.4 ? 0.6 : 1) * (b.energy < 0.3 ? 2 : 1) * (0.5 + (opts.random || Math.random)())
    if (!local.status().configured) gap *= 4
    mind._store.set('inner.clock', { nextAt: at + gap * 60000, lastAt: at })
    const share = Number(mind.setting('attention.wanderShare')) * (b.energy < 0.2 ? 0.3 : 1)
    let thought = null
    if ((opts.random || Math.random)() < share) {
      try { thought = await mind.inner.step({ canCommit }) } catch (error) { log.debug('想事出错：', error.message) }
    }
    if (!canCommit()) return null
    const pick = mind.motivation.choose({ body: mind.body.state(), mood: mind.feeling().mood, boredom: mind.inner.boredom() }, { soft: true })
    if (pick) runAction(pick.id).catch(() => {})
    return { thought, did: pick?.id || '' }
  }

  function recordAction(id, label, result) {
    if (!result?.ok || result.record !== true || !result.summary) return
    try {
      const at = now()
      mind.memory.insert({
        id: `action:${id}:${Math.floor(at / 60000)}`,
        at, window: '', gist: `自己${label}${result.summary ? `：${result.summary}` : ''}`,
        kind: 'event', speaker: 'self', importance: 0.35, attention: 1,
        extra: { actionId: id, action: true },
      })
    } catch (error) { log.debug('行动结果没记进记忆：', error.message) }
  }

  async function runAction(id, scheduled) {
    if (isClosed() || doing) return { ok: false, summary: '她正在做别的事' }
    const label = scheduled?.label || mind.motivation.state().actions.find((a) => a.id === id)?.label || id
    const controller = new AbortController()
    doing = { id, label, at: now(), controller }
    const enabled = () => opts.getConfig()?.enabled !== false
    const checkpoint = async () => {
      while (!isClosed() && !controller.signal.aborted && enabled() && !debug() && (opts.foregroundBusy?.() || now() - lastChatAt < 15_000 || mind.body.state({ persist: false }).asleep)) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      if (isClosed() || debug() || !enabled()) throw new Error('这件事已停止')
      controller.signal.throwIfAborted()
    }
    log.info(`她自己去${label}`)
    try {
      await checkpoint()
      const context = { checkpoint, signal: controller.signal, budgetBlocked: 0 }
      const r = await actionContext.run(context, () => scheduled ? scheduled.run(context) : mind.motivation.act(id, context))
      if (r?.ok && !scheduled) {
        mind.inner.relieve(0.5)
        recordAction(id, label, r)
      }
      return r
    } catch (error) {
      return { ok: false, summary: error.message }
    } finally {
      doing = null
    }
  }

  async function reserveActionModel(prompt) {
    const action = actionContext.getStore()
    if (!action) return null
    await action.checkpoint()
    const estimate = estimateTokens(prompt) + 1600
    const finish = mind.budget.reserve('action', estimate)
    if (!finish) {
      action.budgetBlocked = estimate
      throw Object.assign(new Error('今天的后台模型预算已用完'), { code: 'BUDGET' })
    }
    return (started, used) => { if (!isClosed()) finish(started ? used || estimate : undefined) }
  }

  function actionBudget(tokens = 1600) {
    const cap = Number(mind.setting('models.backgroundTokensDaily'))
    const estimate = Number.isFinite(tokens) ? Math.max(1600, tokens) : 1600
    return mind.budget.allow('action', estimate) ? true : cap === 0 ? '后台模型预算设为 0' : '今天的后台模型预算不足'
  }

  return { noteChatActivity, canThink, innerTick, runAction, reserveActionModel, actionBudget, doing: () => doing, abort: () => doing?.controller?.abort() }
}
