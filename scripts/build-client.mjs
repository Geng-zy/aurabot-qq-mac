// 把 client/parts 里的页面片段拼回 DSH 需要的单文件 client/client.js。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const template = readFileSync(join(root, 'client/client.template.js'), 'utf8')
const out = template.replace(/^([ \t]*)\/\* @include ([\w.-]+) \*\/$/gm, (_, indent, name) => {
  const part = readFileSync(join(root, 'client/parts', name), 'utf8').replace(/\n$/, '')
  return part
})
if (/@include /.test(out)) throw new Error('client 模板还有没展开的 @include')
writeFileSync(join(root, 'client/client.js'), out)
