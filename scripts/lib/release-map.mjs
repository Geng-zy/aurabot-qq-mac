/**
 * 把 `gh api ...releases?per_page=100` 的 `tag_name digest` 文本解析成映射。
 *
 * 单独抽出来是为了能离线测：真机那次「48 个版本逐个打 API 撞上次级限流」的修复
 * 就是把 N 次调用压成 1 次，解析逻辑得有单测兜着。
 */
export function parseReleaseMap(text) {
  const map = new Map()
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const space = trimmed.indexOf(' ')
    if (space < 0) { map.set(trimmed, ''); continue }
    const tag = trimmed.slice(0, space)
    const digest = trimmed.slice(space + 1).trim()
    map.set(tag, digest)
  }
  return map
}

/** 记录里的 `sha256:<hex>` 与远端 `sha256:<hex>` 是否同源（远端为空 → 明确报错而不是当通过）。 */
export function digestMatches(recorded, remote) {
  if (!remote) return { ok: false, reason: '远端没有这个 Release 的资产摘要' }
  return { ok: remote === `sha256:${recorded}`, reason: `记录 ${recorded.slice(0, 12)}… ≠ 远端 ${remote}` }
}
