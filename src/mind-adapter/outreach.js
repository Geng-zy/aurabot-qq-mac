// 主动联系管理员、分享排队和“上次找你还没回”的状态。
import { estimateTokens } from '../mind/budget.js'
import { inRange, minuteOfDay, parseRange } from '../mind/clock.js'

export function createOutreach({ mind, opts, ownerOf, ownerChat, parseChat, now, debug, isClosed }) {
  const SHARE_TTL = 2 * 86400000
  const sharesOf = () => { const v = mind._store.get('shares', []); return Array.isArray(v) ? v : [] }

  /** 和管理员私聊时想起来的「之前想给他看的」：每条最多想起两次，两天后就算了。 */
  function pendingShares() {
    const list = sharesOf().filter((x) => now() - x.at < SHARE_TTL && x.shown < 2)
    if (!list.length) return ''
    mind._store.set('shares', list.map((x) => ({ ...x, shown: x.shown + 1 })))
    return '（你之前刷到、想给他看的：' + list.slice(0, 4).map((x) => x.text + (x.url ? ' ' + x.url : '') + (x.hint ? `（${x.hint}）` : '')).join('；') + '。聊到合适的时候可以提，不提也行。）'
  }

  function outreachState() {
    return mind._store.get('outreach', { pending: null, day: '', count: 0, log: [] })
  }

  let lastOwnerAt = 0
  let reachingOwner = false
  function noteContact(at) { lastOwnerAt = Math.max(lastOwnerAt, Number(at) || 0) }
  const lastContact = () => lastOwnerAt

  /** 能不能找：勿扰时段、每天上限、上次找你还没回就不追着发。 */
  function canReachOwner() {
    if (!ownerOf() || typeof opts.reachOut !== 'function') return '没有管理员'
    if (opts.getConfig()?.enabled === false || opts.getConfig()?.dryRun || debug()) return '当前模式暂停主动联系'
    if (reachingOwner) return '正在准备上一条主动消息'
    const o = outreachState()
    if (o.pending) return '上次找你还没回'
    const tz = mind.identity().timezone
    const quiet = parseRange(mind.setting('motivation.quietHours'))
    if (quiet && inRange(minuteOfDay(now(), tz), quiet)) return '勿扰时段'
    const cap = Number(mind.setting('motivation.dailyOutreachCap')) || 0
    if (cap && o.day === mind.today() && o.count >= cap) return '今天找够了'
    if (now() - lastOwnerAt < 30 * 60000) return '刚和你聊过'
    return true
  }

  /** 让她主动找你：给她一句由头，话由她自己说（不想说可以不说）。 */
  async function reachOwner(reason, { kind = 'miss' } = {}) {
    const chatId = ownerChat()
    if (!chatId || typeof opts.reachOut !== 'function') return { ok: false, summary: '没有可用的管理员私聊' }
    if (reachingOwner) return { ok: false, summary: '正在准备上一条主动消息' }
    if (opts.getConfig()?.enabled === false || opts.getConfig()?.dryRun || debug()) return { ok: false, summary: '当前模式暂停主动联系' }
    const ok = canReachOwner()
    if (ok !== true && kind !== 'permission') return { ok: false, summary: ok }
    const why = String(reason || '想你了').slice(0, 200)
    const note = kind === 'permission'
      ? `【心里的打算，不是管理员说的话】${why}`
      : `【心里的打算，不是管理员说的话】你想主动找管理员说话。由头：${why}。用你自己的口气，一两句就好；只用真实发生过的事，不要编；觉得他在忙或者其实不想说，就只回 [沉默]。`
    const estimate = estimateTokens(note) + 1600
    const budget = kind === 'permission' ? null : mind.budget.reserve('action', estimate)
    if (kind !== 'permission' && !budget) return { ok: false, summary: '今天的后台模型预算不足', deferred: true }
    const startedAt = now()
    reachingOwner = true
    try {
      const receipt = await opts.reachOut({ chatId, userId: parseChat(chatId).id, note })
      if (isClosed()) return { ok: false, summary: '主动联系已停止' }
      if (receipt?.tokens || receipt?.delivered || receipt === true) budget?.(receipt.tokens || estimate)
      if (receipt !== true && receipt?.delivered !== true) return { ok: false, summary: '没有确认发出主动消息' }
      const o = outreachState()
      const at = now()
      if (o.day === mind.today()) o.count++
      else { o.day = mind.today(); o.count = 1 }
      if (lastOwnerAt < startedAt) o.pending = { at, reason: why, kind }
      o.log = [{ at, reason: why, kind }, ...o.log].slice(0, 75)
      mind._store.set('outreach', o)
      return { ok: true, summary: why, outcome: 0.5 }
    } catch (error) {
      return { ok: false, summary: error.code === 'BUDGET' ? '今天的后台模型预算不足' : '主动消息未发出', deferred: error.code === 'BUDGET' }
    } finally {
      if (!isClosed()) budget?.()
      reachingOwner = false
    }
  }

  /** 你回了：开心，下次更愿意找你；一直没回：有点失落，不再追着发。 */
  function checkOutreach(contactAt = 0, live = false) {
    const o = outreachState()
    if (!o.pending) return
    const wait = (Number(mind.setting('motivation.outreachWaitHours')) || 2) * 3600000
    if (contactAt > 0 && contactAt >= (live ? Math.floor(o.pending.at / 1000) * 1000 : o.pending.at)) {
      if (o.pending.kind !== 'permission') {
        mind.motivation.feedback('reach_owner', 0.9)
        mind.emotion.feel([{ name: '快乐', intensity: 0.4, target: ownerOf(), why: '找他，他回了', importance: 0.4 }], { source: 'outreach' })
      }
      o.pending = null
    } else if (now() - o.pending.at > wait) {
      if (o.pending.kind !== 'permission') {
        mind.motivation.feedback('reach_owner', 0.2)
        mind.emotion.feel([{ name: '失落', intensity: 0.4, target: ownerOf(), why: '找他，他没回', importance: 0.4 }], { source: 'outreach' })
      }
      o.pending = null
    } else return
    mind._store.set('outreach', o)
  }

  return { SHARE_TTL, sharesOf, pendingShares, outreachState, canReachOwner, reachOwner, checkOutreach, noteContact, lastContact }
}
