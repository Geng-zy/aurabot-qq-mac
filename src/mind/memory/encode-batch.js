// 把一段聊天交给模型整理成经历并提交。
const DAY = 86400000

export function createEncodeBatch({ store, now, S, deps, log, cursorOf, sourceDay, publicQuote, insert, ask, parseJson, anchorDates, parseBirthday, zonedToEpoch, dayKey, shortTime, clamp01, embedEpisodes, encodeSystem, getEncodeExtra, getOnEncoded }) {
  async function encodeBatch(window, { force = false, recovery = null, through = Number.MAX_SAFE_INTEGER } = {}) {
    const tz = deps.tz()
    const cursor = recovery ? recovery.after : cursorOf(window)
    const batch = recovery ? recovery.batch || 30 : Number(S('encodeBatch')) || 60
    const select = store.prep('SELECT id, at, who, dir, text, json FROM perception WHERE window = ? AND id > ? AND id <= ? ORDER BY id LIMIT ?')
    const rows = select.all(window, cursor, through, batch)
    if (!rows.length) {
      if (recovery) store.set('encode.recovery', store.get('encode.recovery', []).slice(1))
      return { encoded: 0 }
    }
    const last = rows[rows.length - 1]
    const idle = now() - last.at >= (Number(S('encodeIdleMinutes')) || 5) * 60000
    // 一直没停下来的聊天（热闹的群）：最早那条没记的等太久了也先记一段，别处才能及时想起这里聊过什么
    const waitedTooLong = now() - rows[0].at >= (Number(S('encodeMaxWaitMinutes')) || 30) * 60000
    if (!force && !idle && !waitedTooLong && rows.length < batch) return { encoded: 0, waiting: true }
    const name = deps.identity().name
    const fmt = (t) => dayKey(t, tz) + ' ' + shortTime(t, tz).slice(6)
    const lines = rows.map((r, i) => {
      const j = JSON.parse(r.json || '{}')
      const who = r.dir === 'out' ? 'self' : r.who
      const nick = r.dir === 'out' ? '你' : (j.name || deps.person(r.who)?.name || r.who)
      return `${i + 1}. ${fmt(r.at)} [${who}] ${nick}：${String(r.text).replace(/\s+/g, ' ').slice(0, 300)}`
    })
    let parsed
    try {
      let extra = ''
      if (!recovery) try { extra = String(getEncodeExtra()(window) || '') } catch {}
      const system = encodeSystem(name) + (extra ? '\n\n' + extra + '\n这几项和 episodes 放在同一个 JSON 对象里。' : '')
      parsed = parseJson(await ask('record', system, `聊天：${window}\n${lines.join('\n')}`, extra ? 2500 : 1500))
    } catch (error) {
      if (error.code === 'BUDGET') return { encoded: 0, budget: true }
      throw error
    }
    // 等模型时原话可能被删除、合并身份或修改，提交前检查同一批原话仍然有效。
    const unchanged = () => (recovery || cursorOf(window) === cursor) && JSON.stringify(select.all(window, cursor, through, rows.length)) === JSON.stringify(rows)
    // 模型没按格式回（不是 JSON、没有 episodes）：这段先不算记过，下次再记；连着三次都不行才跳过，免得卡死
    if (!parsed || typeof parsed !== 'object' || (parsed.episodes !== undefined && !Array.isArray(parsed.episodes)) || (!Array.isArray(parsed.episodes) && !('self' in parsed) && !('rel' in parsed) && !('habit' in parsed) && !('knowledge' in parsed))) return store.tx(() => {
      if (!unchanged()) return { encoded: 0, changed: true }
      if (recovery) {
        const tasks = store.get('encode.recovery', [])
        const [, ...rest] = tasks
        if (batch > 10 || !recovery.retried) {
          store.set('encode.recovery', [{ ...recovery, batch: Math.max(10, Math.floor(batch / 2)), retried: batch === 10 }, ...rest])
        } else {
          const failed = { window, after: cursor, through: last.id }
          store.set('encode.recovery.failed', [...store.get('encode.recovery.failed', []), failed])
          store.set('encode.recovery', last.id < through ? [{ window, after: last.id, through }, ...rest] : rest)
          log.warn('补记旧经历时模型连续没按格式回，本批保留待补：', rows.length, '条')
        }
        return { encoded: 0, failed: true }
      }
      const failKey = 'encode.fail.' + window
      const n = Number(store.get(failKey, 0)) + 1
      if (n < 3) {
        store.set(failKey, n)
        log.warn(`记 ${window} 时模型没按格式回，下次再记（第 ${n} 次）`)
        return { encoded: 0, failed: true }
      }
      store.del(failKey)
      const skipped = { window, after: cursor, through: last.id }
      store.set('encode.skipped', [...store.get('encode.skipped', []), skipped])
      if (store.get('budget.unlimitedDay') === dayKey(now(), tz)) {
        store.set('encode.recovery', [...store.get('encode.recovery', []), skipped])
      }
      log.warn(`记 ${window} 时模型连着 ${n} 次没按格式回，这 ${rows.length} 条先跳过（原话还在，翻聊天记录能看到）`)
      store.set('encode.cursor.' + window, last.id)
      return { encoded: 0, failed: true, skipped: rows.length }
    })
    // 她在这段里说过话就是专心在聊；只是在群里看着，记得浅一些
    const attention = rows.some((r) => r.dir === 'out') ? 1 : 0.6
    const ids = []
    const evidence = []
    const committed = store.tx(() => {
      if (!unchanged()) return false
      if (!recovery) store.del('encode.fail.' + window)
      // 已在指定群聊提过的分享仍只属于那个群，不能靠重新整理变成别处的经历。
      const audienceShares = [...new Set(rows.flatMap((r) => JSON.parse(r.json || '{}').audienceShares || []))]
      for (const ep of Array.isArray(parsed?.episodes) ? parsed.episodes : []) {
        const gist = String(ep?.gist || '').trim()
        if (!gist) continue
        const src = (Array.isArray(ep.sources) ? ep.sources : []).map((n) => rows[Number(n) - 1]).filter(Boolean).sort((a, b) => a.at - b.at || a.id - b.id)
        if (recovery && !src.length) continue
        let type = ['event', 'fact', 'hearsay', 'belief', 'intention', 'pending', 'date'].includes(ep.type) ? ep.type : 'event'
        // 每年的日子：认不出月日就当普通的事
        const yb = type === 'date' ? parseBirthday(ep.yearly) : null
        if (type === 'date' && !yb) type = 'fact'
        const about = String(ep.about || '')
        const speaker = String(ep.speaker || '')
        // 别人说的事实只认他自己的原话
        if (type === 'fact' && about && speaker && about !== speaker && speaker !== 'self') type = 'hearsay'
        // 惦记的事只认本人说的自己的事；不是的话当普通的事 / 听说的事
        if (type === 'pending' && (!about || about === 'self' || speaker !== about || !src.some((line) => line.dir === 'in' && line.who === about))) {
          type = about && about !== 'self' && speaker && speaker !== about ? 'hearsay' : 'event'
        }
        const emo = ep.emotion && typeof ep.emotion === 'object' && ep.emotion.name
          ? { name: String(ep.emotion.name), intensity: clamp01(ep.emotion.intensity), valence: Math.max(-1, Math.min(1, Number(ep.emotion.valence) || 0)) }
          : null
        let due = null
        if ((type === 'intention' || type === 'pending') && ep.due) {
          due = zonedToEpoch(ep.due, tz)
        }
        const at = src.length ? src[0].at : rows[0].at
        const sourceDate = sourceDay(src)
        // 惦记的事：结果出来的时候再问（看不出来、或者说的时间不靠谱，就两天后）
        const follow = type === 'pending' ? { followup: { asks: 0, nextAt: due && due > at && due < at + 60 * DAY ? due : at + 2 * DAY } } : {}
        const id = insert({
          at, window, gist: anchorDates(gist, sourceDate), detail: anchorDates(String(ep.detail || '').trim(), sourceDate), kind: type,
          importance: ep.importance ?? 0.5, emotion: emo, about, speaker,
          who: Array.isArray(ep.who) ? ep.who.map(String) : [],
          sources: src.map((r) => r.id), due, attention,
          extra: { ...(audienceShares.length ? { audienceOnly: true, audienceShares } : {}), ...(ep.secret === true ? { secret: true } : {}), ...follow, ...(yb ? { yearly: `${String(yb.month).padStart(2, '0')}-${String(yb.day).padStart(2, '0')}` } : {}) },
        })
        ids.push(id)
        const quote = publicQuote(ep, src, window)
        if (quote) insert({
          at, gist: quote, kind: 'public-note', importance: ep.importance ?? 0.4, speaker: 'self',
          extra: { publicSource: id, publicSummary: quote },
        })
        evidence.push({ id, sources: src.map((r) => r.id), emotion: emo, importance: ep.importance, secret: ep.secret === true })
      }
      if (!recovery) store.set('encode.cursor.' + window, last.id)
      else {
        const tasks = store.get('encode.recovery', [])
        const [current, ...rest] = tasks
        if (current?.window === window && current.after === cursor && current.through === through) {
          const remaining = last.id < through ? [{ window, after: last.id, through }, ...rest] : rest
          store.set('encode.recovery', remaining)
          const progress = store.get('encode.recovery.progress', { rows: 0, episodes: 0 })
          store.set('encode.recovery.progress', { rows: progress.rows + rows.length, episodes: progress.episodes + ids.length })
        }
      }
      return true
    })
    if (!committed) return { encoded: 0, changed: true }
    if (getOnEncoded() && !recovery) {
      try { getOnEncoded()({ window, rows, parsed, evidence }) } catch (error) { log.warn('记经历后的状态记录出错：', error.message) }
    }
    await embedEpisodes(ids)
    return { encoded: ids.length, ids }
  }


  return encodeBatch
}
