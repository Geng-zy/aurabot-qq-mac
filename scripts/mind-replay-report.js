import { TRAIT } from '../src/mind/personality/traits.js'

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const colors = ['#176d61', '#c65530', '#5968ad', '#966124', '#875497', '#227489']
const fmt = (v) => Number(v.toPrecision(4)).toLocaleString('zh-CN', { maximumFractionDigits: 6 })

function chart(days, title, series, range) {
  const values = series.flatMap((item) => item.values).filter(Number.isFinite)
  if (!values.length) return ''
  const lo = range?.[0] ?? Math.min(0, ...values)
  const hi = range?.[1] ?? (Math.max(...values) || 1)
  const x = (i) => 63 + i * 666 / Math.max(1, days.length - 1)
  const y = (v) => 158 - 132 * (v - lo) / (hi - lo || 1)
  const grid = [0, 0.25, 0.5, 0.75, 1].map((d) => {
    const v = lo + d * (hi - lo)
    return `<path d="M63 ${y(v)}H729" class="grid"/><text x="54" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`
  }).join('')
  const traces = series.map(({ label, values }, j) => {
    let connected = false
    const path = values.map((v, i) => {
      if (!Number.isFinite(v)) { connected = false; return '' }
      const command = connected ? 'L' : 'M'
      connected = true
      return command + x(i) + ' ' + y(v)
    }).join(' ')
    const color = colors[j % colors.length]
    const dots = values.map((v, i) => Number.isFinite(v) ? `<circle cx="${x(i)}" cy="${y(v)}" r="2.5" fill="${color}"><title>${escape(days[i].day)} · ${escape(label)} ${fmt(v)}</title></circle>` : '').join('')
    return `<path d="${path}" stroke="${color}" stroke-width="2" fill="none"/>${dots}`
  }).join('')
  const ticks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((d) => Math.round(d * (days.length - 1))))]
    .map((i) => `<text x="${x(i)}" y="181" text-anchor="middle">${escape(days[i].day.slice(5))}</text>`).join('')
  const legend = series.map(({ label }, i) => `<span><i style="background:${colors[i % colors.length]}"></i>${escape(label)}</span>`).join('')
  return `<section><h2>${escape(title)}</h2><div class="legend">${legend}</div><svg viewBox="0 0 760 190" role="img" aria-label="${escape(title)}">${grid}${traces}${ticks}</svg></section>`
}

export function renderMindReplay(report) {
  const { days, checkpoints, estimatedRatePerMillion } = report
  const total = days.reduce((n, d) => n + d.usage.tokens, 0)
  const traits = Object.keys(days[0]?.traits || {}).filter((id) => new Set(days.map((d) => d.traits[id])).size > 1)
  const series = (label, selector) => ({ label, values: days.map(selector) })
  const retention = [...new Set(days.flatMap((d) => Object.keys(d.retention)))].map((key) => series(key, (d) => d.retention[key]))
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>大肥鱼 · 心智回放</title>
<style>
:root{font:16px system-ui,sans-serif;color:#22352f;background:#f4f6f1}body{margin:36px auto;max-width:860px;padding:0 18px}h1{margin-bottom:6px}h2{font-size:1.1rem;margin:0 0 8px}p{color:#4d645c}section{background:#fff;border:1px solid #d8e3db;border-radius:12px;padding:18px;margin:14px 0}svg{width:100%;display:block}svg text{font:12px system-ui;fill:#4d645c}.grid{stroke:#d8e3db;fill:none}.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:14px}.legend i{width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:6px}li{padding:4px 0}
</style></head><body><header><h1>大肥鱼 · 心智回放</h1><p>${days.length} 个观察日 · ${escape(days[0]?.day)} 至 ${escape(days.at(-1)?.day)} · ${total.toLocaleString('zh-CN')} token</p>
<p>按回放时钟运行，使用输入记录或替身模型。每日曲线是软件状态；花费按统一单价估算，未调用实际计费接口。</p></header>
${chart(days, '性格特质', (traits.length ? traits : ['sociability']).map((id) => series(TRAIT.get(id)?.label || id, (d) => d.traits[id])), [0, 1])}
${chart(days, '心情和最强情绪', [series('愉快度', (d) => d.mood.v), series('最强情绪的强度', (d) => Math.max(0, ...d.emotions.map((e) => e.intensity)))], [-1, 1])}
${chart(days, '指定经历的记忆强度', retention, [0, 1])}
${chart(days, '每日后台 token', [series('后台 token', (d) => d.usage.tokens)])}
${estimatedRatePerMillion === null ? '' : chart(days, '每日估算费用', [series('估算费用', (d) => d.cost)])}
<section><h2>回忆和删除检查点</h2><ul>${checkpoints.map((e) => `<li>${escape(new Date(e.at).toISOString())} · ${escape(e.ref)} · ${e.kind === 'recall' ? (e.found ? '找到' : '未找到') + (Number.isFinite(e.strength) ? '，强度 ' + fmt(e.strength) : '') : (e.deleted ? '已删除' : '未删除')}</li>`).join('')}</ul></section>
</body></html>`
}
