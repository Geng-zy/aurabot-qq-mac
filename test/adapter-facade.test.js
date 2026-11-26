// 适配层的门面守卫：mind-adapter 只能「经门面」或「用 core」，不许直连 mind 的内部文件。
//
// 抓过的现状：mind-adapter 有 13 条 import 直接指向 mind/clock.js、mind/budget.js、mind/memory/vectors.js…
// 这些文件里一半是通用工具（时间、token、关键词），已被搬到 core；剩下一半是心智自己的策略，
// 由 mind/index.js 统一导出。适配层从此只认两个入口：core 的通用件、mind 的门面。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADAPTER = join(ROOT, 'src/mind-adapter')

test('mind-adapter 只从 mind 门面（mind/index.js）取心智能力', () => {
  const bad = []
  for (const f of readdirSync(ADAPTER).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(join(ADAPTER, f), 'utf8')
    for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
      const spec = m[1]
      if (!spec.startsWith('../mind/')) continue
      if (spec === '../mind/index.js') continue
      bad.push(`src/mind-adapter/${f} → ${spec}`)
    }
  }
  assert.deepEqual(bad, [], `适配层绕过门面直连心智内部：\n${bad.join('\n')}`)
})

test('心智门面把适配层要用的策略函数都导出了', () => {
  const facade = readFileSync(join(ROOT, 'src/mind/index.js'), 'utf8')
  for (const name of ['paramOf', 'effortForScene', 'speechScene', 'wantsMeal', 'wantsOwnerChat',
    'createEmbedClient', 'createRerankClient', 'parseJson', 'shortId', 'placeOf']) {
    assert.match(facade, new RegExp(`\\b${name}\\b`), `门面缺导出：${name}`)
  }
})
