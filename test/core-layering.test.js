// 分层守卫：core 不许反向依赖上层（chat / channels / features / voice / song / mind / mind-adapter / modules / local / persona）。
//
// 这条规则在 REFACTOR-PLAN §1 里写着，但一直没人守：1.6.39 之前 core 有 10 条反向边
// （config 依赖 chat/access、core/media 依赖 features/stickers 等），拆文件时没人发现。
// 现在搬走纯逻辑 + 留兼容出口，边数归零；以后新增的边会在这里报出来。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CORE = join(ROOT, 'src/core')
const UPPER = ['chat', 'channels', 'features', 'voice', 'song', 'mind', 'mind-adapter', 'modules', 'local', 'persona']

test('core 只依赖 core 与 node 内置', () => {
  const bad = []
  for (const f of readdirSync(CORE).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(join(CORE, f), 'utf8')
    for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
      const spec = m[1]
      const rel = spec.replace(/^\.\//, '')
      if (!spec.startsWith('..')) continue // ./xxx 在 core 内部
      const up = rel.split('/').slice(1).join('/')
      const layer = up.split('/')[0]
      if (UPPER.includes(layer)) bad.push(`src/core/${f} → ${spec}`)
    }
  }
  assert.deepEqual(bad, [], `core 反向依赖了上层：\n${bad.join('\n')}`)
})

test('兼容出口（旧路径 shim）只做 re-export，不重新长出实现', () => {
  const shims = [
    'src/chat/access.js', 'src/chat/group-policy.js', 'src/chat/chat-model.js',
    'src/channels/ids.js', 'src/channels/qq/features/diary/qzone-audience.js', 'src/voice/wav.js',
  ]
  const bad = []
  for (const rel of shims) {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    const code = src.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).join('\n')
    if (!/^export \* from '[^']+'$/m.test(code.trim())) bad.push(`${rel} 不是单纯的 re-export`)
    if (code.trim().split('\n').length !== 1) bad.push(`${rel} 有多行实现（应只剩一行 re-export）`)
  }
  assert.deepEqual(bad, [], bad.join('\n'))
})
