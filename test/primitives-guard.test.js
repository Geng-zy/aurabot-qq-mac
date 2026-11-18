// 硬依赖 primitives 后，旧 DSH 至少要给一个能读的升级提示，不能白屏。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'

test('缺少 primitives 时注册升级提示页，而不是抛错白屏', () => {
  const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  let loader
  new Script(source).runInNewContext({ window: { __ModuleLoader__: { load: (v) => { loader = v } } } })
  const React = { Component: class {}, Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }) }
  const mod = loader.factory((name) => {
    if (name === 'react') return React
    throw new Error('no primitives')
  })
  const registered = []
  const slots = {
    inject: (name, fn) => fn(),
    register: (spec, comp) => { registered.push({ spec, comp }); return comp },
  }
  mod.apply({ get: () => slots })
  assert.equal(registered.length, 2)
  const main = registered.find((x) => x.spec.name === 'main')
  assert.ok(main, '主面板要注册兜底页')
  const wrapper = main.comp()
  const tree = wrapper.type(wrapper.props)
  const text = JSON.stringify(tree)
  assert.match(text, /DSH UI primitives/)
  assert.match(text, /0\.2\.2-rc\.3/)
})
