// 心智核心入口。
// 规矩：本目录不引用 Aurabot 的任何代码；外部服务（时间、日志、模型、DSH 会话）都由对接层注入。
// 第一阶段（骨架）：数据库、设置、身份（名字、小名、年龄生日、时区、专一）、人格卡版本、
// 感知记录（收到和发出的每条消息）、认识的人、版本管理、删除记录、快照备份。

import { join } from 'node:path'
import { readdirSync, statSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { openStore } from './store.js'
import { resolveSettings, paramOf, clampParam, PARAMS, GROUPS } from './params.js'
import { currentAge, dayKey, describeNow, isBirthday, validTimeZone } from './clock.js'
import { createBudget } from './budget.js'
import { createMemory } from './memory/index.js'
import { createSleep } from './memory/sleep.js'
import { createBody } from './body/index.js'
import { createEmotion } from './emotion/index.js'
import { createMotivation } from './motivation/index.js'
import { createInner } from './inner/index.js'
import { createPersonality } from './personality/index.js'
import { createSelf } from './self/index.js'
import { createRelations } from './relations/index.js'

export { PARAMS, GROUPS } from './params.js'

const noopLog = { debug() {}, info() {}, warn() {}, error() {} }

/**
 * @param {{
 *   dir: string,                         // 数据目录，数据库放在 dir/mind.sqlite
 *   ownerId?: string,                    // 主人的稳定 id，例如 'qq:12345'
 *   now?: () => number,                  // 取时间，默认系统时间
 *   log?: { debug: Function, info: Function, warn: Function, error: Function },
 *   memoryDb?: boolean,                  // 测试用：数据库放内存
 *   random?: () => number,               // 测试用：固定随机数
 * }} opts
 */
export function createMind(opts) {
  const log = opts.log || noopLog
  const now = opts.now || (() => Date.now())
  const file = opts.memoryDb ? ':memory:' : join(opts.dir, 'mind.sqlite')
  const store = openStore(file)
  let ownerId = opts.ownerId || ''

  // ---------- 设置 ----------
  function savedSettings() {
    return store.get('settings', {})
  }
  function settings() {
    return resolveSettings(savedSettings())
  }
  function setting(key) {
    return settings()[key]
  }
  /**
   * 改设置。by='owner' 才能改 ownerOnly 的项；她自己（by='self'）改不了。
   * 年龄会同时记下设置的时间，之后每过一次生日自动加一岁。
   */
  function updateSettings(patch, by = 'owner') {
    const saved = savedSettings()
    const changed = []
    for (const [key, value] of Object.entries(patch || {})) {
      const p = paramOf(key)
      if (!p) continue
      if (p.ownerOnly && by !== 'owner') throw new Error(`「${p.label}」只能由主人设置`)
      if (key === 'identity.timezone' && !validTimeZone(value)) throw new Error('时区不认识：' + value)
      saved[key] = clampParam(p, value)
      changed.push(key)
      if (key === 'identity.age') store.set('identity.ageSetAt', now())
    }
    store.set('settings', saved)
    return changed
  }
  function resetSetting(key) {
    const saved = savedSettings()
    delete saved[key]
    store.set('settings', saved)
  }

  const tz = () => setting('identity.timezone')

  // ---------- 身份 ----------
  function identity() {
    const s = settings()
    const t = now()
    const age = currentAge({ age: s['identity.age'], setAt: store.get('identity.ageSetAt', 0), birthday: s['identity.birthday'] }, t, s['identity.timezone'])
    const self = store.get('self', { name: '', nickname: '' })
    return {
      name: self.name || '',
      nickname: self.nickname || '',
      age,
      birthday: s['identity.birthday'] || '',
      isBirthdayToday: isBirthday(t, s['identity.timezone'], s['identity.birthday']),
      timezone: s['identity.timezone'],
      exclusive: s['identity.exclusive'] !== false,
      // 满 18 岁才有性欲；没填年龄按未满处理
      sexualDesire: age !== null && age >= 18,
      ownerId,
    }
  }
  function setOwner(id) {
    ownerId = String(id || '')
  }
  function isOwner(personId) {
    return Boolean(ownerId) && String(personId) === ownerId
  }
  /** 名字和小名（她改名后自动跟着变），加上主人额外加的昵称。 */
  function wakeWords(extra = []) {
    const { name, nickname } = identity()
    return [...new Set([name, nickname, ...extra].map((x) => String(x || '').trim()).filter(Boolean))]
  }

  // ---------- 人格卡与自我（带版本） ----------
  function personaCard() {
    return store.get('self.persona', '')
  }
  /**
   * 写人格卡。by：'owner' 主人在面板里改；'self' 她自己改；'migration' 迁移。
   * 每次都存一个版本，带理由。
   */
  function setPersonaCard(text, { by = 'owner', reason = '', name, nickname } = {}) {
    const card = String(text || '')
    return store.tx(() => {
      const self = store.get('self', { name: '', nickname: '' })
      if (name !== undefined) self.name = String(name || '').trim()
      if (nickname !== undefined) self.nickname = String(nickname || '').trim()
      store.set('self', self)
      store.set('self.persona', card)
      return addVersion('persona', { card, name: self.name, nickname: self.nickname }, { by, reason })
    })
  }

  // ---------- 版本 ----------
  function addVersion(kind, data, { by = 'owner', reason = '', pinned = false } = {}) {
    const r = store.prep('INSERT INTO versions (kind, at, by, reason, pinned, json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(kind, now(), by, reason, pinned ? 1 : 0, JSON.stringify(data))
    pruneVersions(kind)
    return Number(r.lastInsertRowid)
  }
  function listVersions(kind, limit = 100) {
    return store.prep('SELECT id, kind, at, by, reason, pinned, json FROM versions WHERE kind = ? ORDER BY id DESC LIMIT ?')
      .all(kind, limit).map((r) => ({ id: r.id, kind: r.kind, at: r.at, by: r.by, reason: r.reason, pinned: Boolean(r.pinned), data: JSON.parse(r.json) }))
  }
  function deleteVersion(id) {
    store.prep('DELETE FROM versions WHERE id = ?').run(Number(id))
  }
  function pinVersion(id, pinned = true) {
    store.prep('UPDATE versions SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, Number(id))
  }
  /** 超过保留数的旧版本自动清理；标为重要的不清，最新一个永远保留。 */
  function pruneVersions(kind) {
    const keep = Math.max(1, Number(setting('memory.versionKeep')) || 50)
    const ids = store.prep('SELECT id FROM versions WHERE kind = ? AND pinned = 0 ORDER BY id DESC').all(kind).map((r) => r.id)
    for (const id of ids.slice(keep)) store.prep('DELETE FROM versions WHERE id = ?').run(id)
  }
  /** 退回到某个人格卡版本（会新存一个版本，写明是退回）。 */
  function restorePersona(id) {
    const row = store.prep("SELECT json FROM versions WHERE id = ? AND kind = 'persona'").get(Number(id))
    if (!row) throw new Error('没有这个版本')
    const v = JSON.parse(row.json)
    return setPersonaCard(v.card, { by: 'owner', reason: `退回到版本 ${id}`, name: v.name, nickname: v.nickname })
  }

  // ---------- 认识的人 ----------
  function person(id) {
    const row = store.prep('SELECT json FROM people WHERE id = ?').get(String(id))
    return row ? JSON.parse(row.json) : null
  }
  /** 记下或更新一个人：名字变了会留下曾用名。 */
  function notePerson(id, { name } = {}) {
    const key = String(id)
    const p = person(key) || { id: key, name: '', aliases: [], firstSeen: now(), lastSeen: 0 }
    const n = String(name || '').trim()
    if (n && n !== p.name) {
      if (p.name && !p.aliases.includes(p.name)) p.aliases.push(p.name)
      p.name = n
    }
    p.lastSeen = now()
    store.prep('INSERT INTO people (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(key, JSON.stringify(p))
    return p
  }
  function listPeople() {
    return store.prep('SELECT json FROM people').all().map((r) => JSON.parse(r.json))
  }
  function savePerson(p) {
    store.prep('INSERT INTO people (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(String(p.id), JSON.stringify(p))
  }

  // ---------- 感知记录 ----------
  /**
   * 记一条收到的消息。
   * @param {{ window: string, who: string, name?: string, text: string, msgId?: string, at?: number, seen?: 'replied'|'ignored'|'pending' }} m
   * @returns {boolean} 是否新记下（重复投递返回 false）
   */
  function perceive(m) {
    const at = Number(m.at) || now()
    if (m.who) notePerson(m.who, { name: m.name })
    const r = store.prep('INSERT OR IGNORE INTO perception (at, window, who, dir, text, msg_id, json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(at, String(m.window), String(m.who || ''), 'in', String(m.text || ''), m.msgId ? String(m.msgId) : null, JSON.stringify({ name: m.name || '', seen: m.seen || 'pending' }))
    return r.changes > 0
  }
  /**
   * 记一条她发出去的话。所有出口（回复、命令回复、发文件、主动找人、模块代发）都要走这里。
   * @param {{ window: string, text: string, msgId?: string, at?: number, kind?: string }} m
   */
  function said(m) {
    const at = Number(m.at) || now()
    const r = store.prep('INSERT OR IGNORE INTO perception (at, window, who, dir, text, msg_id, json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(at, String(m.window), 'self', 'out', String(m.text || ''), m.msgId ? String(m.msgId) : null, JSON.stringify({ kind: m.kind || 'reply' }))
    return r.changes > 0
  }
  /** 「翻聊天记录」：按窗口和时间取原话。 */
  function history(window, { since = 0, until = Infinity, limit = 200 } = {}) {
    return store.prep('SELECT at, who, dir, text FROM perception WHERE window = ? AND at >= ? AND at <= ? ORDER BY at DESC, id DESC LIMIT ?')
      .all(String(window), since, Number.isFinite(until) ? until : 8.64e15, limit).reverse()
  }

  // ---------- 批量导入（迁移旧数据、从别的系统搬家） ----------
  /**
   * 一次性导入一批数据，整批在一个事务里，失败整体回滚。
   * 同一个 tag 只导一次（再调直接返回上次的结果）；每条都有稳定 id，重复的自动跳过。
   * @param {string} tag 这批数据的名字，例如 'aurabot-legacy-v1'
   * @param {{
   *   perception?: Array<{ window: string, who: string, dir?: 'in'|'out', name?: string, text: string, at: number, msgId: string }>,
   *   episodes?: Array<{ id: string, at: number, window?: string, gist: string, detail?: string, strength?: number, stability?: number, lastRecall?: number, status?: string, data?: object }>,
   *   people?: Array<{ id: string, name?: string, data?: object }>,
   *   vectors?: Array<{ id: string, model: string, vec: number[], textHash?: string }>,
   *   notes?: Record<string, any>,
   * }} bundle
   */
  function importBatch(tag, bundle = {}) {
    const doneKey = 'import.' + tag
    const done = store.get(doneKey)
    if (done) return { ...done, skipped: true }
    const counts = store.tx(() => {
      const c = { perception: 0, episodes: 0, people: 0, vectors: 0, notes: 0 }
      const pIns = store.prep('INSERT OR IGNORE INTO perception (at, window, who, dir, text, msg_id, json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      for (const m of bundle.perception || []) {
        if (!m.window || !m.msgId || !String(m.text || '').trim()) continue
        const r = pIns.run(Number(m.at) || 0, String(m.window), String(m.who || ''), m.dir === 'out' ? 'out' : 'in', String(m.text), String(m.msgId), JSON.stringify({ name: m.name || '', source: tag }))
        c.perception += r.changes
      }
      const eIns = store.prep('INSERT OR IGNORE INTO episodes (id, at, window, gist, detail, strength, stability, last_recall, status, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      for (const e of bundle.episodes || []) {
        if (!e.id || !String(e.gist || '').trim()) continue
        const strength = Math.min(1, Math.max(0, Number(e.strength ?? 0.5)))
        const stability = Math.max(0.1, Number(e.stability ?? 1))
        const r = eIns.run(String(e.id), Number(e.at) || 0, e.window ? String(e.window) : null, String(e.gist), e.detail ? String(e.detail) : null, strength, stability, e.lastRecall ? Number(e.lastRecall) : null, String(e.status || 'live'), JSON.stringify({ ...(e.data || {}), source: tag }))
        c.episodes += r.changes
      }
      for (const p of bundle.people || []) {
        if (!p.id) continue
        const key = String(p.id)
        const cur = person(key) || { id: key, name: '', aliases: [], firstSeen: now(), lastSeen: 0 }
        const n = String(p.name || '').trim()
        if (n && !cur.name) cur.name = n
        else if (n && n !== cur.name && !cur.aliases.includes(n)) cur.aliases.push(n)
        cur.imported = { ...(cur.imported || {}), [tag]: p.data || {} }
        store.prep('INSERT INTO people (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(key, JSON.stringify(cur))
        c.people++
      }
      const vIns = store.prep('INSERT OR IGNORE INTO vectors (id, model, dim, text_hash, vec) VALUES (?, ?, ?, ?, ?)')
      for (const v of bundle.vectors || []) {
        if (!v.id || !Array.isArray(v.vec) || !v.vec.length) continue
        const r = vIns.run(String(v.id), String(v.model || ''), v.vec.length, v.textHash ? String(v.textHash) : null, new Uint8Array(new Float32Array(v.vec).buffer))
        c.vectors += r.changes
      }
      for (const [k, v] of Object.entries(bundle.notes || {})) {
        if (v === undefined || v === null) continue
        store.set(`imported.${tag}.${k}`, v)
        c.notes++
      }
      const out = { at: now(), counts: c }
      store.set(doneKey, out)
      return out
    })
    log.info(`导入 ${tag}：`, JSON.stringify(counts.counts))
    return counts
  }
  /** 导入时存下、后面阶段还要用的原始资料（相处经验、说话方式、心情记录等）。 */
  function imported(tag, key) {
    return store.get(`imported.${tag}.${key}`, null)
  }
  function importDone(tag) {
    return store.get('import.' + tag, null)
  }
  /** 取一条向量（按 episodes.id）。 */
  function vectorOf(id) {
    const r = store.prep('SELECT model, dim, text_hash, vec FROM vectors WHERE id = ?').get(String(id))
    if (!r) return null
    const b = r.vec
    return { model: r.model, dim: r.dim, textHash: r.text_hash, vec: Array.from(new Float32Array(b.buffer, b.byteOffset, r.dim)) }
  }
  function episode(id) {
    const r = store.prep('SELECT * FROM episodes WHERE id = ?').get(String(id))
    return r ? { ...r, data: JSON.parse(r.json) } : null
  }

  // ---------- 删除 ----------
  function recordDeletion(id, kind) {
    store.prep('INSERT OR REPLACE INTO deletions (id, kind, at) VALUES (?, ?, ?)').run(String(id), String(kind), now())
  }
  function deletions() {
    return store.prep('SELECT id, kind, at FROM deletions').all()
  }

  // ---------- 备份 ----------
  /** 存一份快照到 dir/snapshots/，按保留份数清理旧的（移到 trashDir，不直接删）。 */
  function snapshot({ keep = 14, trashDir } = {}) {
    if (opts.memoryDb) throw new Error('内存数据库不做快照')
    const dir = join(opts.dir, 'snapshots')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
    const target = join(dir, `mind-${stamp}.sqlite`)
    store.snapshot(target)
    const files = readdirSync(dir).filter((f) => /^mind-.*\.sqlite$/.test(f)).sort()
    const old = files.slice(0, Math.max(0, files.length - keep))
    for (const f of old) {
      if (trashDir) {
        mkdirSync(trashDir, { recursive: true })
        renameSync(join(dir, f), join(trashDir, f))
      }
    }
    return target
  }
  /** 给外部备份用：整个数据库的完整字节。 */
  function backupBytes() {
    return store.bytes()
  }
  /** 导出一份完整数据（同快照，放到指定位置）。 */
  function exportTo(target) {
    return store.snapshot(target)
  }

  // ---------- 记忆 ----------
  const budget = createBudget({ store, today: () => dayKey(now(), tz()), setting })
  // ---------- 人格、自我、关系 ----------
  const self = createSelf({ store, now, setting, log, identity: () => identity(), personaCard: () => personaCard(), setPersonaCard: (...a) => setPersonaCard(...a), addVersion: (...a) => addVersion(...a), listVersions: (...a) => listVersions(...a) })
  const personality = createPersonality({ store, now, setting, tz, log, isOwner: (id) => isOwner(id), addVersion: (...a) => addVersion(...a), listVersions: (...a) => listVersions(...a), goals: () => self.goals() })
  const relations = createRelations({ store, now, setting, log, identity: () => identity(), isOwner: (id) => isOwner(id), person: (id) => person(id), savePerson, listPeople: () => listPeople(), trustBase: () => personality.value('trust') })
  // ---------- 身体和情绪 ----------
  const body = createBody({ store, now, setting, tz, log })
  const emotion = createEmotion({ store, now, setting, log, random: opts.random, identity: () => identity(), isOwner: (id) => isOwner(id), person: (id) => person(id), closeness: (id) => relations.closeness(id), trait: (id) => personality.value(id) })
  /** 此刻的身体和心情（记忆、说话方式都看它）。 */
  function feeling() {
    const b = body.state()
    const e = emotion.state(b)
    return { body: b, mood: e.mood, emotions: e.active }
  }

  const memory = createMemory({
    store, now, setting, log, budget, tz,
    random: opts.random,
    identity: () => identity(),
    person: (id) => person(id),
    recordDeletion: (id, kind) => recordDeletion(id, kind),
    onRecalled: (list, { window } = {}) => emotion.rekindle(list, { window }),
  })
  // 记得多牢、心境一致都看此刻真实的心情和精力
  memory.connect({
    state: () => { const f = feeling(); return { valence: f.mood.v, energy: f.body.energy } },
    // 记经历时顺带：人格的状态记录（她这次比平时更……）、对人的看法、对群的了解
    encodeExtra: () => personality.encodeAsk() + '\n' + relations.encodeAsk(),
    onEncoded: ({ window, rows, parsed }) => {
      personality.observe(parsed, { window, rows })
      relations.observe(parsed, { window, rows })
    },
  })
  const sleeper = createSleep(memory, {
    store, now, setting, log, tz, random: opts.random, identity: () => identity(),
    nightly: () => [
      ['personality', () => personality.nightly()],
      ['relations', () => relations.nightly()],
      ['story', () => self.updateStory({
        ask: (scene, system, text, maxTokens) => memory.ask(scene, system, text, maxTokens),
        episodes: () => store.prep("SELECT id, at, gist, json FROM episodes WHERE status = 'live' AND at >= ? ORDER BY at DESC LIMIT 200").all(now() - 7 * 86400000)
          .map((r) => ({ id: r.id, at: r.at, gist: r.gist, ...JSON.parse(r.json) }))
          .filter((e) => (e.importance || 0) >= 0.7 || (e.emotion?.intensity || 0) >= 0.7)
          .sort((a, b) => a.at - b.at),
      })],
    ],
  })

  /** 她是谁（放进系统提示词开头）：当前版本的人格卡、她自己写的价值观等、自我故事摘要、不知不觉的变化和小习惯。 */
  function selfPrompt() {
    return [self.prompt(), personality.selfText()].filter((x) => String(x || '').trim()).join('\n\n')
  }

  // ---------- 动机和内心活动 ----------
  // 尽责性里的「勤快」越低越容易分心拖着（Steel 2007 的 Γ）
  const motivation = createMotivation({ store, now, setting, log, distractScale: () => 1.5 - personality.value('productiveness') })
  const inner = createInner({
    store, now, setting, tz, log, random: opts.random, memory, emotion, body, motivation, budget,
    identity: () => identity(), isOwner: (id) => isOwner(id), person: (id) => person(id),
  })

  // ---------- 给她看的「此刻」 ----------
  function nowText() {
    return describeNow(now(), tz())
  }
  function today() {
    return dayKey(now(), tz())
  }

  function status() {
    const id = identity()
    return {
      identity: id,
      now: nowText(),
      today: today(),
      counts: {
        perception: store.prep('SELECT COUNT(*) AS n FROM perception').get().n,
        episodes: store.prep("SELECT COUNT(*) AS n FROM episodes WHERE status = 'live'").get().n,
        people: store.prep('SELECT COUNT(*) AS n FROM people').get().n,
        versions: store.prep('SELECT COUNT(*) AS n FROM versions').get().n,
        vectors: store.prep('SELECT COUNT(*) AS n FROM vectors').get().n,
        memory: memory.counts(),
      },
      integrity: store.check(),
    }
  }

  return {
    // 设置
    settings, setting, updateSettings, resetSetting, savedSettings,
    // 身份
    identity, setOwner, isOwner, wakeWords,
    // 人格卡与版本
    personaCard, setPersonaCard, restorePersona, addVersion, listVersions, deleteVersion, pinVersion,
    // 人
    person, notePerson, listPeople,
    // 感知
    perceive, said, history,
    // 导入
    importBatch, imported, importDone, vectorOf, episode,
    // 删除、备份
    recordDeletion, deletions, snapshot, exportTo, backupBytes,
    // 记忆、睡觉、预算
    memory, sleep: sleeper.sleep, sleeper, budget,
    // 身体、情绪
    body, emotion, feeling,
    // 动机、内心活动
    motivation, inner,
    // 人格、自我、关系
    personality, self, relations, selfPrompt, savePerson,
    // 其他
    nowText, today, status,
    close: () => store.close(),
    _store: store,
  }
}

export function mindFileExists(dir) {
  return existsSync(join(dir, 'mind.sqlite')) && statSync(join(dir, 'mind.sqlite')).size > 0
}
