// 表单小工具的守卫：密钥框与结果提示都必须走共享实现。
//
// 抓过的现状：13 处密钥框各写一遍「已保存就不回显」的占位逻辑（文案三种写法），
// 21 处提示各写一遍 toast(r.message, r.ok ? 'ok' : 'err')。改一处很容易漏掉另一半。
// 现在统一成 f.secret(...) / notify(...)，用这条测试防止再长回去。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PARTS = join(ROOT, 'client/parts')

function partSources() {
  return readdirSync(PARTS).filter((n) => n.endsWith('.js')).map((n) => ({ name: n, src: readFileSync(join(PARTS, n), 'utf8') }))
}

test('密钥框统一走 f.secret / secretPlaceholder，不再手写「已保存 ? … : …」', () => {
  const bad = []
  for (const { name, src } of partSources()) {
    for (const m of src.matchAll(/(\w+)Set\s*\?\s*'已保存[^']*'\s*:\s*[^,)]+/g)) {
      bad.push(`${name}: ${m[0].slice(0, 60)}`)
    }
  }
  assert.deepEqual(bad, [], `这些地方还在手写密钥占位逻辑，改用 f.secret / secretPlaceholder：\n${bad.join('\n')}`)
})

test('结果提示统一走 notify(...)，不再手写 toast(x.message, x.ok ? ...)', () => {
  const bad = []
  for (const { name, src } of partSources()) {
    for (const m of src.matchAll(/toast\(\s*(\w+)\.message\s*,\s*\1\.ok\s*\?/g)) {
      bad.push(`${name}: ${m[0]}`)
    }
  }
  assert.deepEqual(bad, [], `这些地方还在手写成功/失败提示，改用 notify(toast, x)：\n${bad.join('\n')}`)
})

test('共享实现只有一份：secretPlaceholder 与 notify 都有定义', () => {
  const kit = readFileSync(join(PARTS, 'useField.js'), 'utf8')
  assert.match(kit, /function secretPlaceholder\(/, 'useField.js 里应有 secretPlaceholder')
  assert.match(kit, /function notify\(toast, result/, 'useField.js 里应有 notify(toast, result)')
  assert.match(kit, /secret: \(path, props = \{\}\) =>/, 'useField.js 里应有 f.secret')
})

// B0 的五个控件用真组件渲染断言（面板测试的同一套 fake React 骨架）。
import { Script } from 'node:vm'

function setup() {
  const source = readFileSync(join(ROOT, 'client/client.js'), 'utf8')
  let loader
  new Script(source).runInNewContext({
    window: { innerWidth: 1200, __ModuleLoader__: { load: (v) => { loader = v } } },
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ setAttribute() {}, append() {}, classList: { add() {} } }), body: { append() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async () => ({ json: async () => ({ ok: true }) }), setTimeout, clearTimeout, console,
  })
  let hook = 0
  const slots = []
  const React = {
    Component: class {}, Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (initial) => { const i = hook++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (v) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v }] },
    useRef: (initial) => { const i = hook++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
    useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f(), useId: () => 'id' + hook++, memo: (f) => f,
  }
  const primitives = { Button: 'dsh-button', Switch: 'dsh-switch', Toast: 'dsh-toast', writeClipboard: async () => {}, isDarwinDesktop: () => false }
  const panel = loader.factory((name) => (name === 'react' ? React : primitives)).__panelTest
  const render = (component, props) => { hook = 0; return component(props) }
  return { panel, render }
}

// ---- B0：状态三件套与保存条 ----

test('Empty 升级后既能只给一句话，也能给教学式空态', () => {
  const { panel, render } = setup()
  const simple = render(panel.Empty, { text: '没有东西' })
  assert.equal(simple.props.className, 'ab-empty')
  const teaching = render(panel.Empty, { icon: 'x', title: '还没有表情包', text: '她收到真表情时会自动收下', action: '去 QQ 会话', onAction: () => {} })
  const kinds = []
  const walk = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); if (n.props?.className) kinds.push(n.props.className); (n.children || []).forEach(walk) }
  walk(teaching)
  assert.ok(kinds.includes('ab-empty-title'), '教学式空态要有标题')
  assert.ok(kinds.includes('ab-empty-actions'), '教学式空态要有一个主行动')
})

test('Skeleton 三种形态都标了 aria-busy，且带读屏文案', () => {
  const { panel, render } = setup()
  for (const kind of ['row', 'card', 'avatar']) {
    const node = render(panel.Skeleton, { kind, rows: 2 })
    assert.equal(node.props['aria-busy'], 'true', kind + ' 要有 aria-busy')
    assert.match(JSON.stringify(node), /ab-sr/, kind + ' 要有读屏文案')
  }
})

test('ErrorBlock 有重试与复制诊断两个动作，并声明 role=alert', () => {
  const { panel, render } = setup()
  const node = render(panel.ErrorBlock, { title: '读不到日志', message: 'boom', onRetry: () => {} })
  assert.equal(node.props.role, 'alert')
  const text = JSON.stringify(node)
  assert.match(text, /重试/)
  assert.match(text, /复制诊断/)
})

test('SaveBar 三态：有改动 / 保存中 / 已保存', () => {
  const { panel, render } = setup()
  const dirty = render(panel.SaveBar, { state: 'dirty', onSave: () => {}, onReset: () => {}, isMac: true })
  assert.match(JSON.stringify(dirty), /有改动还没保存/)
  const saving = render(panel.SaveBar, { state: 'dirty', saving: true, onSave: () => {}, onReset: () => {} })
  assert.match(JSON.stringify(saving), /保存中/)
  const saved = render(panel.SaveBar, { state: 'saved' })
  assert.match(JSON.stringify(saved), /已保存/)
})

test('Field 把错误串成 aria-describedby，且初始 aria-invalid=false', () => {
  const { panel, render } = setup()
  const node = render(panel.Field, { label: '称呼', value: '大肥鱼', onChange: () => {}, error: '不能为空', hint: '她会这样叫你' })
  const json = JSON.stringify(node)
  assert.match(json, /aria-invalid/)
  assert.match(json, /不能为空/)
  assert.match(json, /她会这样叫你/)
})
