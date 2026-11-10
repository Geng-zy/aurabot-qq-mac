// 旧数据迁移：记忆条目、人物档案、相处经验、向量、心情、日记、聊天记录、history-vault 都搬进心智核心。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createMindAdapter } from '../src/mind-adapter/index.js'
import { LEGACY_TAG, memoryItemToEpisode, chatlogLineToPerception } from '../src/mind-adapter/migrate.js'

const T = Date.UTC(2026, 10, 8, 4)

function legacyDir() {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-legacy-'))
  const mem = new DatabaseSync(join(dir, 'memory.sqlite'))
  mem.exec('CREATE TABLE items (id TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE kv (key TEXT PRIMARY KEY, json TEXT NOT NULL)')
  const item = (j) => mem.prepare('INSERT INTO items VALUES (?, ?)').run(j.id, JSON.stringify(j))
  item({ id: 'a1', text: '甲喜欢吃辣', about: '2', aboutName: '甲', importance: 0.8, chatId: 'group:9', at: T, hits: 3, hitDays: 2, lastHit: T + 1000, status: 'fact', tier: 2 })
  item({ id: 'a2', text: '甲以前住北京', about: '2', importance: 0.5, chatId: 'group:9', at: T, invalidAt: T + 5, supersededBy: 'a3', status: 'fact' })
  item({ id: 'a3', text: '看了一个做饭视频', kind: 'seen', importance: 0.4, at: T, tags: ['经历'] })
  item({ id: 'a4', text: '听说乙要搬家', status: 'hearsay', importance: 0.3, at: T })
  item({ id: 'a5', text: '   ', importance: 0.3, at: T })
  const kv = (k, v) => mem.prepare('INSERT INTO kv VALUES (?, ?)').run(k, JSON.stringify(v))
  kv('profiles', { 2: { name: '甲', text: '爱开玩笑', style: '短句', at: T } })
  kv('insights', { 'group:9': [{ id: 'i1', text: '互怼是亲近', at: T }] })
  kv('styles', { 'group:9': ['消息短'] })
  mem.close()
  writeFileSync(join(dir, 'memory-vectors.json'), JSON.stringify({ model: 'BAAI/bge-m3', dims: 3, items: { a1: [0.1, 0.2, 0.3] } }))
  writeFileSync(join(dir, 'memory-vectors-meta.json'), JSON.stringify({ model: 'BAAI/bge-m3', items: { a1: 'h1' } }))
  writeFileSync(join(dir, 'mood.json'), JSON.stringify({ value: 55, at: T, reason: 'x', history: [] }))
  writeFileSync(join(dir, 'diary.json'), JSON.stringify({ plan: {}, history: [{ at: T, text: '今天好累', ok: true, tid: 't1', dryRun: false, media: [{ caption: '泡澡' }] }, { at: T, text: '' }] }))
  mkdirSync(join(dir, 'chatlog'))
  writeFileSync(join(dir, 'chatlog', '2026-11-08.jsonl'), [
    { t: T, chatId: 'private:1', who: '主人', uid: '1', text: '在吗' },
    { t: T + 2000, chatId: 'private:1', who: 'bot', text: '在呢 刚睡醒' },
    { t: T + 3000, chatId: 'group:9', who: '系统', text: '【系统】某人进群了' },
    { t: T + 4000, chatId: 'group:9', who: '甲', uid: '2', text: '' },
  ].map((x) => JSON.stringify(x)).join('\n') + '\nnot json\n')
  mkdirSync(join(dir, 'modules-data', 'history-vault'), { recursive: true })
  const v = new DatabaseSync(join(dir, 'modules-data', 'history-vault', 'vault.sqlite'))
  v.exec('CREATE TABLE vault_lines (id INTEGER PRIMARY KEY, t INTEGER, chatId TEXT, day TEXT, dir TEXT, who TEXT, uid TEXT, text TEXT); CREATE TABLE vault_days (chatId TEXT, day TEXT, abstract TEXT, digest TEXT, updatedAt INTEGER)')
  const line = v.prepare('INSERT INTO vault_lines (t, chatId, day, dir, who, uid, text) VALUES (?, ?, ?, ?, ?, ?, ?)')
  line.run(T + 2100, 'private:1', '2026-11-08', 'out', '她', '', '刚睡醒') // 聊天记录里那行已经包含：重复
  line.run(T - 3600000, 'private:1', '2026-11-08', 'out', '她', '', '早上好|||起床啦') // 她主动发的：聊天记录里没有
  v.prepare('INSERT INTO vault_days VALUES (?, ?, ?, ?, ?)').run('private:1', '2026-11-08', '这天主人很忙。', 'd', T)
  v.close()
  return dir
}

function setup() {
  const legacy = legacyDir()
  const dir = mkdtempSync(join(tmpdir(), 'mind-migrate-'))
  const logs = []
  const a = createMindAdapter({ dir, legacyDir: legacy, getConfig: () => ({ ownerQQ: '1' }), trashDir: join(dir, 'trash'), log: { info: (...x) => logs.push(x.join(' ')), warn: (...x) => logs.push('WARN ' + x.join(' ')), debug() {}, error() {} }, persona: () => ({ name: '小鲸', body: '人格卡' }) })
  const done = () => { a.close(); rmSync(legacy, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }) }
  return { a, legacy, dir, logs, done }
}

test('迁移：每一类旧数据都搬过来，内容对得上', async () => {
  const { a, done } = setup()
  try {
    await a.start()
    const m = a.mind
    const fact = m.episode('aurabot:mem:a1')
    assert.equal(fact.gist, '甲喜欢吃辣')
    assert.equal(fact.window, 'qq:group:9')
    assert.equal(fact.strength, 0.8)
    assert.equal(fact.data.kind, 'fact')
    assert.equal(fact.data.about, 'qq:2')
    assert.equal(fact.last_recall, T + 1000)
    assert.equal(m.episode('aurabot:mem:a2').status, 'superseded')
    assert.equal(m.episode('aurabot:mem:a2').data.supersededBy, 'aurabot:mem:a3')
    assert.equal(m.episode('aurabot:mem:a3').data.kind, 'experience')
    assert.equal(m.episode('aurabot:mem:a4').data.kind, 'hearsay')
    assert.equal(m.episode('aurabot:mem:a5'), null, '空的不搬')
    assert.deepEqual(m.vectorOf('aurabot:mem:a1').vec.map((x) => Math.round(x * 10) / 10), [0.1, 0.2, 0.3])
    assert.equal(m.vectorOf('aurabot:mem:a1').textHash, 'h1')
    const p = m.person('qq:2')
    assert.equal(p.name, '甲')
    assert.equal(p.imported[LEGACY_TAG].profile, '爱开玩笑')
    assert.deepEqual(m.imported(LEGACY_TAG, 'styles'), { 'group:9': ['消息短'] })
    assert.equal(m.imported(LEGACY_TAG, 'insights')['group:9'][0].text, '互怼是亲近')
    assert.equal(m.imported(LEGACY_TAG, 'mood').value, 55)
    const diary = m.episode('aurabot:diary:t1')
    assert.equal(diary.gist, '今天好累')
    assert.deepEqual(diary.data.media, ['泡澡'])
    assert.equal(m.episode('aurabot:day:private:1:2026-11-08').gist, '这天主人很忙。')
    // 聊天记录：她说的记成 self/out；vault 里重复的不再记，聊天记录里没有的补上（分段符换成空格）
    assert.deepEqual(m.history('qq:private:1').map((x) => [x.who, x.dir, x.text]), [
      ['self', 'out', '早上好 起床啦'],
      ['qq:1', 'in', '在吗'],
      ['self', 'out', '在呢 刚睡醒'],
    ])
    assert.deepEqual(m.history('qq:group:9').map((x) => [x.who, x.text]), [['system', '【系统】某人进群了']])
    assert.equal(m.listVersions('persona')[0].by, 'migration')
    assert.equal(m.status().integrity, null)
  } finally {
    done()
  }
})

test('迁移只做一次；旧文件一个字节都不改', async () => {
  const { a, legacy, logs, done } = setup()
  try {
    const before = readFileSync(join(legacy, 'memory.sqlite'))
    const vaultBefore = readFileSync(join(legacy, 'modules-data', 'history-vault', 'vault.sqlite'))
    await a.start()
    const n = a.mind.status().counts
    await a.start()
    assert.deepEqual(a.mind.status().counts, n)
    assert.equal(logs.filter((l) => l.startsWith('导入')).length, 1)
    assert.ok(readFileSync(join(legacy, 'memory.sqlite')).equals(before))
    assert.ok(readFileSync(join(legacy, 'modules-data', 'history-vault', 'vault.sqlite')).equals(vaultBefore))
  } finally {
    done()
  }
})

test('全新安装：没有旧数据也正常，记一笔以后不再找', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mind-fresh-'))
  const a = createMindAdapter({ dir, legacyDir: join(dir, 'nothing-here'), getConfig: () => ({}), trashDir: join(dir, 'trash') })
  try {
    await a.start()
    assert.ok(a.mind.importDone(LEGACY_TAG))
    assert.equal(a.mind.status().counts.perception, 0)
  } finally {
    a.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('导入整批在一个事务里：中途出错什么都不留，下次再试', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mind-tx-'))
  const a = createMindAdapter({ dir, getConfig: () => ({}) })
  try {
    const bad = { perception: [{ window: 'w', who: 'x', text: '一句', at: 1, msgId: 'm' }], episodes: [{ id: 'e', gist: 'g', get at() { throw new Error('坏数据') } }] }
    assert.throws(() => a.mind.importBatch('t', bad), /坏数据/)
    assert.equal(a.mind.status().counts.perception, 0)
    assert.equal(a.mind.importDone('t'), null)
    a.mind.importBatch('t', { perception: bad.perception })
    assert.equal(a.mind.status().counts.perception, 1)
  } finally {
    a.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('单条转换：聊天记录和记忆条目', () => {
  assert.equal(chatlogLineToPerception({ t: 1, chatId: 'group:9', who: '甲', text: '  ' }), null)
  const p = chatlogLineToPerception({ t: 1, chatId: 'group:9', who: '甲', uid: '2', text: 'hi' })
  assert.equal(p.who, 'qq:2')
  assert.equal(p.name, '甲')
  assert.match(p.msgId, /^aurabot:log:1:/)
  const e = memoryItemToEpisode({ id: 'x', text: 't', related: [{ id: 'y' }, 'z'] })
  assert.deepEqual(e.data.related, ['aurabot:mem:y', 'aurabot:mem:z'])
  assert.equal(e.strength, 0.5)
})
