// 心智核心的分层守卫：mind 只许依赖 mind 自己与 core。
//
// 抓过的问题：mind/self 反向依赖 persona（只为拿一个字数上限），mind/local/runner.js 把 mlx_lm 的
// 进程管理塞在心智核心里（其实只有 mind-adapter 用它）。两处都已下沉/搬迁，这里把边界钉住。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIND = join(ROOT, 'src/mind')
const ALLOWED_OUTSIDE = new Set(['core'])

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (name.endsWith('.js')) yield full
  }
}

// 已知的兼容出口：只为不改动现有 import 而保留，且必须是「一行 re-export」。
// 想新增出口要先改这份名单 —— 这样「往 mind 里塞上行依赖」不会悄悄发生。
const SHIMS = ['src/mind/local/runner.js']

const isShim = (file) => {
  const code = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).join('\n').trim()
  return /^export \* from '[^']+'$/m.test(code) && code.split('\n').length === 1
}

test('mind 只依赖 mind 与 core（兼容出口除外）', () => {
  const bad = []
  for (const file of walk(MIND)) {
    const rel = relative(ROOT, file)
    if (SHIMS.includes(rel) && isShim(file)) continue
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
      const spec = m[1]
      if (!spec.startsWith('..')) continue // ./xxx 在 mind 内部
      const target = relative(join(ROOT, 'src'), join(dirname(file), spec)).split('\\').join('/')
      if (target.startsWith('mind/')) continue
      const layer = target.split('/')[0]
      if (!ALLOWED_OUTSIDE.has(layer)) bad.push(`${relative(ROOT, file)} → ${spec}`)
    }
  }
  assert.deepEqual(bad, [], `mind 依赖了不该依赖的层：\n${bad.join('\n')}`)
})

test('心智核心里不放进程管理：mlx_lm 的运行器在适配层', () => {
  const hits = []
  for (const file of walk(MIND)) {
    const src = readFileSync(file, 'utf8')
    if (/child_process/.test(src)) hits.push(relative(ROOT, file))
  }
  assert.deepEqual(hits, [], `这些文件在 mind 里启动了子进程：\n${hits.join('\n')}`)
})
