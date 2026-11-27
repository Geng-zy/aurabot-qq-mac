// 两段文字有多像（性格模块与习惯归并都用它）。纯函数，单独放着避免循环依赖。

export function similar(a, b) {
  const grams = (s) => {
    const t = [...String(s || '').replace(/\s+/g, '')]
    const out = new Set()
    for (let i = 0; i < t.length - 1; i++) out.add(t[i] + t[i + 1])
    if (t.length === 1) out.add(t[0])
    return out
  }
  const x = grams(a)
  const y = grams(b)
  if (!x.size || !y.size) return 0
  let n = 0
  for (const g of x) if (y.has(g)) n++
  return n / Math.min(x.size, y.size)
}
