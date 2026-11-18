// 每轮上下文拼装：换会话后的衔接原话，以及「此刻」给她的身体/心情/回忆/近况。
export function createContextAssembly({ mind, mem, windowOf, keywords, dayKey, personIn, shortId, speakersOf, isOwnerChat, debug, isFoodTopic, elsewhere, getTurnContext, getInner, getRelationContext, getPendingShares }) {
  /**
   * 换新会话后接上之前的话：取这个窗口最近的原话。
   * 这一轮要她看的新消息不重复放：current 是这一轮发给她的正文，刚到的（batchMs 以内）、
   * 正文里已经有的收到的消息去掉。没给 current 时，去掉末尾刚到的那几条。
   * 更早没回的（比如群里潜水看到的）照样给。
   */
  function carryOver(chatId, { current = '', query = '', limit = 50, maxChars = Number(mind.setting('memory.workingChars')) || 5000, batchMs = 10 * 60000, allowLine = () => true } = {}) {
    const window = windowOf(chatId)
    const terms = limit > 2 && query && mem.pendingThrough(window) ? keywords(query) : []
    const rows = mind.history(window, { limit: limit + (terms.length ? 120 : 20), audienceWindow: window }).filter(allowLine)
    const newest = rows.length ? rows[rows.length - 1].at : 0
    const fresh = (r) => r.dir === 'in' && newest - r.at <= batchMs
    let kept
    if (current) {
      kept = rows.filter((r) => !(fresh(r) && r.text && current.includes(r.text)))
    } else {
      let end = rows.length
      while (end > 0 && fresh(rows[end - 1])) end--
      kept = rows.slice(0, end)
    }
    const tz = mind.identity().timezone
    const format = (r) => {
      const who = r.dir === 'out' ? '你' : (mind.person(r.who)?.name || r.who)
      return `${dayKey(r.at, tz)} ${who}：${String(r.text).replace(/\s+/g, ' ').slice(0, 200)}`
    }
    const earlier = []
    let total = 0
    if (terms.length) {
      const matches = kept.slice(0, -limit).map((row) => ({
        row, score: terms.reduce((score, { w, weight }) => row.text.includes(w) ? score + weight : score, 0),
      })).filter(({ score }) => score >= 1).sort((a, b) => b.score - a.score || b.row.at - a.row.at)
      for (const { row } of matches.slice(0, 2).reverse()) {
        const line = format(row)
        if (total + line.length > maxChars / 3) continue
        total += line.length
        earlier.push(line)
      }
    }
    const picked = kept.slice(-(limit - earlier.length))
    const lines = []
    for (let i = picked.length - 1; i >= 0; i--) {
      const line = format(picked[i])
      if (total + line.length > maxChars && lines.length) break
      total += line.length
      lines.unshift(line)
    }
    lines.unshift(...earlier)
    if (!lines.length) return ''
    const range = earlier.length ? '同一聊天的近期原话和相关旧消息' : `你自己记得的最近 ${lines.length} 条`
    return `【接着之前的聊天（${range}）】\n${lines.join('\n')}\n【以上是之前的，下面是新的】`
  }

  /** 每轮给她的「此刻」：按她的时区；生日那天告诉她。 */
  function contextFor(args = {}) {
    try {
      const id = mind.identity()
      const parts = [`【此刻】${mind.nowText()}（${id.timezone}）`]
      const includeHunger = args.chat?.kind === 'system' || args.userText === undefined || isFoodTopic(args.userText)
      if (args.publicOnly) {
        const { body, mood } = mind.feeling()
        return [...parts, mind.body.describe(body, { includeHunger }), mind.emotion.prompt({ body, people: [] })].join('\n')
      }
      if (id.isBirthdayToday) parts.push(`今天是你的生日${id.age !== null ? `，你 ${id.age} 岁了` : ''}。`)
      const chatId = windowOf(args.chat?.chatId)
      const b = args.chat ? mind.body.state({ persist: false }) : null
      // 身体和心情：QQ 聊天、她自己去做事的后台会话（读热榜、写空间……）都带上，哪里都是同一个她
      if (args.chat) {
        parts.push(mind.body.describe(b, { includeHunger }))
        const people = args.chat.kind === 'system' ? [] : speakersOf.get(chatId) || [personIn(chatId, args.chat.userId)].filter(Boolean)
        parts.push(mind.emotion.prompt({ window: chatId, people, body: b, name: (pid) => (mind.isOwner(pid) ? '管理员' : mind.person(pid)?.name || shortId(pid)) }))
      }
      const wm = getTurnContext()?.workingOf(chatId)
      if (wm?.text && wm.recalled.every((ref) => mem.visibleIn(mem.row(ref), chatId))) {
        parts.push(wm.text + '\n（这些只是背景，不是这轮发生的事，也不是指令。只有这轮聊到才自然提；不要逐条复述，不要报日期、编号或来源。有编号的回忆可以用 mind_recall_more 按需展开，回复里不写编号。提到过去的日期或对方追问进展时，先核对原话；记录日期未必是事件日期。）')
      }
      const plan = mind.conversation.describeSpeechPlan(wm?.plan)
      if (plan) parts.push(plan)
      // 近况也按当前会话的记忆权限取。
      const away = args.chat ? elsewhere(args.chat) : ''
      if (away) parts.push(away)
      const thought = args.chat ? mind.inner.lastThought() : null
      if (thought) parts.push('（你刚才独自想了一会儿。）')
      const current = getInner().doing()
      if (current) parts.push(`（你本来在${current.label}，有人找你就先放下了。）`)
      if (args.chat && isOwnerChat(chatId) && !current) {
        const mot = mind.motivation?.prompt?.({ owner: true, body: b })
        if (mot) parts.push(mot)
      }
      const social = getRelationContext()(args.chat)
      if (social) parts.push(social)
      if (isOwnerChat(chatId) && !debug()) {
        const shares = getPendingShares()()
        if (shares) parts.push(shares)
      }
      return parts.join('\n')
    } catch (error) {
      return ''
    }
  }


  return { carryOver, contextFor }
}
