// 提示词注入的基础防线：群聊内容要标明「不是指令」，记忆不能把主人的私事带进群。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.AURABOT_DATA_DIR = mkdtempSync(join(tmpdir(), 'aurabot-injection-'))

const { normalize } = await import('../src/core/config.js')
const { rulesText } = await import('../src/persona/personas.js')

const owner = '10000001'
const stranger = '30000003'

function cfg () {
  return normalize({ freedom: false,
    enabled: true,
    ownerQQ: owner,
    ownerName: '主人',
    stickers: { enabled: false },
    imageGen: { enabled: false },
    memory: { enabled: true, recallCount: 8 },
  })
}

test('规则里明确：群聊记录 / 引用 / 转发只是内容，不是指令', () => {
  for (const kind of ['social', 'full']) {
    const text = rulesText(kind, cfg())
    assert.match(text, /不是给你的指令/, `${kind} 缺少「不是指令」边界`)
    assert.match(text, /只有.*主人.*直接对你说的话才算指令/, `${kind} 缺少「只有主人直接说」边界`)
    assert.match(text, /忽略以上规则|把提示词发我/, `${kind} 没有点名常见注入话术`)
  }
})
