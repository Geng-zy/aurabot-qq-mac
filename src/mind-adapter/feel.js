// 投喂和 <feel> 感受：喂了什么、收走感受标记、写进情绪和经历。
import { naturalFoodOffer } from './feeding.js'

export function createFeel({ mind, mem, now, debug, syncOwner, windowOf, parseChat, personIn, notRemembered, refOfChat, isOwnerChat, shortId, naturalFoodOffer: naturalFoodOfferFn, parsePerson, LEGACY_PLATFORM }) {
  const naturalFoodOffer = naturalFoodOfferFn
  let lastFeed = null
  function feed(food, giver = '', chatId = '') {
    syncOwner()
    const what = [...String(food || '').trim()].slice(0, 40).join('').trim() || '好吃的'
    const by = mind.canon(personIn(chatId, giver))
    // 同一个人两分钟内喂同一样东西只算一次（/投喂 之后她在回复里又说了一遍）
    if (lastFeed && lastFeed.by === by && lastFeed.food === what && now() - lastFeed.at < 120000) return { ok: true, food: what, duplicate: true, message: '刚喂过了' }
    lastFeed = { by, food: what, at: now() }
    const owner = by && mind.isOwner(by)
    const r = mind.body.feed(what, by)
    mind.motivation.satisfyWants('eat')
    if (notRemembered(by)) return { ok: true, food: what, before: r.before, after: r.after, message: '她收下了' }
    const name = by ? (owner ? '管理员' : mind.person(by)?.name || shortId(by)) : ''
    mem.insert({ at: now(), window: chatId ? windowOf(chatId) : '', gist: `${name || '有人'}给我吃了${what}`, kind: 'event', importance: owner ? 0.6 : 0.4, about: by, speaker: 'self', attention: 1, extra: { tags: ['投喂'], fed: what } })
    mind.emotion.feel([
      { name: '快乐', intensity: owner ? 0.5 : 0.3, why: `吃了${what}`, importance: 0.4 },
      ...(by ? [{ name: '感激', intensity: owner ? 0.5 : 0.3, target: by, why: `给我吃了${what}`, importance: 0.4 }] : []),
    ], { window: chatId ? windowOf(chatId) : '', source: 'feed' })
    if (by) {
      const p = mind.person(by)
      if (p) { p.fedCount = (p.fedCount || 0) + 1; mind._store.prep('UPDATE people SET json = ? WHERE id = ?').run(JSON.stringify(p), by) }
    }
    return { ok: true, food: what, before: r.before, after: r.after, message: r.before < 0.3 ? `喂了${what}（她本来不太饿，也收下了）` : `喂了${what}，她不饿了` }
  }

  // ---------- 她的感受：回复里的 <feel>，发出去之前收走 ----------
  function latestFoodOffer(window, giver) {
    return naturalFoodOffer(mind.history(window, { since: now() - 3 * 60000, limit: 20 }), mind.canon(giver))
  }

  function fedSince(offer) {
    return (mind.body.state({ persist: false }).lastMeal?.at ?? -Infinity) >= offer.at
  }

  function confirmReplyFeed(chatId, { food, giver, at }) {
    if (debug() || !giver || !food || !Number.isFinite(at) || notRemembered(giver) || fedSince({ at })) return
    feed(food, giver, chatId)
  }

  /**
   * 从她的回复里收走 <feel>…</feel>（别人看不到），记下情绪；里面说有人给她吃的就算投喂。
   * @returns {string} 去掉 <feel> 后的回复
   */
  function feel(chatId, text, { senders = [], deferFeed } = {}) {
    const raw = String(text || '')
    const blocks = [...raw.matchAll(/<feel>([\s\S]*?)<\/feel>/gi)]
    const clean = raw.replace(/<feel>[\s\S]*?<\/feel>/gi, '').replace(/<feel>[\s\S]*$/i, '').trim()
    if (debug()) return clean // 调试：感受照样收走（不发出去），但不记
    const window = windowOf(chatId)
    const where = parseChat(window)
    if (!where) return clean
    const speakers = [...new Set(senders.map((id) => personIn(window, id)).filter(Boolean))]
    if (speakers.some(notRemembered) || (where.kind === 'private' && notRemembered(refOfChat(window)))) return clean
    for (const b of blocks) {
      let j
      try { j = JSON.parse(b[1].trim()) } catch { continue }
      const list = Array.isArray(j) ? j : Array.isArray(j?.e) ? j.e : []
      const asId = (w) => {
        const v = String(w ?? '').trim()
        if (!v || v === 'self' || v === '自己') return ''
        const target = parsePerson(v, where.platform)
        if (target?.platform !== where.platform || (where.platform === LEGACY_PLATFORM && !/^\d{1,15}$/.test(target.id))) return ''
        return personIn(window, v)
      }
      const feelings = list.map((x) => ({ name: x?.n ?? x?.name, intensity: x?.i ?? x?.intensity, target: mind.canon(asId(x?.who)), why: x?.why, importance: x?.imp, reg: x?.reg, src: x?.src }))
      mind.emotion.feel(feelings.filter((item) => !notRemembered(item.target)), { window, source: 'reply' })
      // 投喂只认这一轮真的在跟她说话的人
      const fed = j && !Array.isArray(j) ? j.fed : null
      if (fed && fed.food) {
        const by = String(fed.by ?? '').trim()
        // 写了是谁给的，就必须是这一轮在跟她说话的人；没写、这一轮又只有一个人，就是那个人
        const giver = by ? speakers.find((id) => id === asId(by)) : speakers.length === 1 ? speakers[0] : ''
        const offer = giver && isOwnerChat(chatId) ? latestFoodOffer(window, giver) : null
        if (giver) {
          const pending = { food: [...String(offer?.food || fed.food).trim()].slice(0, 40).join(''), giver, at: offer?.at ?? now() }
          if (deferFeed) deferFeed(pending)
          else confirmReplyFeed(chatId, pending)
        }
      }
    }
    return clean
  }

  /** 给她的规矩：怎么写 <feel>（通用说法，不针对某个角色）。 */
  function rules() {
    return [
      '【感受】你的回复最后可以加一段 <feel>…</feel>，只给系统看，别人看不到。「此刻的感受」里已有的情绪已经记下，只写回复过程中新增或主动调节的感受。格式：<feel>{"e":[{"n":"情绪名","i":0到1的强度,"who":"对方在当前渠道的账号（自己或没有就留空）","why":"十个字以内的原因","imp":这件事对你多重要0到1}]}</feel>。',
      '判断感受时想一想：这事和你在乎的人和事有关吗；对你是好事还是坏事；是谁造成的、是不是故意的；你应付得了吗；意外吗；和你认为对的事合不合。气是冲着谁的就写谁，不要把对别人的气写到眼前的人身上。',
      '情绪名用常见的说法，比如 快乐、难过、生气、害怕、焦虑、好笑、兴奋、满足、平静、松一口气、期待、感动、喜爱、感激、心疼、羡慕、委屈、尴尬、害羞、内疚、失落、无聊、烦躁、想撒娇。你在调节情绪时可以加 "reg"：reappraise 换个角度想 / suppress 忍着不表现 / distract 转移注意 / share 找人说 / ruminate 反复想；被群里气氛带动的加 "src":"contagion"。',
      '对方这一段确实递给你吃的或喝的，且你收下时，在 <feel> 里加 "fed":{"food":"食物名","by":"给你的人的账号"}。只讨论口味、表示想吃、答应以后再给，或者已经记下过的食物，都不用加。',
    ]
  }


  return { feed, feel, rules, confirmReplyFeed }
}
