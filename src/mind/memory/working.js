// 工作记忆、跟谁说过什么、特意记下来。
export function createWorking({ store, now, S, deps, recall, row, visibleIn, visibleForRecall, save, keywords, markAsked, strengthen, dueIntentions, dueFollowups, memorySummary, specialDays, visibleOriginalLines, embedText, vectors, embedModel, sharesIn, insert, queueJob, hash, nameOf, dayKey, shortTime }) {
  // ---------- 跟谁说过什么 ----------
  const lastRecalled = new Map() // window → 这一轮想起来的内容和待确认的跟进事项
  /**
   * 她在一个窗口里说了一句话：这一轮想起来的事里被她说出口的，记下「跟谁说过」（以后同一个人面前不再当新鲜事讲）。
   * audience：在场的人（id）。按事情里的关键词在她的话里出现了多少判断。
   */
  function noteSaid({ window, text, audience = [] }) {
    const list = (lastRecalled.get(window) || []).filter((x) => now() - x.at < 30 * 60000)
    const said = String(text || '')
    if (!list.length || !audience.length || !said.trim()) return []
    const out = []
    const questions = said.split(/[。！!\n]/u).flatMap((line) => {
      const parts = line.match(/[^？?]+[？?]/gu) || []
      return /[吗麼么没呢][。\s]*$/u.test(line.trim()) ? [...parts, line.slice(Math.max(line.lastIndexOf('？'), line.lastIndexOf('?')) + 1)] : parts
    })
    for (const x of list) {
      const e = row(x.id)
      if (!visibleForRecall(e)) continue
      const f = e.data.followup
      if (x.followup && S('followup') !== false && e.status === 'live' && f && !f.done && f.nextAt <= now() &&
          audience.includes(e.data.about) && questions.some((line) => x.followup.terms.some((term) => line.includes(term)))) {
        markAsked(e, x.followup.care)
      }
      if (!x.recalled) continue
      const ks = keywords(e.gist, { limit: 10 })
      if (!ks.length) continue
      const hit = ks.filter((k) => said.includes(k.w)).length
      if (hit < Math.min(2, ks.length) || hit / ks.length < 0.35) continue
      e.data.toldTo = { ...(e.data.toldTo || {}) }
      for (const p of audience) if (p && p !== 'self') e.data.toldTo[p] = now()
      save(e)
      out.push(e.id)
    }
    return out
  }

  // ---------- 每年的日子 ----------
  /**
   * 今天（和接下来 within 天）有哪些日子：记下来的生日、纪念日，以及和亲近的人认识满一年、两年……
   * @returns {Array<{ text: string, about: string, inDays: number, owner: boolean, self: boolean, kind: string }>}
   */
  /**
   * 这一轮的工作记忆：想起来的事 + 惦记着的要做的事，按字数上限裁。
   * 想起来的会被加强（她真的想起来了）。
   */
  async function workingMemory({ cue, contextCue, window, people = [], readOnly = false, isCurrent = () => true, limit, embeddingTimeoutMs, compact = false } = {}) {
    const max = Number(S('workingChars')) || 4000
    const got = await recall({ cue, contextCue, window, people, embeddingTimeoutMs, audienceWindow: window || '', limit, compact })
    if (!isCurrent()) return { text: '', recalled: [] }
    const lines = []
    let total = 0
    const used = []
    for (const m of got) {
      if (limit !== undefined && used.length >= limit) break
      const when = dayKey(m.at, deps.tz())
      const note = m.secret ? '（秘密，别往外说）' : ''
      // 跟眼前的人说过这件事了：别当新鲜事再讲一遍
      const told = people.filter((p) => m.toldTo?.[p]).map((p) => `${nameOf(p)}（${shortTime(m.toldTo[p], deps.tz()).slice(0, 5)}）`)
      const toldNote = told.length ? `（这事你已经跟${told.join('、')}说过了）` : ''
      const ref = compact && (m.level !== 'tip' || m.kind === 'pending') ? ` [${m.id}]` : ''
      const line = `- ${when} ${m.associated ? '（由此想到）' : ''}${m.text}${note}${toldNote}${ref}`
      if (total + line.length > max) break
      total += line.length
      lines.push(line)
      used.push(m.id)
    }
    const todo = dueIntentions({ window, audienceWindow: window || '' }).map((e) => `- ${e.gist}${e.data.due ? `（${shortTime(e.data.due, deps.tz())} 前）` : ''}`)
    // 在场的人有到了该问的事：提一句，问过就往后推（调试模式只看不推）
    const follow = dueFollowups({ people, audienceWindow: window || '', cue, contextCue })
    const asks = follow.map(({ e }) => `- ${dayKey(e.at, deps.tz())} ${nameOf(e.data.about)}当时提到：${memorySummary(e, e.gist)} [${e.id}]`)
    // 记下这一轮想起了什么：她接下来说出口的，算「跟这里的人说过了」
    if (!readOnly && window) {
      const at = now()
      const entries = new Map(got.filter((m) => used.includes(m.id) && m.level !== 'tip').map((m) => [m.id, { id: m.id, at, recalled: true }]))
      const cueTerms = follow.length ? keywords([cue, contextCue].filter(Boolean).join('\n')) : []
      for (const { e, care } of follow) {
        const source = e.gist + '\n' + (e.detail || '')
        const terms = cueTerms.map(({ w }) => w).filter((w) => source.includes(w))
        if (terms.length) entries.set(e.id, { id: e.id, at, ...entries.get(e.id), followup: { care, terms } })
      }
      if (entries.size) lastRecalled.set(window, [...entries.values()])
      else lastRecalled.delete(window)
    }
    // 今天和快到的日子（生日、纪念日、认识几周年）：眼前的人的、管理员的、她自己的
    const days = specialDays({ within: 3, audienceWindow: window || '' }).filter((d) => d.self || d.owner || people.includes(d.about))
    // readOnly（调试模式）：只想起来，不加强、不重新点燃情绪，不留下痕迹
    if (used.length && !readOnly) {
      strengthen(used)
      // 想起带着情绪的事，当时的情绪会重新冒出来一点
      try { deps.onRecalled?.(got.filter((m) => used.includes(m.id) && m.level !== 'tip'), { window }) } catch {}
    }
    const parts = []
    if (lines.length) parts.push('【你想起来的】\n' + lines.join('\n'))
    // 对方主动提到未决事项时，给她少量原话对照，避免只照摘要转述。
    const pending = got.find((m) => m.kind === 'pending' && used.includes(m.id))
    if (pending && window) {
      const entry = row(pending.id)
      const evidence = visibleOriginalLines(entry, window).filter((line) => line.dir === 'in' && line.who === entry.data.about
        && line.text && !/^\[[^\]]+\]$/.test(line.text.trim())).slice(0, 8)
      if (evidence.length) {
        const tz = deps.tz()
        const excerpts = evidence.map((line) => `- ${dayKey(line.at, tz)} ${shortTime(line.at, tz).slice(6)} ${nameOf(line.who)}：${line.text.replace(/\s+/g, ' ').slice(0, 100)}`)
        parts.push(`【待跟进事项原话 · ${pending.id}】\n` + excerpts.join('\n'))
      }
    }
    if (days.length) parts.push('【日子】\n' + days.map((d) => '- ' + d.text).join('\n'))
    if (todo.length) parts.push('【你惦记着要做的事】\n' + todo.join('\n'))
    if (asks.length) parts.push('【你惦记着别人的事，还不知道结果】\n' + asks.join('\n') + '\n（这些是当时提过的问题。只有这轮确实在聊同一件事时才跟进；被问到日期或进度，先用 mind_recall_more 核对原话。不确定就先澄清。知道结果或对方说别问了，就用 mind_followup_done 放下。）')
    return { text: parts.join('\n'), recalled: [...new Set([...used, ...follow.map(({ e }) => e.id)])] }
  }

  // ---------- 她特意记下来 ----------
  async function remember({ text, window = '', about = '', importance = 0.8 } = {}) {
    const gist = String(text || '').trim()
    if (!gist) throw new Error('要记的内容是空的')
    const qv = await embedText(gist)
    if (qv) {
      const hit = vectors.search(qv, { model: embedModel(), limit: 1, min: 0.9, filter: (id) => visibleForRecall(row(id)) })[0]
      if (hit) {
        const e = row(hit.id)
        if (e && e.status !== 'deleted') {
          if (e.status === 'archived') { e.status = 'live'; save(e) }
          strengthen([e.id])
          return { id: e.id, merged: true }
        }
      }
    }
    const audienceShares = sharesIn(window).map((e) => e.id)
    const id = insert({ at: now(), window, gist, kind: 'noted', importance, about, speaker: 'self', attention: 1,
      extra: audienceShares.length ? { audienceOnly: true, audienceShares } : {} })
    if (qv) vectors.put(id, embedModel(), qv, hash(gist))
    else queueJob('embed', id)
    return { id, merged: false }
  }


  return { noteSaid, workingMemory, remember }
}
