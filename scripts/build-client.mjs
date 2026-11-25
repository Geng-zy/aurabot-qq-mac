// 把 client/parts 里的页面片段拼回 DSH 需要的单文件 client/client.js。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const template = readFileSync(join(root, 'client/client.template.js'), 'utf8')
const names = readdirSync(join(root, 'client/parts')).filter((name) => name.endsWith('.js')).sort()
const parts = names.map((name) => readFileSync(join(root, 'client/parts', name), 'utf8').replace(/\n$/, '')).join('\n\n')
const out = template.replace(/^([ \t]*)\/\* @include parts \*\/$/m, (_, indent) => parts.split('\n').map((line) => line ? indent + line.trimStart() : line).join('\n'))
if (/@include /.test(out)) throw new Error('client 模板还有没展开的 @include')
writeFileSync(join(root, 'client/client.js'), out)
