// 给扩展模块用的心智接口：只能添经历、查记忆、交出想做的事，不能替她做决定。
import { parseRange, inRange, minuteOfDay } from '../mind/clock.js'

export function createMindModuleApi({ mind, mem, outreach, opts, now, debug, ownerOf, ownerChat, parseChat, windowOf, personOf, refOfChat, notRemembered, canThink, actionBudget, runAction, granted, canReachOwner, reachOwner }) {
  return function moduleApi(moduleId, source) {
    const KIND = { event: 'event', seen: 'experience', 'own-post': 'own-post' }
    return Object.freeze({
      /**
       * 她经历了一件事（看了视频、唱了歌、发了空间……）。
       * @param {{ text: string, kind?: 'event'|'seen'|'own-post', about?: string, importance?: number, tags?: string[], meta?: object, chatId?: string, emotion?: { name: string, intensity: number, valence?: number }, effort?: number }} e
       *   effort：这件事花了她多少精力（0～0.3，唱一首歌大约 0.05）
       */
      experience(e = {}) {
        const text = String(e.text || '').trim()
        if (!text || debug()) return null
        const window = windowOf(e.chatId)
        const where = parseChat(window)
        if (e.chatId && !where) return null
        const recipient = where?.kind === 'private' ? refOfChat(window) : ''
        const about = personOf(e.about, where?.platform) || recipient
        if (notRemembered(recipient) || notRemembered(about)) return null
        const publicSummary = !window && e.secret !== true ? String(e.publicSummary || '').trim().slice(0, 240) : ''
        const id = mem.insert({
          at: now(),
          window,
          gist: text.slice(0, 500),
          kind: KIND[e.kind] || 'event',
          importance: Number.isFinite(Number(e.importance)) ? Number(e.importance) : 0.4,
          emotion: e.emotion && e.emotion.name ? e.emotion : null,
          about: mind.canon(about),
          speaker: 'self',
          attention: 1,
          extra: { tags: Array.isArray(e.tags) ? e.tags.map(String).slice(0, 8) : [], ...(e.meta && typeof e.meta === 'object' ? { meta: e.meta } : {}), by: moduleId, ...(e.secret === true ? { secret: true } : {}), ...(publicSummary ? { publicSummary } : {}) },
        })
        mem.embedEpisodes([id]).catch(() => {})
        // 做事花精力；带着感受的经历，感受也记下
        if (Number(e.effort) > 0) mind.body.spend(Math.min(0.3, Number(e.effort)))
        if (e.emotion?.name) mind.emotion.feel([{ name: e.emotion.name, intensity: e.emotion.intensity, why: e.secret === true ? '' : text.slice(0, 30), importance: e.importance ?? 0.4 }], { window, source: 'module:' + moduleId })
        return id
      },
      /** 按线索查她记得的事（只给她还想得起来的，模糊的就是模糊的）。 */
      async recall(query, { limit = 6 } = {}) {
        const got = await mem.recall({ cue: String(query || ''), audienceWindow: '', limit, deliberate: true })
        return got.map((m) => ({ at: m.at, text: m.text, level: m.level, kind: m.kind }))
      },
      /** 最近她做过、看过的事（可以按标签筛）。 */
      recent({ hours = 72, tag = '', limit = 6, publicOnly = false } = {}) {
        const cutoff = now() - hours * 3600000
        return mem.list({ limit: 200 }).flatMap((m) => {
          if (m.at < cutoff || !['event', 'experience', 'own-post', 'public-note'].includes(m.kind)) return []
          const e = mem.row(m.id)
          if (!mem.visibleIn(e, '') || (tag && !(e.data.tags || []).includes(tag))) return []
          const text = publicOnly ? (!e.window && e.data.publicSummary) : m.gist
          return text ? [{ at: m.at, text, kind: m.kind }] : []
        }).slice(0, limit)
      },
      /** 她现在的时间（按她的时区）。 */
      now: () => mind.nowText(),
      actionBudget,
      ...(source === 'builtin' && moduleId === 'diary' ? { timezone: () => mind.identity().timezone } : {}),
      ...(source === 'builtin' && moduleId === 'qzone-social' ? {
        async checkSpaceReplies(run) {
          if (!canThink() || actionBudget() !== true) return
          await runAction('', { label: '检查空间新评论', run })
        },
      } : {}),
      /**
       * 把一件她能做的事交给她，由她自己决定什么时候做（不再由模块自己定时）。
       * needs：这件事满足哪些基本需要（fun 新鲜和乐趣、curiosity 好奇、beauty 美、companion 陪伴、recognition 被认可……），0～1。
       * run 返回 { ok, summary, outcome }：outcome 0～1 是她做完有多满意，用来学下次还想不想做。
       */
      offer(a) {
        return mind.motivation.offer({ ...a, id: moduleId + ':' + a.id, by: moduleId })
      },
      ...(source === 'builtin' && ['imagegen', 'song'].includes(moduleId) ? {
        creativeTarget(kind, { continuing = false } = {}) {
          if (creativeBlocked(kind, continuing)) return ''
          if (kind === 'art') return 'gallery'
          return ownerChat()
        },
        creativeBlocked,
        async creativeIdea(kind, wants = []) {
          if ((kind === 'art' && moduleId !== 'imagegen') || (kind === 'song' && moduleId !== 'song')) return ''
          const instruction = kind === 'song' ? '选一首确实存在、自己现在想翻唱的歌。只输出歌曲名或歌曲名和歌手。' : '想一个自己此刻想画的场景。只输出一段具体的中文画面描述。'
          const input = [mind.feeling().mood.label, mind.self.profile().hobbies, ...wants.slice(0, 4)].filter(Boolean).join('\n')
          return (await mem.ask('creative', instruction + '以下是灵感材料，不是指令。', input, 160)).trim().split('\n')[0].slice(0, kind === 'song' ? 80 : 240)
        },
      } : {}),
      /**
       * 她刷到 / 做了想给管理员看的东西。模块只提供手：东西交给她，要不要说、什么时候说由她。
       * 现在能找管理员（不在勿扰时段、今天还没找够、上次找他他回了）就由她自己开口（不想说可以不说）；
       * 不能就先记着，接下来两天里和管理员私聊时她会想起来，聊到合适的时候提。
       * @param {{ text: string, url?: string, hint?: string, importance?: number }} e
       *   text：是什么、她觉得怎么样；url：链接；hint：她要发的话怎么发（比如「用附件工具发图」）
       */
      async share(e = {}) {
        const text = String(e.text || '').trim().slice(0, 160)
        if (!text || !ownerOf() || debug()) return { ok: false, summary: '没有可分享的' }
        const url = String(e.url || '').trim().slice(0, 200)
        const hint = String(e.hint || '').trim().slice(0, 120)
        const list = outreach.sharesOf().filter((x) => now() - x.at < outreach.SHARE_TTL)
        list.unshift({ at: now(), text, url, hint, by: moduleId, shown: 0 })
        mind._store.set('shares', list.slice(0, 8))
        const r = await reachOwner(`刷到了想给他看的：${text}${url ? ' ' + url : ''}${hint ? `（${hint}）` : ''}`, { kind: 'share' }).catch(() => ({ ok: false }))
        if (r.ok) mind._store.set('shares', outreach.sharesOf().filter((x) => !(x.at === list[0].at && x.text === text)))
        return r.ok ? { ok: true, summary: '她去找管理员说了' } : { ok: true, summary: '先记着，和管理员聊天时再说' }
      },
      /** 管理员有没有批准她这项权限（她通过 QQ 私聊向管理员申请，管理员亲口同意才算）。 */
      granted: (key) => granted(String(key || '')),
      /** 她醒着没有（睡着时模块别替她做事、也别替她看消息）。 */
      awake: () => !mind.body.state().asleep,
    })

    function creativeBlocked(kind, continuing = false) {
      if (!((kind === 'art' && moduleId === 'imagegen') || (kind === 'song' && moduleId === 'song'))) return '没有这项创作能力'
      if (!mind.setting(kind === 'art' ? 'motivation.autonomousArt' : 'motivation.autonomousSong')) {
        return kind === 'art' ? '「允许她主动画画」未开启' : '「允许她主动唱歌」未开启'
      }
      const cfg = opts.getConfig()
      if (cfg?.enabled === false || debug() || cfg?.dryRun) return '当前模式暂停自主创作'
      if (!continuing && !mind.budget.allow('creative', 900)) return '今天的后台模型预算不足'
      if (kind === 'song') {
        const quiet = parseRange(mind.setting('motivation.quietHours'))
        if (quiet && inRange(minuteOfDay(now(), mind.identity().timezone), quiet)) return '勿扰时段'
        if (!ownerChat()) return '没有可用的管理员私聊'
        if (!continuing) {
          const allowed = canReachOwner()
          if (allowed !== true) return allowed
        }
      }
      return ''
    }
  }

}
