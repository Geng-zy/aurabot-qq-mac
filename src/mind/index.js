// 心智核心入口。
// 规矩：本目录不引用 Aurabot 的任何代码；外部服务（时间、日志、模型、宿主的会话、聊天平台）都由对接层注入；不认识任何聊天平台。
// 第一阶段（骨架）：数据库、设置、身份（名字、小名、年龄生日、时区、专一）、人格卡版本、
// 感知记录（收到和发出的每条消息）、认识的人、版本管理、删除记录、快照备份。

import { join } from 'node:path'
import { appendFileSync, readFileSync, readdirSync, statSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { openRecoverableStore, GENERATED_COLUMNS } from './store.js'
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
import { makePlace, shortId } from './place.js'
import { createConversation } from './conversation.js'

export { PARAMS, GROUPS } from './params.js'
export { placeOf, shortId } from './place.js'

const noopLog = { debug() {}, info() {}, warn() {}, error() {} }

/**
 * @param {{
 *   dir: string,                         // 数据目录，数据库放在 dir/mind.sqlite
 *   ownerId?: string,                    // 主人的稳定 id，例如 'qq:12345'（平台:账号）
 *   place?: (window: string) => { kind: 'private'|'group'|'other', id?: string, platform?: string }, // 窗口是私聊还是群；不给就按「平台:private|group:id」认
 *   now?: () => number,                  // 取时间，默认系统时间
 *   log?: { debug: Function, info: Function, warn: Function, error: Function },
 *   memoryDb?: boolean,                  // 测试用：数据库放内存
 *   random?: () => number,               // 测试用：固定随机数
 *   model?: (request: { scene: string, system: string, text: string, maxTokens: number, signal?: AbortSignal }) => Promise<string | { text: string, tokens?: number }>,
 * }} opts
 */
export function createMind(opts) {
  const log = opts.log || noopLog
  const now = opts.now || (() => Date.now())
  const file = opts.memoryDb ? ':memory:' : join(opts.dir, 'mind.sqlite')
  const { store, recovered } = openRecoverableStore(file)
  if (recovered) log.warn('心智数据库已从快照恢复：', recovered.snapshot)
  const deletionLog = opts.memoryDb ? '' : join(opts.dir, 'deletions.jsonl')
  const place = makePlace(opts.place)

  // ---------- 同一个人在不同平台的 id ----------
  // 主人或朋友在 QQ、微信、飞书上各有一个 id：连起来以后都算同一个人（记忆、关系、主人身份都通用）。
  // kv 'person.same'：{ 别的 id → 主 id }，只有一层。
  function sameMap() { return store.get('person.same', {}) || {} }
  /** 这个 id 实际是谁（连过就给主 id）。 */
  function canon(id) {
    const k = String(id || '')
    return (k && sameMap()[k]) || k
  }
  let ownerId = canon(opts.ownerId || '')

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
    ownerId = canon(id)
  }
  function isOwner(personId) {
    return Boolean(ownerId) && canon(personId) === canon(ownerId)
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
  function publicPersona() {
    const saved = store.get('self.publicPersona', null)
    if (saved) return saved
    const last = store.prep("SELECT json FROM versions WHERE kind = 'persona' AND by IN ('owner', 'migration') AND coalesce(json_extract(json, '$.published'), 1) = 1 ORDER BY id DESC LIMIT 1").get()
    return last ? JSON.parse(last.json) : { card: '', name: '', nickname: '' }
  }
  /**
   * 写人格卡。by：'owner' 主人在面板里改；'self' 她自己改；'migration' 迁移。
   * 每次都存一个版本，带理由。
   */
  function setPersonaCard(text, { by = 'owner', reason = '', name, nickname, publish = by === 'owner' || by === 'migration' } = {}) {
    const card = String(text || '')
    return store.tx(() => {
      const self = store.get('self', { name: '', nickname: '' })
      if (name !== undefined) self.name = String(name || '').trim()
      if (nickname !== undefined) self.nickname = String(nickname || '').trim()
      const version = { card, name: self.name, nickname: self.nickname }
      store.set('self.publicPersona', publish ? version : publicPersona())
      store.set('self', self)
      store.set('self.persona', card)
      return addVersion('persona', { ...version, published: publish }, { by, reason })
    })
  }

  // ---------- 版本 ----------
  function addVersion(kind, data, { by = 'owner', reason = '', pinned = false } = {}) {
    const r = store.prep('INSERT INTO versions (kind, at, by, reason, pinned, json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(kind, now(), by, reason, pinned ? 1 : 0, JSON.stringify(data))
    pruneVersions(kind)
    return Number(r.lastInsertRowid)
  }
  function listVersions(kind, limit = 100, before = Number.MAX_SAFE_INTEGER) {
    return store.prep('SELECT id, kind, at, by, reason, pinned, json FROM versions WHERE kind = ? AND id < ? ORDER BY id DESC LIMIT ?')
      .all(kind, before, limit).map((r) => ({ id: r.id, kind: r.kind, at: r.at, by: r.by, reason: r.reason, pinned: Boolean(r.pinned), data: JSON.parse(r.json) }))
  }
  function deleteVersion(id) {
    return Number(store.prep('DELETE FROM versions WHERE id = ?').run(Number(id)).changes)
  }
  function deleteVersions(kind, { from, through }) {
    if (!['persona', 'self', 'traits', 'habits'].includes(kind) || !Number.isFinite(from) || !Number.isFinite(through) || from >= through) {
      throw new Error('请填写有效的版本类别和日期范围')
    }
    return Number(store.prep(`DELETE FROM versions WHERE kind = ? AND at >= ? AND at < ? AND pinned = 0
      AND id <> (SELECT max(id) FROM versions WHERE kind = ?)`).run(kind, from, through, kind).changes)
  }
  function getVersion(id) {
    const row = store.prep('SELECT id, kind, at, by, reason, pinned, json FROM versions WHERE id = ?').get(Number(id))
    return row ? { id: row.id, kind: row.kind, at: row.at, by: row.by, reason: row.reason, pinned: Boolean(row.pinned), data: JSON.parse(row.json) } : null
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
    const row = store.prep("SELECT by, json FROM versions WHERE id = ? AND kind = 'persona'").get(Number(id))
    if (!row) throw new Error('没有这个版本')
    const v = JSON.parse(row.json)
    const publish = ['owner', 'migration'].includes(row.by) && v.published !== false
    return setPersonaCard(v.card, { by: 'owner', reason: `退回到版本 ${id}`, name: v.name, nickname: v.nickname, publish })
  }

  // ---------- 认识的人 ----------
  function person(id) {
    const row = store.prep('SELECT json FROM people WHERE id = ?').get(canon(id))
    return row ? JSON.parse(row.json) : null
  }
  /** 记下或更新一个人：名字变了会留下曾用名。 */
  function notePerson(id, { name } = {}) {
    const key = canon(id)
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
    const id = canon(p.id)
    store.prep('INSERT INTO people (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(id, JSON.stringify({ ...p, id }))
  }

  /**
   * 「这两个 id 是同一个人」（比如主人的 QQ 和微信）：other 并进 main。
   * 名字留作曾用名，关系以 main 的为准（main 还没有就用 other 的），原话和经历里的 id 都改成 main。
   * 以后 other 发来的消息都算 main 的。
   */
  function linkPerson(otherId, mainId) {
    const other = String(otherId || '').trim()
    const main = canon(mainId)
    if (!other || !main || canon(other) === main) return { ok: false, message: canon(other) === main ? '已经是同一个人了' : 'id 是空的' }
    if (isOwner(other) && !isOwner(main)) return { ok: false, message: '要把别的 id 连到主人身上，不能反过来' }
    const from = canon(other)
    store.tx(() => {
      const map = sameMap()
      // 原来连到 from 的也都改连 main
      for (const [k, v] of Object.entries(map)) if (v === from) map[k] = main
      map[from] = main
      if (other !== from) map[other] = main
      store.set('person.same', map)
      const a = store.prep('SELECT json FROM people WHERE id = ?').get(from)
      const b = store.prep('SELECT json FROM people WHERE id = ?').get(main)
      const pa = a ? JSON.parse(a.json) : null
      const pb = b ? JSON.parse(b.json) : { id: main, name: pa?.name || '', aliases: [], firstSeen: pa?.firstSeen || now(), lastSeen: 0 }
      if (pa) {
        const names = [pa.name, ...(pa.aliases || [])].filter((n) => n && n !== pb.name && !(pb.aliases || []).includes(n))
        pb.aliases = [...(pb.aliases || []), ...names]
        pb.firstSeen = Math.min(pb.firstSeen || Infinity, pa.firstSeen || Infinity)
        pb.lastSeen = Math.max(pb.lastSeen || 0, pa.lastSeen || 0)
        if (!pb.rel && pa.rel) pb.rel = pa.rel
        if (!pb.tom && pa.tom) pb.tom = pa.tom
        store.prep('DELETE FROM people WHERE id = ?').run(from)
      }
      pb.ids = [...new Set([...(pb.ids || []), ...(pa?.ids || []), from, other])].filter((x) => x !== main)
      store.prep('INSERT INTO people (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(main, JSON.stringify({ ...pb, id: main }))
      store.prep('UPDATE perception SET who = ? WHERE who = ?').run(main, from)
      const q = JSON.stringify(from)
      store.prep('UPDATE episodes SET json = replace(json, ?, ?) WHERE instr(json, ?) > 0').run(q, JSON.stringify(main), q)
    })
    if (isOwner(main)) ownerId = main
    log.info(`${other} 和 ${main} 连成了同一个人`)
    return { ok: true, main }
  }
  /** 这个人连着哪些 id（含主 id）。 */
  function idsOf(id) {
    const main = canon(id)
    return [main, ...Object.entries(sameMap()).filter(([, v]) => v === main).map(([k]) => k)]
  }

  // ---------- 感知记录 ----------
  /**
   * 记一条收到的消息。
   * @param {{ window: string, who: string, name?: string, text: string, msgId?: string, at?: number, seen?: 'replied'|'ignored'|'pending' }} m
   * @returns {boolean} 是否新记下（重复投递返回 false）
   */
  function perceive(m) {
    const at = Number(m.at) || now()
    const who = canon(m.who)
    if (who) notePerson(who, { name: m.name })
    const r = store.prep('INSERT OR IGNORE INTO perception (at, window, who, dir, text, msg_id, json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(at, String(m.window), who, 'in', String(m.text || ''), m.msgId ? String(m.msgId) : null, JSON.stringify({ name: m.name || '', seen: m.seen || 'pending' }))
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
    // 她刚想起来的事说出口了：记下跟这里的人说过（在场 = 最近两小时在这里说过话的人）
    if (r.changes > 0) {
      try { memory.noteSaid({ window: String(m.window), text: String(m.text || ''), audience: audienceOf(String(m.window), at) }) } catch (error) { log.debug('记「说过」出错：', error.message) }
    }
    return r.changes > 0
  }
  /** 这个窗口里此刻在场的人：最近两小时在这里说过话的（私聊没人说话时，算最近一个月说过话的那个人）。 */
  function audienceOf(window, at = now()) {
    const q = store.prep("SELECT DISTINCT who FROM perception WHERE window = ? AND dir = 'in' AND at >= ? LIMIT 30")
    const recent = q.all(window, at - 2 * 3600000).map((r) => r.who)
    if (recent.length || place(window).kind !== 'private') return recent
    return q.all(window, at - 30 * 86400000).map((r) => r.who).slice(0, 1)
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
    writeDeletion(id, kind, true)
    store.prep('INSERT OR REPLACE INTO deletions (id, kind, at) VALUES (?, ?, ?)').run(String(id), String(kind), now())
  }
  function writeDeletion(id, kind, deleted) {
    if (deletionLog) appendFileSync(deletionLog, JSON.stringify({ id, kind, at: now(), deleted }) + '\n', { mode: 0o600, flush: true })
  }
  function applyDeletionLog() {
    if (!deletionLog || !existsSync(deletionLog)) return
    const last = new Map()
    for (const line of readFileSync(deletionLog, 'utf8').split('\n')) {
      if (!line) continue
      try {
        const row = JSON.parse(line)
        if (row.id && row.kind) last.set(JSON.stringify([row.kind, row.id]), row)
      } catch { log.warn('跳过一条损坏的删除日志') }
    }
    const recorded = new Set(deletions().map((row) => JSON.stringify([row.kind, row.id])))
    const pending = [...last].filter(([key, row]) => row.deleted && !recorded.has(key)).map(([, row]) => row)
    memory.applyDeletions(pending.filter((row) => row.kind === 'episode'))
    for (const row of last.values()) if (row.kind === 'private') memory.setPrivateOnly(row.id, row.deleted, { record: false })
    for (const row of pending.filter((item) => item.kind === 'person')) {
      const windows = [...new Set(historyOfPerson(row.id).filter((window) => place(window).kind === 'private'))]
      forgetPerson(row.id, { windows })
    }
  }
  function historyOfPerson(id) {
    return store.prep('SELECT DISTINCT window FROM perception WHERE who = ?').all(id).map((row) => row.window)
  }
  function deletions() {
    return store.prep('SELECT id, kind, at FROM deletions').all()
  }

  // ---------- 忘掉一个人 ----------
  // 删掉的东西先放进恢复区（kv 里 forgotten:<id>），FORGET_KEEP_DAYS 天内能整份放回去，过期才真的没了。
  const FORGET_KEEP_DAYS = 30
  const forgottenKey = (id) => 'forgotten:' + id
  /** 一行原样放回去（列名照原来的）。 */
  function putRow(table, r) {
    const skip = GENERATED_COLUMNS[table] || new Set()
    const cols = Object.keys(r).filter((c) => !skip.has(c))
    store.prep(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => r[c]))
  }
  /**
   * 忘掉一个人：关于他的事（主要关于他、他说的、只涉及他的）、和他的私聊、他说过的原话都移进恢复区。
   * 和别人一起经历、他只是在场的事留着（那也是别人的记忆）。主人不能忘。
   * @param {string} id 人的 id（例如 qq:12345）
   * @param {{ keepPerson?: boolean, windows?: string[] }} [o]
   *   keepPerson：人留着、标成「以后不记」（不传 = 连人带关系一起删）；windows：和他的私聊窗口
   */
  function forgetPerson(id, { keepPerson = false, windows = [] } = {}) {
    const pid = canon(id)
    if (!pid || isOwner(pid)) return { ok: false, message: '主人不能忘' }
    const p = person(pid)
    // 按字面找 id（不用 LIKE：微信这类 id 里有 _ 和 %，会被当成通配符）
    const q = JSON.stringify(pid)
    const wins = windows.map(String).filter(Boolean)
    const winSql = wins.length ? ` OR window IN (${wins.map(() => '?').join(', ')})` : ''
    const eps = store.prep(`SELECT * FROM episodes WHERE instr(json, ?) > 0${winSql}`).all(q, ...wins)
      .filter((r) => {
        if (wins.includes(r.window)) return true
        const d = JSON.parse(r.json)
        return d.about === pid || d.speaker === pid || (Array.isArray(d.who) && d.who.length === 1 && d.who[0] === pid)
      })
    const per = store.prep(`SELECT * FROM perception WHERE who = ?${winSql}`).all(pid, ...wins)
    const gone = new Set(eps.map((r) => r.id))
    const kept = store.prep('SELECT id, json FROM episodes WHERE instr(json, ?) > 0').all(q)
      .filter((r) => !gone.has(r.id) && Array.isArray(JSON.parse(r.json).who) && JSON.parse(r.json).who.includes(pid)).length
    // 这些事之间、和别的事之间的联想连线也一起收着，放回来时连回去
    const linkRows = []
    const linkQ = store.prep('SELECT a, b, kind, weight FROM links WHERE a = ? OR b = ?')
    for (const r of eps) linkRows.push(...linkQ.all(r.id, r.id))
    const prev = store.get(forgottenKey(pid), null)
    const bundle = {
      links: [...(prev?.links || []), ...linkRows],
      id: pid, at: now(), name: p?.name || prev?.name || '', keepPerson: Boolean(keepPerson),
      person: p || prev?.person || null,
      episodes: [...(prev?.episodes || []), ...eps], perception: [...(prev?.perception || []), ...per],
    }
    store.set(forgottenKey(pid), bundle)
    for (const r of eps) memory.deleteEpisode(r.id)
    store.tx(() => {
      for (const r of per) store.prep('DELETE FROM perception WHERE id = ?').run(r.id)
      emotion.forgetAppraisals(pid, wins)
      if (!keepPerson) { store.prep('DELETE FROM people WHERE id = ?').run(pid); recordDeletion(pid, 'person') }
      else if (p) {
        const { rel, tom, ...rest } = p
        savePerson({ ...rest, noMemory: true })
      }
    })
    conversation.invalidatePerson(pid, wins)
    inner.clearDeferred()
    log?.info?.(`忘掉 ${p?.name || pid}：${eps.length} 件事、${per.length} 句原话移进恢复区${keepPerson ? '，以后也不记他' : ''}`)
    return { ok: true, episodes: eps.length, perception: per.length, keptShared: Math.max(0, kept) }
  }
  /** 以后记不记这个人（不动以前的记忆）。 */
  function setNoMemory(id, on) {
    const pid = canon(id)
    if (!pid || (on && isOwner(pid))) return false
    const p = person(pid) || { id: pid, name: '', aliases: [], firstSeen: now(), lastSeen: 0 }
    if (on) p.noMemory = true
    else delete p.noMemory
    savePerson(p)
    return true
  }
  /** 恢复区里的人（过期的顺手清掉）。 */
  function forgottenList() {
    const out = []
    for (const r of store.prep("SELECT key, json FROM kv WHERE key LIKE 'forgotten:%'").all()) {
      const b = JSON.parse(r.json)
      if (now() - b.at > FORGET_KEEP_DAYS * 86400000) { store.del(r.key); continue }
      out.push({ id: b.id, name: b.name, at: b.at, keepPerson: b.keepPerson, episodes: b.episodes.length, perception: b.perception.length, until: b.at + FORGET_KEEP_DAYS * 86400000 })
    }
    return out.sort((a, b) => b.at - a.at)
  }
  /** 从恢复区整份放回去；返回放回的事的 id（向量要重新算）。 */
  function restorePerson(id) {
    const pid = canon(id)
    const b = store.get(forgottenKey(pid), null)
    if (!b) return null
    store.tx(() => {
      for (const r of b.episodes) {
        putRow('episodes', r)
        store.prep("DELETE FROM deletions WHERE id = ? AND kind = 'episode'").run(r.id)
        writeDeletion(r.id, 'episode', false)
      }
      for (const r of b.perception) putRow('perception', r)
      // 联想连线：两头的事都还在才连
      const has = store.prep('SELECT 1 FROM episodes WHERE id = ?')
      for (const l of b.links || []) if (has.get(l.a) && has.get(l.b)) putRow('links', l)
      store.prep("DELETE FROM deletions WHERE id = ? AND kind = 'person'").run(pid)
      writeDeletion(pid, 'person', false)
      const cur = person(pid)
      if (b.person) {
        const merged = cur ? { ...b.person, ...cur, rel: cur.rel || b.person.rel, tom: cur.tom || b.person.tom, lastSeen: Math.max(cur.lastSeen || 0, b.person.lastSeen || 0) } : { ...b.person }
        delete merged.noMemory
        savePerson(merged)
      } else if (cur?.noMemory) setNoMemory(pid, false)
      store.del(forgottenKey(pid))
    })
    log?.info?.(`${b.name || pid} 从恢复区放回来了：${b.episodes.length} 件事、${b.perception.length} 句原话`)
    return b.episodes.map((r) => r.id)
  }

  // ---------- 关系星图 ----------
  /**
   * 她认识的人和他们之间的联系：点是人（越亲近越大），线是「在她的记忆里一起出现过」（次数越多越粗）。
   * 只用她自己记得的事，不另外存一份。
   */
  function peopleGraph({ limit = 150 } = {}) {
    const people = relations.list().slice(0, limit)
    const ids = new Set(people.map((p) => p.id))
    const pairs = new Map()
    for (const r of store.prep(`SELECT json FROM episodes WHERE status = 'live' AND json LIKE '%"who":["%",%'`).all()) {
      let who = []
      try { who = JSON.parse(r.json).who || [] } catch {}
      const list = [...new Set(who.map(String))].filter((x) => ids.has(x)).sort()
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const k = list[i] + '|' + list[j]
        pairs.set(k, (pairs.get(k) || 0) + 1)
      }
    }
    const edges = [...pairs].map(([k, n]) => { const [a, b] = k.split('|'); return { a, b, n } }).sort((x, y) => y.n - x.n).slice(0, 400)
    return {
      people: people.map((p) => ({ id: p.id, name: p.name, closeness: Number(p.rel?.closeness) || 0, owner: Boolean(p.owner), type: p.type, typeLabel: p.typeLabel, noMemory: p.noMemory === true, lastSeen: p.lastSeen || 0 })),
      edges,
    }
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
  const self = createSelf({
    store, now, setting, log, identity: () => identity(), personaCard: () => personaCard(), setPersonaCard: (...a) => setPersonaCard(...a), addVersion: (...a) => addVersion(...a), listVersions: (...a) => listVersions(...a), getVersion,
    // 对主人的称呼：主人一开始设的叫法；她改了以后关系里「你叫他」也跟着改
    ownerName: () => String(opts.ownerName?.() || ''),
    dayKey: (at) => dayKey(at, tz()),
    onOwnerCall: (call) => { const o = identity().ownerId; if (o) relations.edit(o, { call }) },
  })
  const personality = createPersonality({ store, now, setting, tz, log, isOwner: (id) => isOwner(id), addVersion: (...a) => addVersion(...a), listVersions: (...a) => listVersions(...a), getVersion, goals: () => self.goals() })
  const relations = createRelations({ store, now, setting, log, place, identity: () => identity(), isOwner: (id) => isOwner(id), person: (id) => person(id), savePerson, listPeople: () => listPeople(), trustBase: () => personality.value('trust') })
  // ---------- 身体和情绪 ----------
  const body = createBody({ store, now, setting, tz, log })
  const emotion = createEmotion({ store, now, setting, log, random: opts.random, identity: () => identity(), isOwner: (id) => isOwner(id), person: (id) => person(id), closeness: (id) => relations.closeness(id), trait: (id) => personality.value(id), body: () => body.state({ persist: false }) })
  /** 此刻的身体和心情（记忆、说话方式都看它）。 */
  function feeling() {
    const b = body.state({ persist: false })
    const e = emotion.state(b)
    return { body: b, mood: e.mood, emotions: e.active }
  }

  const memory = createMemory({
    store, now, setting, log, budget, tz,
    random: opts.random,
    identity: () => identity(),
    person: (id) => person(id),
    recordDeletion: (id, kind) => recordDeletion(id, kind),
    recordPrivacy: (id, enabled) => writeDeletion(id, 'private', enabled),
    onDeleted: (episode) => {
      personality.forgetEvidence(episode)
      self.invalidateStory(episode.id)
      relations.forgetKnowledge(episode.window, episode.data.sources)
      emotion.forgetEvent(episode.id)
      for (const id of episode.data.sources || []) emotion.forgetEvent('perception:' + id)
    },
    // 惦记别人的事问不问、问几次：她有多心疼人（同情心）和她跟这个人多亲近
    place,
    isOwner: (id) => isOwner(id),
    nameOf: (pid) => person(pid)?.name || shortId(pid),
    // 认识满一年、两年……：只算主人和挺熟的人
    firstMet: () => listPeople().filter((p) => p.firstSeen && (isOwner(p.id) || (Number(p.rel?.closeness) || 0) >= 0.4)).map((p) => ({ id: p.id, firstSeen: p.firstSeen, owner: isOwner(p.id) })),
    care: (pid) => 0.5 * personality.value('compassion') + 0.5 * (isOwner(pid) ? 0.9 : relations.closeness(pid)),
    onRecalled: (list, { window } = {}) => emotion.rekindle(list, { window }),
  })
  // 记得多牢、心境一致都看此刻真实的心情和精力
  memory.connect({
    think: opts.model,
    state: () => { const f = feeling(); return { valence: f.mood.v, energy: f.body.energy } },
    // 记经历时顺带：人格的状态记录（她这次比平时更……）、对人的看法、对群的了解
    encodeExtra: () => personality.encodeAsk() + '\n' + relations.encodeAsk(),
    onEncoded: ({ window, rows, parsed, evidence }) => {
      const shareableHabits = place(window).kind === 'group' && !(Array.isArray(parsed.episodes) && parsed.episodes.some((e) => e?.secret === true))
      personality.observe(parsed, { window, rows, shareableHabits, evidence })
      relations.observe(parsed, { window, rows })
      if (setting('emotion.appraise') !== false) {
        const lastReply = rows.findLast((r) => r.dir === 'out')?.id || 0
        for (const item of evidence) {
          if (!item.emotion || !item.sources.length || item.sources.some((id) => id <= lastReply)) continue
          const source = rows.find((r) => r.id === item.sources[0] && r.dir === 'in')
          if (source && !item.sources.some((id) => emotion.hasEvent('perception:' + id))) emotion.feel([{
            name: item.emotion.name, intensity: item.emotion.intensity, target: source.who,
            importance: item.importance, why: item.secret ? '' : '刚才看到的消息',
          }], { window, source: 'observation', eventId: item.id })
        }
      }
    },
  })
  const sleeper = createSleep(memory, {
    store, now, setting, log, tz, random: opts.random, identity: () => identity(),
    nightly: () => [
      ['personality', () => personality.nightly()],
      ['relations', () => relations.nightly()],
      ['story', () => self.updateStory({
        ask: (scene, system, text, maxTokens) => memory.ask(scene, system, text, maxTokens),
        isVisible: (id) => memory.visibleIn(memory.row(id), ''),
        episodes: ({ rebuild = false } = {}) => store.prep("SELECT id, at, gist, json FROM episodes WHERE status IN ('live', 'archived') AND at >= ? ORDER BY at DESC LIMIT 200").all(rebuild ? 0 : now() - 7 * 86400000)
          .map((r) => ({ id: r.id, at: r.at, gist: r.gist, ...JSON.parse(r.json) }))
          .filter((e) => (e.importance || 0) >= 0.7 || (e.emotion?.intensity || 0) >= 0.7)
          .sort((a, b) => a.at - b.at),
      })],
    ],
  })

  /** 她是谁（放进系统提示词开头）：当前版本的人格卡、她自己写的价值观等、自我故事摘要、不知不觉的变化和小习惯。 */
  function selfPrompt({ publicOnly = false } = {}) {
    return [self.prompt({ publicPersona: publicOnly ? publicPersona() : null, isVisible: (id) => memory.visibleIn(memory.row(id), '') }), personality.selfText({ shareableOnly: true, isVisible: (id) => memory.visibleIn(memory.row(id), '') })].filter((x) => String(x || '').trim()).join('\n\n')
  }

  // ---------- 动机和内心活动 ----------
  // 尽责性里的「勤快」越低越容易分心拖着（Steel 2007 的 Γ）
  const motivation = createMotivation({ store, now, setting, log, distractScale: () => 1.5 - personality.value('productiveness'), trait: (id) => personality.value(id) })
  const inner = createInner({
    store, now, setting, tz, log, random: opts.random, memory, emotion, body, motivation, budget, place,
    ownerCall: () => self.ownerCall(),
    identity: () => identity(), isOwner: (id) => isOwner(id), person: (id) => person(id),
  })
  if (opts.model) inner.connect({ ask: ({ scene, system, text, maxTokens }) => memory.ask(scene, system, text, maxTokens) })
  const conversation = createConversation({
    memory, emotion, body, relations, feeling, setting, isOwner, history, perceive, person, selfPrompt, personaCard, goals: self.goals, canon,
    now, random: opts.random || Math.random, speak: opts.model, log,
  })
  applyDeletionLog()

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
      recovered,
    }
  }

  return {
    // 设置
    settings, setting, updateSettings, resetSetting, savedSettings,
    // 身份
    identity, setOwner, isOwner, wakeWords,
    // 同一个人在不同平台的 id；窗口是私聊还是群
    canon, linkPerson, idsOf, place,
    // 人格卡与版本
    personaCard, publicPersona, setPersonaCard, restorePersona, addVersion, listVersions, getVersion, deleteVersion, deleteVersions, pinVersion,
    // 人
    person, notePerson, listPeople,
    forgetPerson, setNoMemory, forgottenList, restorePerson, peopleGraph,
    // 感知
    perceive, said, history, conversation,
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
    close: () => { conversation.close(); store.close() },
    _store: store,
  }
}

export function mindFileExists(dir) {
  return existsSync(join(dir, 'mind.sqlite')) && statSync(join(dir, 'mind.sqlite')).size > 0
}
