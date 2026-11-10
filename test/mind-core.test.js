// 心智核心第一阶段（骨架）的测试：设置、身份、版本、感知记录、快照、时间。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMind, PARAMS } from '../src/mind/index.js'
import { currentAge, dayKey, isBirthday, localParts, parseBirthday, parseRange, inRange, minuteOfDay } from '../src/mind/clock.js'
import { resolveSettings, defaults } from '../src/mind/params.js'

const T0 = Date.UTC(2026, 10, 10, 2, 0, 0) // 2026-11-10 10:00 上海

function mind(at = T0, extra = {}) {
  let t = at
  const m = createMind({ memoryDb: true, now: () => t, ownerId: 'qq:1', ...extra })
  return { m, set: (v) => { t = v } }
}

test('参数表：每个参数都有来源、说明和合法默认值，键不重复', () => {
  const keys = new Set()
  for (const p of PARAMS) {
    assert.ok(!keys.has(p.key), '重复的键 ' + p.key)
    keys.add(p.key)
    assert.ok(p.source && p.hint && p.label, p.key + ' 缺来源或说明')
    if (typeof p.def === 'number') assert.ok(p.def >= (p.min ?? -Infinity) && p.def <= (p.max ?? Infinity), p.key + ' 默认值越界')
  }
})

test('参数默认值里不出现某个具体角色的设定', () => {
  const text = JSON.stringify(PARAMS)
  for (const word of ['大肥鱼', '烤串', '鲸鱼', 'Dr. Romantic']) assert.ok(!text.includes(word), '出现了 ' + word)
})

test('设置：夹紧范围、丢掉未知键', () => {
  const s = resolveSettings({ 'memory.reconsolidation': 0.9, 'nope.key': 1, 'attention.single': 0 })
  assert.equal(s['memory.reconsolidation'], 0.5)
  assert.equal(s['attention.single'], false)
  assert.ok(!('nope.key' in s))
  assert.equal(defaults()['personality.ownerInfluenceCap'], 0.6)
})

test('只能主人改的设置，她自己改不了', () => {
  const { m } = mind()
  assert.throws(() => m.updateSettings({ 'identity.age': 30 }, 'self'), /只能由主人设置/)
  assert.throws(() => m.updateSettings({ 'identity.exclusive': false }, 'self'), /只能由主人设置/)
  m.updateSettings({ 'emotion.contagion': 0.5 }, 'self')
  assert.equal(m.setting('emotion.contagion'), 0.5)
})

test('时区非法时拒绝', () => {
  const { m } = mind()
  assert.throws(() => m.updateSettings({ 'identity.timezone': 'Mars/Base' }), /时区不认识/)
  m.updateSettings({ 'identity.timezone': 'America/New_York' })
  assert.equal(m.identity().timezone, 'America/New_York')
})

test('年龄：没填按未满 18，性欲关；满 18 才开', () => {
  const { m } = mind()
  assert.equal(m.identity().age, null)
  assert.equal(m.identity().sexualDesire, false)
  m.updateSettings({ 'identity.age': 17, 'identity.birthday': '11-09' })
  assert.equal(m.identity().sexualDesire, false)
  m.updateSettings({ 'identity.age': 18 })
  assert.equal(m.identity().sexualDesire, true)
})

test('生日到了自动长一岁，按她的时区', () => {
  const { m, set } = mind()
  m.updateSettings({ 'identity.age': 17, 'identity.birthday': '11-11', 'identity.timezone': 'Asia/Shanghai' })
  assert.equal(m.identity().age, 17)
  // 上海 11-11 00:30 = UTC 11-10 16:30
  set(Date.UTC(2026, 10, 10, 16, 30))
  assert.equal(m.identity().age, 18)
  assert.equal(m.identity().isBirthdayToday, true)
  assert.equal(m.identity().sexualDesire, true)
  set(Date.UTC(2028, 10, 12))
  assert.equal(m.identity().age, 19 + 1)
})

test('设置年龄的那天正好过了生日，要等明年才加', () => {
  // 11-10 设置 18 岁，生日 11-09（已经过了）
  assert.equal(currentAge({ age: 18, setAt: T0, birthday: '11-09' }, T0 + 86400000 * 300, 'Asia/Shanghai'), 18)
  assert.equal(currentAge({ age: 18, setAt: T0, birthday: '11-09' }, Date.UTC(2027, 10, 9, 1), 'Asia/Shanghai'), 19)
})

test('2 月 29 日生日在平年按 2 月 28 日过', () => {
  assert.equal(isBirthday(Date.UTC(2027, 1, 28, 4), 'Asia/Shanghai', '02-29'), true)
  assert.equal(isBirthday(Date.UTC(2028, 1, 28, 4), 'Asia/Shanghai', '02-29'), false)
  assert.equal(isBirthday(Date.UTC(2028, 1, 29, 4), 'Asia/Shanghai', '02-29'), true)
})

test('唤醒词：名字和小名，改名后跟着变', () => {
  const { m } = mind()
  m.setPersonaCard('人格卡正文', { name: '小鲸', nickname: '' })
  assert.deepEqual(m.wakeWords(), ['小鲸'])
  m.setPersonaCard('人格卡正文', { name: '小鲸', nickname: '鲸鲸' })
  assert.deepEqual(m.wakeWords(['额外昵称']), ['小鲸', '鲸鲸', '额外昵称'])
  m.setPersonaCard('人格卡正文', { name: '潮', by: 'self', reason: '想换个名字' })
  assert.deepEqual(m.wakeWords(), ['潮', '鲸鲸'])
})

test('人格卡每次修改都存版本，可以退回、删除、超量自动清理', () => {
  const { m } = mind()
  m.updateSettings({ 'memory.versionKeep': 5 })
  const first = m.setPersonaCard('第一版', { name: 'A' })
  for (let i = 2; i <= 8; i++) m.setPersonaCard('第' + i + '版', { by: 'self', reason: 'r' + i })
  let vs = m.listVersions('persona')
  assert.equal(vs.length, 5)
  assert.equal(vs[0].data.card, '第8版')
  assert.equal(vs[0].by, 'self')
  // 被清掉的第一版不能退回
  assert.throws(() => m.restorePersona(first), /没有这个版本/)
  m.pinVersion(vs[4].id)
  m.restorePersona(vs[2].id)
  assert.equal(m.personaCard(), vs[2].data.card)
  vs = m.listVersions('persona')
  assert.match(vs[0].reason, /退回到版本/)
  assert.ok(vs.some((v) => v.pinned))
  m.deleteVersion(vs[1].id)
  assert.ok(!m.listVersions('persona').some((v) => v.id === vs[1].id))
})

test('感知记录：同一条消息重复投递只记一次；发出的话也记', () => {
  const { m } = mind()
  assert.equal(m.perceive({ window: 'qq:group:9', who: 'qq:2', name: '甲', text: '你好', msgId: 'm1' }), true)
  assert.equal(m.perceive({ window: 'qq:group:9', who: 'qq:2', name: '甲', text: '你好', msgId: 'm1' }), false)
  assert.equal(m.said({ window: 'qq:group:9', text: '你好呀', kind: 'reply' }), true)
  const h = m.history('qq:group:9')
  assert.deepEqual(h.map((r) => [r.who, r.dir, r.text]), [['qq:2', 'in', '你好'], ['self', 'out', '你好呀']])
})

test('认识的人：按 id 认人，改名后留下曾用名', () => {
  const { m } = mind()
  m.perceive({ window: 'w', who: 'qq:3', name: '老王', text: 'a' })
  m.perceive({ window: 'w', who: 'qq:3', name: '王二', text: 'b' })
  const p = m.person('qq:3')
  assert.equal(p.name, '王二')
  assert.deepEqual(p.aliases, ['老王'])
  assert.equal(m.isOwner('qq:1'), true)
  assert.equal(m.isOwner('qq:3'), false)
})

test('快照：写到 snapshots 目录，超量的移到指定的废纸篓目录', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mind-test-'))
  const trash = join(dir, 'trash')
  let t = T0
  const m = createMind({ dir, now: () => t })
  try {
    m.perceive({ window: 'w', who: 'qq:2', text: 'x' })
    for (let i = 0; i < 4; i++) { t += 1000; m.snapshot({ keep: 2, trashDir: trash }) }
    assert.equal(readdirSync(join(dir, 'snapshots')).length, 2)
    assert.equal(readdirSync(trash).length, 2)
    assert.equal(m.status().integrity, null)
  } finally {
    m.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('时间工具：按时区算日期、时段可以跨午夜', () => {
  assert.equal(dayKey(T0, 'Asia/Shanghai'), '2026-11-10')
  assert.equal(dayKey(T0, 'America/Los_Angeles'), '2026-11-09')
  assert.equal(localParts(T0, 'Asia/Shanghai').hour, 10)
  const night = parseRange('23:30-07:30')
  assert.equal(inRange(23 * 60 + 45, night), true)
  assert.equal(inRange(8 * 60, night), false)
  assert.equal(minuteOfDay(T0, 'Asia/Shanghai'), 600)
  assert.deepEqual(parseBirthday('11-09'), { month: 11, day: 9 })
  assert.equal(parseBirthday('13-01'), null)
})
