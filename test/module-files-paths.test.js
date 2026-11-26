// 内置模块 / QQ 功能声明的 files、sourcePath 必须真的存在。
//
// 背景：`fork(id)`（面板「复制内置模块」）会按 files 里的相对路径去 src/ 下读文件；
// profile 功能曾写成 `files: ['qq-profile.js']`，解析成 src/qq-profile.js —— 一复制就 ENOENT。
// 这条测试把「声明与实际目录不一致」这类问题挡在提交前。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILTINS } from '../src/modules/index.js'
import { QQ_FEATURES } from '../src/channels/qq/features/index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')

test('每个内置模块 / QQ 功能的 sourcePath 都存在', () => {
  const bad = []
  for (const def of [...BUILTINS, ...QQ_FEATURES]) {
    const p = def.sourcePath || `modules/${def.id}/index.js`
    if (!existsSync(join(SRC, ...p.split('/')))) bad.push(`${def.id}: sourcePath=${p}`)
  }
  assert.deepEqual(bad, [], `sourcePath 指向不存在的文件：\n${bad.join('\n')}`)
})

test('files 里的每个路径都能在 src/ 下找到（fork 复制不会 ENOENT）', () => {
  const bad = []
  for (const def of [...BUILTINS, ...QQ_FEATURES]) {
    for (const f of def.files || []) {
      if (!existsSync(join(SRC, ...f.split('/')))) bad.push(`${def.id}: files=${f}`)
    }
  }
  assert.deepEqual(bad, [], `files 指向不存在的文件：\n${bad.join('\n')}`)
})

test('files 一律用 src 相对路径（不带 ./ 或绝对路径）', () => {
  const bad = []
  for (const def of [...BUILTINS, ...QQ_FEATURES]) {
    for (const f of def.files || []) {
      if (f.startsWith('./') || f.startsWith('/') || !f.includes('/')) bad.push(`${def.id}: files=${f}`)
    }
  }
  assert.deepEqual(bad, [], `files 路径写法不统一：\n${bad.join('\n')}`)
})
