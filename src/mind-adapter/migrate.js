// 把 Aurabot 旧模块的数据搬进心智核心（只做一次）。
// 来源：记忆模块（memory.sqlite：记忆条目、人物档案、相处经验、说话方式、关系、短期印象；memory-vectors.json：向量）、
// 心情（mood.json）、空间日记（diary.json）、聊天记录（chatlog/*.jsonl）、history-vault（vault.sqlite）。
// 旧文件只读，一个字节都不改；搬完以后旧模块删掉时它们跟着进废纸篓。

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { windowOf, personOf } from './ids.js'

export const LEGACY_TAG = 'aurabot-legacy-v1'

const hash = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 10)
const norm = (s) => String(s || '').replace(/\|\|\|/g, '').replace(/\s+/g, '')

function readJson(file, fallback = null) {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback } catch { return fallback }
}

async function openReadOnly(file) {
  if (!existsSync(file)) return null
  const { DatabaseSync } = await import('node:sqlite')
  return new DatabaseSync(file, { readOnly: true })
}

/** 记忆模块的一条 → 心智里的一段经历。 */
export function memoryItemToEpisode(j) {
  const kind = j.kind === 'seen' ? 'experience' : j.status === 'hearsay' ? 'hearsay' : 'fact'
  return {
    id: 'aurabot:mem:' + j.id,
    at: Number(j.saidAt || j.at) || 0,
    window: j.chatId ? windowOf(j.chatId) : undefined,
    gist: String(j.text || ''),
    strength: Number.isFinite(Number(j.importance)) ? Number(j.importance) : 0.5,
    // 被想起过的天数越多越牢；第二阶段按遗忘曲线重算，这里只给个起点
    stability: 1 + (Number(j.hitDays) || 0),
    lastRecall: Number(j.lastHit) || undefined,
    status: j.invalidAt || j.supersededBy ? 'superseded' : 'live',
    data: {
      kind,
      about: j.about ? personOf(j.about) : '',
      aboutName: j.aboutName || '',
      speaker: j.speaker ? personOf(j.speaker) : '',
      tags: j.tags || [],
      scope: j.scope || '',
      tier: j.tier ?? null,
      origin: j.source || '',
      hits: j.hits || 0,
      hitDays: j.hitDays || 0,
      validFrom: j.validFrom ?? null,
      validUntil: j.validUntil ?? null,
      invalidAt: j.invalidAt ?? null,
      supersededBy: j.supersededBy ? 'aurabot:mem:' + j.supersededBy : null,
      related: (j.related || []).map((x) => 'aurabot:mem:' + (x?.id || x)),
      history: j.history || null,
      meta: j.meta || null,
      legacyId: j.id,
    },
  }
}

/** 聊天记录一行 → 感知记录。 */
export function chatlogLineToPerception(j) {
  const text = String(j.text || '').trim()
  if (!text || !j.chatId) return null
  const self = j.who === 'bot'
  const system = j.who === '系统'
  return {
    window: windowOf(j.chatId),
    who: self ? 'self' : system ? 'system' : j.uid ? personOf(j.uid) : '',
    dir: self ? 'out' : 'in',
    name: self || system ? '' : String(j.who || ''),
    text,
    at: Number(j.t) || 0,
    msgId: 'aurabot:log:' + j.t + ':' + hash(text),
  }
}

/**
 * 读出全部旧数据，整理成心智核心的导入包。
 * @param {string} dir Aurabot 数据目录（~/.dsh/plugins-data/aurabot）
 */
export async function collectLegacy(dir) {
  const bundle = { perception: [], episodes: [], people: [], vectors: [], notes: {} }
  const found = []

  // 记忆模块
  const memDb = await openReadOnly(join(dir, 'memory.sqlite')).catch(() => null)
  if (memDb) {
    try {
      found.push('memory.sqlite')
      for (const r of memDb.prepare('SELECT json FROM items').all()) {
        try {
          const e = memoryItemToEpisode(JSON.parse(r.json))
          if (e.gist.trim()) bundle.episodes.push(e)
        } catch {}
      }
      const kv = Object.fromEntries(memDb.prepare('SELECT key, json FROM kv').all().map((r) => {
        try { return [r.key, JSON.parse(r.json)] } catch { return [r.key, null] }
      }))
      for (const [qq, p] of Object.entries(kv.profiles || {})) {
        bundle.people.push({ id: personOf(qq), name: p?.name || '', data: { profile: p?.text || '', style: p?.style || '', at: p?.at || 0 } })
      }
      // 后面阶段（社会认知、关系）要用的原始资料先原样存着
      for (const k of ['insights', 'insightNames', 'styles', 'chats', 'relations', 'shortTerm', 'profiles']) {
        if (kv[k] !== undefined) bundle.notes[k] = kv[k]
      }
    } finally {
      memDb.close()
    }
  }

  // 向量（同一个模型的才有用）
  const vec = readJson(join(dir, 'memory-vectors.json'))
  const vmeta = readJson(join(dir, 'memory-vectors-meta.json'), {})
  if (vec && vec.items && typeof vec.items === 'object') {
    found.push('memory-vectors.json')
    for (const [id, v] of Object.entries(vec.items)) {
      if (Array.isArray(v) && v.length) bundle.vectors.push({ id: 'aurabot:mem:' + id, model: vec.model || vmeta.model || '', vec: v, textHash: vmeta.items?.[id] })
    }
  }

  // 心情
  const mood = readJson(join(dir, 'mood.json'))
  if (mood) { found.push('mood.json'); bundle.notes.mood = mood }

  // 空间日记：她自己写过的东西
  const diary = readJson(join(dir, 'diary.json'))
  if (diary && Array.isArray(diary.history)) {
    found.push('diary.json')
    for (const d of diary.history) {
      const text = String(d?.text || '').trim()
      if (!text) continue
      bundle.episodes.push({
        id: 'aurabot:diary:' + (d.tid || d.at || hash(text)),
        at: Number(d.at) || 0,
        gist: text,
        strength: 0.5,
        stability: 2,
        data: { kind: 'own-post', where: 'qzone', posted: Boolean(d.ok) && !d.dryRun, visibility: d.visibility || '', media: (d.media || []).map((m) => m?.caption || m?.title || '').filter(Boolean) },
      })
    }
  }

  // 聊天记录
  const logDir = join(dir, 'chatlog')
  const seen = new Map() // window → [{at, text}]，给 history-vault 去重
  if (existsSync(logDir)) {
    found.push('chatlog')
    for (const f of readdirSync(logDir).filter((x) => x.endsWith('.jsonl')).sort()) {
      for (const line of readFileSync(join(logDir, f), 'utf8').split('\n')) {
        if (!line.trim()) continue
        let j
        try { j = JSON.parse(line) } catch { continue }
        const p = chatlogLineToPerception(j)
        if (!p) continue
        bundle.perception.push(p)
        const list = seen.get(p.window) || []
        list.push({ at: p.at, text: norm(p.text) })
        seen.set(p.window, list)
      }
    }
  }

  // history-vault：和聊天记录重复的跳过。vault 把她一次回复拆成几段存、聊天记录存成一整行，
  // 所以只要同一个聊天 60 秒内有一行聊天记录包含这段字，就算重复。
  const vault = await openReadOnly(join(dir, 'modules-data', 'history-vault', 'vault.sqlite')).catch(() => null)
  if (vault) {
    try {
      found.push('history-vault')
      for (const r of vault.prepare('SELECT id, t, chatId, dir, who, uid, text FROM vault_lines ORDER BY t').all()) {
        const text = String(r.text || '').split('|||').map((x) => x.trim()).filter(Boolean).join(' ')
        if (!text || !r.chatId) continue
        const window = windowOf(r.chatId)
        const n = norm(text)
        if (n && (seen.get(window) || []).some((x) => Math.abs(x.at - r.t) <= 60000 && x.text.includes(n))) continue
        const out = r.dir === 'out'
        bundle.perception.push({ window, who: out ? 'self' : r.uid ? personOf(r.uid) : '', dir: out ? 'out' : 'in', name: out ? '' : String(r.who || ''), text, at: Number(r.t) || 0, msgId: 'aurabot:vault:' + r.id })
      }
      const firstAt = new Map(vault.prepare('SELECT chatId, day, MIN(t) AS t FROM vault_lines GROUP BY chatId, day').all().map((x) => [x.chatId + '|' + x.day, x.t]))
      for (const d of vault.prepare('SELECT chatId, day, abstract FROM vault_days').all()) {
        if (!String(d.abstract || '').trim()) continue
        bundle.episodes.push({
          id: `aurabot:day:${d.chatId}:${d.day}`,
          at: Number(firstAt.get(d.chatId + '|' + d.day)) || 0,
          window: windowOf(d.chatId),
          gist: d.abstract,
          strength: 0.6,
          stability: 3,
          data: { kind: 'day-summary', day: d.day },
        })
      }
    } finally {
      vault.close()
    }
  }

  return { bundle, found }
}

/** 没导过就导一次。出错不标记完成，下次启动再试。 */
export async function migrateLegacy(mind, dir, log) {
  if (mind.importDone(LEGACY_TAG)) return null
  const { bundle, found } = await collectLegacy(dir)
  if (!found.length) {
    // 全新安装：什么旧数据都没有，也记一笔，以后不再找
    return mind.importBatch(LEGACY_TAG, {})
  }
  log?.info?.('迁移旧数据：', found.join('、'))
  return mind.importBatch(LEGACY_TAG, bundle)
}
