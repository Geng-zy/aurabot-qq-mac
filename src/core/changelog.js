// CHANGELOG.md 里某个版本那一段（「## 0.3.0」到下一个「## 」）。只读展示，不参与更新。
export function changelogSection(text, version) {
  const lines = String(text || '').split(/\r?\n/)
  const start = lines.findIndex((l) => new RegExp(`^##\\s+v?${String(version).replace(/\./g, '\\.')}\\b`).test(l))
  if (start < 0) return ''
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim()
}
