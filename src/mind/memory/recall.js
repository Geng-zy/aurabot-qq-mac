// 按线索想起：向量、关键词、身边人、时间范围、精排和联想扩散。
const DAY = 86400000

export function createRecall({ store, now, S, getState, embedText, vectors, embedModel, keywordHits, row, visibleIn, visibleForRecall, visibleForAudience, rOf, levelOf, levels, getRerank, log, deps, render, hasSecretScope }) {
  // ---------- 想起 ----------
  /**
   * 按线索想起。
   * @param {{ cue: string, window?: string, people?: string[], limit?: number, deliberate?: boolean }} q
   *   deliberate：她自己在使劲想（翻记忆），线索门槛放低一点。
   */
  /**
   * period：{ start, end } 只想这段时间里的事（end 不含）。线索空着就按重要程度列这段时间的事。
   */
  async function recall({ cue, contextCue = '', window = '', audienceWindow, people = [], embeddingTimeoutMs, limit = Number(S('recallLimit')), deliberate = false, period = null, compact = false } = {}) {
    if (!limit) return []
    const at = now()
    const inPeriod = (e) => !period || (e.at >= period.start && e.at < period.end)
    const st = getState() || {}
    const cueMatch = Number(S('cueMatch')) * (deliberate ? 0.85 : 1)
    const cand = new Map() // id → sim
    // 只给了时间没给线索：这段时间里的事都算线索，按重要程度排
    const datedOverview = period && period.end - period.start > 2 * DAY && !String(cue || '').trim()
    const archivedReviews = new Set()
    if (period && !String(cue || '').trim()) {
      // 问的是好几天以上：那段时间的回顾（每天、每周、每月写的）排在最前面，一段话就能想起个大概
      const long = period.end - period.start > 2 * DAY
      for (const r of store.prep("SELECT id, kind, json FROM episodes WHERE status = 'live' AND at >= ? AND at < ? ORDER BY at DESC LIMIT 200").all(period.start, period.end)) {
        let imp = 0.4
        try { imp = Number(JSON.parse(r.json).importance) || 0.4 } catch {}
        // 越大的回顾越靠前（月 > 周 > 天）；只问一天时不用回顾，直接想那天的事
        const bonus = { 'day-summary': 0.2, 'week-summary': 0.3, 'month-summary': 0.4 }[String(r.kind || '')]
        cand.set(r.id, cueMatch + 0.2 * imp + (bonus ? (long ? bonus : -0.1) : 0))
      }
      if (datedOverview) {
        for (const r of store.prep("SELECT id, status FROM episodes WHERE kind IN ('week-summary', 'month-summary', 'day-summary') AND status IN ('live', 'archived') AND at >= ? AND at < ? ORDER BY at DESC LIMIT 40").all(period.start, period.end)) {
          if (r.status === 'archived') archivedReviews.add(r.id)
          if (!cand.has(r.id)) cand.set(r.id, cueMatch + 0.35)
        }
      }
    }
    const query = [cue, contextCue].filter(Boolean).join('\n')
    const qv = query.trim() ? await embedText(query, embeddingTimeoutMs) : null
    if (qv) for (const h of vectors.search(qv, { model: embedModel(), limit: period ? 200 : 80, min: cueMatch * 0.8 })) cand.set(h.id, h.sim)
    // 关键词：命中的词越多（按分量算）越像想到了；全中的能单独把记忆勾起来，向量服务慢或连不上时也想得起
    const cueHits = keywordHits(cue, audienceWindow)
    const contextHits = keywordHits(contextCue, audienceWindow)
    for (const [id, cov] of cueHits) {
      const sim = cueMatch * ((deliberate ? 0.9 : 0.85) + 0.3 * cov)
      cand.set(id, Math.max(cand.get(id) || 0, sim))
    }
    for (const [id, cov] of contextHits) {
      const sim = cueMatch * (0.82 + 0.26 * cov)
      cand.set(id, Math.max(cand.get(id) || 0, sim))
    }
    // 眼前的人也是线索：关于他们的事
    for (const p of people) {
      for (const r of store.prep("SELECT id FROM episodes WHERE about = ? AND status = 'live' ORDER BY at DESC LIMIT 10").all(String(p))) {
        cand.set(r.id, Math.max(cand.get(r.id) || 0, cueMatch * 0.9))
      }
    }
    const scored = []
    for (const [id, sim] of cand) {
      const e = row(id)
      const historicalReview = e?.status === 'archived' && archivedReviews.has(id)
      if (!e || (e.status !== 'live' && !historicalReview) || !visibleForAudience(e, audienceWindow)) continue
      if (!inPeriod(e)) continue
      if (e.data.kind === 'intention' && e.data.done) continue
      if (!deliberate && !period && e.data.kind === 'pending' && !cueHits.has(id) && !contextHits.has(id)) continue
      const r = rOf(e, at)
      const level = historicalReview ? 'vague' : levelOf(r, sim, levels())
      if (!level) continue
      let score = sim
      if (window && e.window === window) score += Number(S('contextBonus'))
      if (people.includes(e.data.about)) score += Number(S('contextBonus'))
      const ev = e.data.emotion?.valence || 0
      score += Number(S('moodCongruence')) * (st.valence || 0) * ev
      if (sim < cueMatch && score < cueMatch) continue
      // 过时的说法排后面一些（还记得，但不是现在的情况）
      scored.push({ e, r, sim, level, score: score * (0.5 + 0.5 * r) * (e.data.outdated ? 0.6 : 1) })
    }
    scored.sort((a, b) => b.score - a.score)
    // 精排（可选）：候选多的时候，让精排模型逐条看「线索和这件事有多相关」，按它重新排；遗忘照样算进去。
    // 超时、出错就按原来的顺序，不拖慢回复。
    if (S('rerank') === true && getRerank() && String(cue || '').trim() && scored.length > 1) {
      const n = Math.max(2, Math.min(50, Number(S('rerankTopN')) || 20))
      const head = scored.slice(0, n)
      try {
        const rel = await getRerank()(query, head.map((x) => x.e.gist + (x.e.detail ? '：' + String(x.e.detail).slice(0, 200) : '')), { timeoutMs: Number(S('rerankTimeoutMs')) || 1500 })
        if (rel.length === head.length) {
          head.forEach((x, i) => { x.score = rel[i] * (0.5 + 0.5 * x.r) })
          head.sort((a, b) => b.score - a.score)
          scored.splice(0, head.length, ...head)
        }
      } catch (error) {
        log.debug('精排没成，按原来的顺序：', error.message)
      }
    }
    const eligible = scored.filter(({ e }) => visibleForAudience(e, audienceWindow))
    if (!deliberate && !period) {
      // 对方明确提到待跟进事项时，让有直接词证的事项排在仅因人物关系而想起的记忆前面。
      eligible.sort((a, b) => Number(b.e.data.kind === 'pending' && cueHits.has(b.e.id)) - Number(a.e.data.kind === 'pending' && cueHits.has(a.e.id)))
    }
    const top = eligible.slice(0, limit)
    // 联想（扩散激活）：从最相关的两条出发，顺着联系往下想几步；离得越远越淡，太淡的想不起来。
    // 对话的联想沿用会话可见范围，按日期查时不联想。
    if (top.length && S('assoc') !== false && !period && !compact) {
      const hops = Math.max(1, Math.min(3, Number(S('assocHops')) || 2))
      const cap = Math.max(0, Math.min(5, Number(S('assocLimit') ?? 2)))
      const decay = Math.max(0.3, Math.min(0.9, Number(S('assocDecay')) || 0.6))
      const seen = new Set(top.map((x) => x.e.id))
      const found = []
      let frontier = top.filter((x) => x.level !== 'tip').slice(0, 2).map((x) => ({ id: x.e.id, act: 1 }))
      const linksOf = store.prep('SELECT b AS id, weight FROM links WHERE a = ? UNION SELECT a AS id, weight FROM links WHERE b = ? ORDER BY weight DESC LIMIT 4')
      for (let hop = 1; hop <= hops && frontier.length && found.length < cap; hop++) {
        const next = []
        for (const f of frontier) {
          for (const l of linksOf.all(f.id, f.id)) {
            if (seen.has(l.id)) continue
            const act = f.act * Math.max(0, Math.min(1, Number(l.weight) || 0)) * decay
            if (act < 0.2) continue
            const e = row(l.id)
            if (!e || e.status !== 'live' || !visibleForRecall(e) || (e.data.kind === 'intention' && e.data.done)) continue
            if (!deliberate && e.data.kind === 'pending' && !cueHits.has(e.id) && !contextHits.has(e.id)) continue
            seen.add(l.id)
            const r = rOf(e, at)
            let level = levelOf(r, 1, levels())
            if (!level || level === 'tip') continue
            // 想得越远越淡：两步以外的只记得个大概
            if (hop >= 2 && level === 'clear') level = 'vague'
            next.push({ id: l.id, act })
            found.push({ e, r, sim: act, level, score: 0, associated: true, hop })
          }
        }
        frontier = next.sort((a, b) => b.act - a.act).slice(0, 3)
      }
      found.sort((a, b) => a.hop - b.hop || b.sim - a.sim)
      top.push(...found.slice(0, cap))
    }
    return top.map(({ e, r, level, associated, hop }) => ({ id: e.id, at: e.at, window: e.window, kind: e.data.kind, level, r, associated: Boolean(associated), hop: hop || 0, text: render(e, level, compact), emotion: e.data.emotion || null, target: e.data.about || '', secret: Boolean(e.data.secret && (hasSecretScope(e) || deps.isPrivateHistoryWindow(e.window))), toldTo: e.data.toldTo || null }))
  }


  return recall
}
