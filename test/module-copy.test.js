// 模块面板和提示词的可读性回归：不要再用旧口号，提示词要明确只改模块目录。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

test('模块页不再用「提交教程」「复制给 DSH 的话」这种含糊文案', () => {
  const client = read('client/client.js')
  assert.doesNotMatch(client, /提交教程/)
  assert.doesNotMatch(client, /复制给 DSH 的话/)
  assert.match(client, /想自己写一个模块？/)
  assert.match(client, /复制给 DSH/)
  assert.match(client, /模块库/)
})

test('模块提示词只让 DSH 改 modules 目录，不碰插件源码', () => {
  const reg = read('src/core/module-registry.js')
  assert.match(reg, /只改 .*modules/)
  assert.match(reg, /不要改插件本身的源码/)
  assert.match(reg, /不要 import 插件 src\/ 内部路径/)
  assert.match(reg, /扩展 → 模块管理/)
})

test('内置模块文档包含群管', () => {
  const api = read('src/modules/API.md')
  assert.match(api, /\| `group-admin` \| 群管 \|/)
  assert.match(api, /qq_group_admin/)
})
