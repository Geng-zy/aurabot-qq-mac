// 记忆可见性/隐私：谁在哪个窗口能看到哪条经历，以及可分享/受限文本。
import { anchorDates, relativeDayWords } from './text.js'
import { dayKey } from '../clock.js'
import { randomUUID } from 'node:crypto'

export function createVisibility({ store, deps, place, row, S, publicSourceLines, hasPrivateCue, privateContext, compact, getJointExperience, anchorDates: anchorDatesFn, relativeDayWords: relativeDayWordsFn }) {
  const anchorDates = anchorDatesFn
  const relativeDayWords = relativeDayWordsFn
  function ownerPrivate(window) {
    const p = place(window)
    return p.kind === 'private' && deps.isOwner?.(p.platform ? `${p.platform}:${p.id}` : p.id)
  }

  function shareSourceAllowed(e) {
    return e && ownerPrivate(e.window) && !e.data.secret && !e.data.privateOnly && !e.data.needsRecompute
  }
  const hasSecretScope = (e) => e.data.secret === true
  const audienceRevision = () => store.get('memory.audienceRevision', 'persona-audience-v1')
  const touchAudience = () => store.set('memory.audienceRevision', randomUUID())
  /** 内心整理可以读取全部经历。对话和模块只拿得到当前会话有权看到的内容。 */
  function visibleIn(e, window, path = new Set()) {
    if (!e || e.data.needsRecompute || e.data.shareRevoked) return false
    if (window === undefined) return true
    if (path.has(e.id)) return false
    const { data } = e
    if (data.audienceOnly && e.window !== window) return false
    if (data.privateOnly) {
      if (!ownerPrivate(window)) return false
    }
    if ((data.kind === 'dream' && !Array.isArray(data.from)) || (!e.window && data.kind === 'belief' && data.speaker === 'self')) return false
    if ((hasSecretScope(e) || deps.isPrivateHistoryWindow(e.window)) && (!window || e.window !== window)) return false
    if (data.publicSource) {
      const original = row(data.publicSource)
      if (!shareSourceAllowed(original)) return false
      if (data.kind === 'shared-note') {
        if (!ownerPrivate(window) && !data.shareWith?.includes(window)) return false
      } else if ((S('ownerEverydayExcerpts') === false && window !== original.window) ||
        getJointExperience().test(compact(e.gist)) || !original.data.sources?.length || !publicSourceLines(e.gist, original.window, original.data.sources)) return false
    }
    const sources = [
      ...(Array.isArray(data.audienceShares) ? data.audienceShares : []),
      ...(Array.isArray(data.derivedFrom) ? data.derivedFrom : []),
      ...(Array.isArray(data.from) ? data.from : []),
      ...(Array.isArray(data.promptSources) ? data.promptSources : []),
      data.outdated?.by,
      data.rewrittenWith,
    ].filter(Boolean)
    if (!sources.length) return true
    path.add(e.id)
    const visible = sources.every((id) => visibleIn(row(id), window, path))
    path.delete(e.id)
    return visible
  }
  function sourceVisible(source, window) {
    const line = store.prep('SELECT window FROM perception WHERE id = ?').get(source)
    if (!line || (deps.isPrivateHistoryWindow(line.window) && line.window !== window)) return false
    return store.prep("SELECT id FROM episodes WHERE EXISTS (SELECT 1 FROM json_each(episodes.json, '$.sources') WHERE value = ?)").all(source)
      .every(({ id }) => visibleIn(row(id), window))
  }

  function originalLines(e) {
    const ids = Array.isArray(e.data.sources) ? e.data.sources : []
    if (!e.window || !ids.length) return []
    const get = store.prep('SELECT id, at, who, dir, text, json FROM perception WHERE window = ? AND id = ?')
    return [...new Set(ids)].map((id) => get.get(e.window, id)).filter(Boolean).sort((a, b) => a.at - b.at || a.id - b.id)
  }

  function visibleOriginalLines(e, audienceWindow) {
    return originalLines(e).filter((line) => sourceVisible(line.id, audienceWindow)
      && (JSON.parse(line.json || '{}').audienceShares || []).every((id) => visibleIn(row(id), audienceWindow)))
  }

  /** 只在来源确实落在同一天时，才给摘要里的相对日期定锚。 */
  function sourceDay(lines) {
    if (!lines.length) return ''
    const tz = deps.tz()
    const first = dayKey(lines[0].at, tz)
    return lines.every((line) => dayKey(line.at, tz) === first) ? first : ''
  }

  const memorySummary = (e, text) => !text || ['public-note', 'shared-note'].includes(e.data.kind) || !relativeDayWords.test(text)
    ? text : anchorDates(text, sourceDay(originalLines(e)))

  function protectedText(ownerWindow, audience) {
    const rows = store.prep("SELECT * FROM episodes WHERE kind = 'shared-note' OR (kind = 'public-note' AND ?) OR json_extract(json, '$.privateOnly') = 1 OR json_extract(json, '$.secret') = 1 ORDER BY at DESC LIMIT 250").all(Number(S('ownerEverydayExcerpts') === false))
    const values = []
    for (const row of rows) {
      const e = { ...row, data: JSON.parse(row.json) }
      if ((e.data.kind === 'shared-note' || e.data.kind === 'public-note' || e.data.privateOnly || hasSecretScope(e) || deps.isPrivateHistoryWindow(e.window)) && !visibleIn(e, audience)) values.push(e.gist, e.detail)
    }
    if (ownerWindow) {
      const lines = store.prep("SELECT at, text FROM perception WHERE window = ? AND dir = 'in' ORDER BY id DESC LIMIT 200").all(ownerWindow).reverse()
      for (const [index, line] of lines.entries()) {
        if (hasPrivateCue(line.text) || privateContext(line, lines[index - 1], lines[index + 1])) values.push(line.text)
      }
    }
    return values.filter(Boolean)
  }

  function sharedText(audience) {
    return sharesIn(audience).map((e) => e.gist)
  }

  function sharesIn(audience) {
    return store.prep("SELECT id FROM episodes WHERE kind = 'shared-note' AND json_extract(json, '$.shareWith[0]') = ?").all(audience)
      .map(({ id }) => row(id)).filter((e) => visibleIn(e, audience))
  }

  function restrictedShareText(audience) {
    return store.prep("SELECT id FROM episodes WHERE kind = 'shared-note' ORDER BY at DESC LIMIT 250").all()
      .map(({ id }) => row(id)).filter((e) => !visibleIn(e, audience)).map((e) => e.gist)
  }


  return { ownerPrivate, shareSourceAllowed, hasSecretScope, audienceRevision, touchAudience, visibleIn, sourceVisible, originalLines, visibleOriginalLines, sourceDay, memorySummary, protectedText, sharedText, sharesIn, restrictedShareText }
}
