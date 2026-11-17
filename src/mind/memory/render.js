// 按想起的清楚程度给出她脑子里的样子。
export function createRender({ memorySummary, pendingLabel, KINDS }) {
  return function render(e, level, compact = false) {
    const tag = e.data.kind === 'pending' ? pendingLabel(e) : KINDS[e.data.kind] && e.data.kind !== 'event' && e.data.kind !== 'experience' ? `（${KINDS[e.data.kind]}）` : ''
    const gist = memorySummary(e, e.gist)
    if (e.data.outdated && level !== 'tip') return `以前：${gist}${tag}——后来变了：${e.data.outdated.now}`
    if (level === 'clear') return `${gist}${!compact && e.detail ? '——' + memorySummary(e, e.detail) : ''}${tag}`
    if (level === 'vague' || e.data.kind === 'pending') return `好像有这么回事：${gist}${tag}`
    const chars = [...gist]
    return `${chars.slice(0, Math.max(4, Math.ceil(chars.length * 0.4))).join('')}……（一下想不全）`
  }
}
