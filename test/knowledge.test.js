import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('知识库：检索、读取、写笔记都限制在 knowledge 目录内', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aurabot-knowledge-'))
  process.env.AURABOT_DATA_DIR = root
  const { createKnowledge } = await import('../src/features/knowledge.js')
  const kb = createKnowledge()
  mkdirSync(join(root, 'knowledge', 'raw', '设定'), { recursive: true })
  writeFileSync(join(root, 'knowledge', 'raw', '设定', '鱼.md'), '# 鱼\n她喜欢白米饭和下雨天。')
  writeFileSync(join(root, 'knowledge', 'raw', '设定', '群限定.md'), '---\nscope: qq:group:9\n---\n白米饭只在九群说。')
  const hit = kb.search('白米饭')
  assert.equal(hit.length, 1)
  assert.match(hit[0].path, /设定\/鱼\.md$/)
  assert.match(kb.read(hit[0].path, { chatId: 'qq:private:1' }).text, /白米饭/)
  assert.equal(kb.search('白米饭', { chatId: 'qq:private:1' }).some((x) => x.path.includes('群限定')), false)
  assert.equal(kb.search('白米饭', { chatId: 'qq:group:9' }).some((x) => x.path.includes('群限定')), true)
  assert.equal(kb.read('../secret'), null)
  const note = kb.createNote('临时/笔记', '记住这句话', { scope: 'qq:group:9', folder: '资料/子目录' })
  assert.equal(note.ok, true)
  assert.match(note.path, /notes\/资料\/子目录\//)
  assert.match(kb.read(note.path, { chatId: 'qq:group:9' }).text, /记住这句话/)
  assert.equal(kb.read(note.path, { chatId: 'qq:private:1' }), null)
  const renamed = kb.rename(note.path, '改名笔记')
  assert.equal(renamed.ok, true)
  assert.match(renamed.path, /改名笔记\.md$/)
  assert.equal(kb.remove(renamed.path).ok, true)
  assert.equal(kb.read(renamed.path, { chatId: 'qq:group:9' }), null)
  assert.equal(kb.read(note.path, { chatId: 'qq:group:9' }), null)
  assert.equal(kb.remove('../secret').ok, false)
})
