// 面板的自定义下拉：替换原生下拉后仍支持键盘。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'

function setupPanel() {
  const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  let loader
  new Script(source).runInNewContext({
    window: { innerWidth: 1200, __ModuleLoader__: { load: (value) => { loader = value } } },
  })
  let hook = 0
  const slots = []
  const React = {
    Component: class {}, Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (initial) => {
      const i = hook++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }]
    },
    useRef: (initial) => {
      const i = hook++
      if (!(i in slots)) slots[i] = { current: initial }
      return slots[i]
    },
    useEffect() {}, useCallback: (fn) => fn, useMemo: (fn) => fn(),
  }
  const panel = loader.factory(() => React).__panelTest
  const render = (component, props) => { hook = 0; return component(props) }
  return { panel, slots, render }
}

test('自定义筛选可用键盘选择、离开后收起', () => {
  const { panel, render } = setupPanel()
  const options = [{ value: '', label: '所有状态' }, { value: 'owner', label: '管理员' }]
  let value = ''
  const select = () => render(panel.Select, { value, options, ariaLabel: '所有状态', onChange: (v) => { value = v } })
  let tree = select()
  const key = (node, name) => node.children[0].props.onKeyDown({ key: name, preventDefault() {} })
  assert.equal(tree.children[0].props['aria-label'], '所有状态')
  key(tree, 'ArrowDown')
  tree = select()
  assert.equal(tree.children[0].props['aria-expanded'], true)
  assert.equal(tree.children[1].props.role, 'listbox')
  key(tree, 'ArrowDown')
  tree = select()
  key(tree, 'Enter')
  assert.equal(value, 'owner')
  tree = select()
  assert.equal(tree.children[0].props['aria-expanded'], false)
  assert.equal(tree.children[0].children[0].children[0], '管理员')
  tree.children[0].props.onClick()
  tree = select()
  assert.equal(tree.children[0].props['aria-expanded'], true)
  tree.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null })
  assert.equal(select().children[0].props['aria-expanded'], false)
})
