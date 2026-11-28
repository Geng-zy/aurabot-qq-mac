// 颜色只允许出现在 0tokens.js 里，且正文对比度要够。
//
// 抓过的现状：84 个十六进制颜色散在 634 行 styles.js 里，改一处主题要通读全文；
// 深色靠一个 data 属性整体覆盖，没有语义层。现在拆成「语义 token + 组件规则」两层。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PARTS = join(ROOT, 'client/parts')
const TOKENS = readFileSync(join(PARTS, '0tokens.js'), 'utf8')

const HEX = /#[0-9a-fA-F]{3,8}\b/g
// 白名单：panelSandboxHtml.js 是模块模拟测试用的 iframe 独立文档，自带一份样式表，
// 拿不到面板的 :root token（iframe 里没有 .ab-root 祖先），所以它的颜色留在自己的 CSS 常量里。
const ALLOW = new Set(['panelSandboxHtml.js'])

test('十六进制颜色只出现在 0tokens.js', () => {
  const offenders = []
  for (const name of readdirSync(PARTS).filter((n) => n.endsWith('.js') && n !== '0tokens.js' && !ALLOW.has(n))) {
    const text = readFileSync(join(PARTS, name), 'utf8')
    const hits = text.match(HEX)
    if (hits) offenders.push(name + ': ' + [...new Set(hits)].join(' '))
  }
  const template = readFileSync(join(ROOT, 'client/client.template.js'), 'utf8')
  if (template.match(HEX)) offenders.push('client.template.js: ' + [...new Set(template.match(HEX))].join(' '))
  assert.deepEqual(offenders, [], '这些文件里还有颜色字面量：\n' + offenders.join('\n'))
})

/** 取某个选择器块里的 token 表。 */
function block(head) {
  const i = TOKENS.indexOf(head)
  assert.notEqual(i, -1, '找不到 token 块：' + head)
  const body = TOKENS.slice(i, TOKENS.indexOf('}', i))
  return Object.fromEntries([...body.matchAll(/(--ab-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)].map((m) => [m[1], m[2]]))
}

const toRgb = (hex) => {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
}
const luminance = (hex) => {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

for (const [label, head] of [
  ['浅色', ':root,.ab-root{'],
  ['深色', 'body[data-ds-dark-theme] .ab-root{'],
]) {
  test(`${label}：正文/次要文字对比度 ≥ 4.5:1，强调与状态色 ≥ 3:1`, () => {
    const t = block(head)
    const pairs = [
      ['正文', t['--ab-text'], t['--ab-bg'], 4.5],
      ['正文在卡片上', t['--ab-text'], t['--ab-card'], 4.5],
      ['次要文字', t['--ab-sub'], t['--ab-card'], 4.5],
      ['弱化文字', t['--ab-dim'], t['--ab-card'], 4.5],
      ['侧栏文字', t['--ab-rail-ink'], t['--ab-rail'], 4.5],
      ['侧栏次级', t['--ab-rail-label'], t['--ab-rail'], 4.5],
      ['焦点环', t['--ab-sky'], t['--ab-bg'], 3],
      ['错误色', t['--ab-err'], t['--ab-card'], 3],
      ['成功色', t['--ab-ok'], t['--ab-card'], 3],
      ['警告色', t['--ab-warn'], t['--ab-card'], 3],
      ['强调按钮文字', t['--ab-on-accent'], t['--ab-sea'], 4.5],
    ]
    const bad = pairs
      .filter(([, fg, bg]) => fg && bg)
      .map(([name, fg, bg, min]) => ({ name, ratio: contrast(fg, bg), min }))
      .filter((x) => x.ratio < x.min)
      .map((x) => `${x.name}: ${x.ratio.toFixed(2)} < ${x.min}`)
    assert.deepEqual(bad, [], `${label}对比度不够：\n` + bad.join('\n'))
  })
}

test('深色只覆盖语义 token，不新增 token 名', () => {
  const light = Object.keys(block(':root,.ab-root{'))
  const dark = Object.keys(block('body[data-ds-dark-theme] .ab-root{'))
  const extra = dark.filter((k) => !light.includes(k))
  assert.deepEqual(extra, [], '深色块里出现了浅色没有的 token：' + extra.join(' '))
})
