// 睡觉时的记忆整理和做梦。
// 顺序：把没记的聊天记完 → 补算向量 → 给相像的经历建联系 → 回放当天的经历，把不同日子里反复出现的
// 提炼成「知道的事」→ 改写被想起过的记忆（再巩固）→ 重算被删掉来源的「知道的事」→ 情绪变淡一点 →
// 想不起来的归档 → 做梦。每一步都受每天预算限制，没做完的留到下一次。

import { parseJson } from './index.js'
import { dayKey } from '../clock.js'

const DAY = 86400000
const clamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0))

/**
 * @param {ReturnType<import('./index.js').createMemory>} mem
 * @param {{ store: any, now: () => number, setting: (k: string) => any, identity: () => any, tz: () => string, log?: any, random?: () => number, sleepQuality?: () => number }} deps
 */
export function createSleep(mem, deps) {
  const { store, now, setting } = deps
  const log = deps.log || { debug() {}, info() {}, warn() {}, error() {} }
  const random = deps.random || Math.random
  const S = (k) => setting('memory.' + k)
  const name = () => deps.identity().name || '她'

  /** 给相像的经历建联系（向量余弦 ≥ 0.8）。 */
  function linkSimilar(ids) {
    let n = 0
    const ins = store.prep('INSERT OR IGNORE INTO links (a, b, kind, weight) VALUES (?, ?, ?, ?)')
    for (const id of ids) {
      const v = mem.vectors
      const self = mem.row(id)
      if (!self) continue
      // 拿它自己的向量去找
      const hits = v.search(vecOf(id), { model: String(S('embedModel')), limit: 6, min: 0.8, filter: (x) => x !== id })
      for (const h of hits) {
        const [a, b] = id < h.id ? [id, h.id] : [h.id, id]
        n += ins.run(a, b, 'similar', h.sim).changes
      }
    }
    return n
  }
  function vecOf(id) {
    const r = store.prep('SELECT dim, vec FROM vectors WHERE id = ?').get(String(id))
    return r ? Array.from(new Float32Array(r.vec.buffer, r.vec.byteOffset, r.dim)) : null
  }

  const CONSOLIDATE_SYSTEM = () => `你是${name()}在睡梦里整理记忆。下面是${name()}最近的经历（带编号和日期），以及和它们相关的更早的经历。
找出在不同日子里反复出现、可以当成“知道的事”的东西（比如某个人的习惯、喜好、你们之间的固定模式），以及经历之间的因果或前后续关系。
规矩：
- 一条“知道的事”至少要有两天以上的经历作依据，sources 填依据的编号。
- 只根据这些经历归纳，不要补充、不要编。
- about 是这件事主要关于的人的 id（没有就空）。
只输出 JSON：{"facts":[{"text":"","about":"","sources":["编号"]}],"links":[{"a":"编号","b":"编号","kind":"cause|followup"}]}`

  /** 回放：近期经历 + 相关旧经历 → 提炼知道的事、建因果联系。 */
  async function replay(since) {
    const recent = store.prep("SELECT * FROM episodes WHERE status = 'live' AND at >= ? AND json NOT LIKE '%\"kind\":\"semantic\"%' AND json NOT LIKE '%\"kind\":\"dream\"%'").all(since)
      .map((r) => ({ ...r, data: JSON.parse(r.json) }))
      .sort((a, b) => (b.data.importance + (b.data.emotion?.intensity || 0)) - (a.data.importance + (a.data.emotion?.intensity || 0)))
      .slice(0, 60)
    if (!recent.length) return { facts: 0, links: 0 }
    const picked = new Map(recent.map((e) => [e.id, e]))
    // 每条带出最像的两条旧经历
    for (const e of recent.slice(0, 30)) {
      const v = vecOf(e.id)
      if (!v) continue
      for (const h of mem.vectors.search(v, { model: String(S('embedModel')), limit: 3, min: 0.6, filter: (x) => x !== e.id && !picked.has(x) })) {
        const old = mem.row(h.id)
        if (old && old.status === 'live' && old.at < since && picked.size < 100) picked.set(old.id, old)
      }
    }
    const list = [...picked.values()].sort((a, b) => a.at - b.at)
    const num = new Map(list.map((e, i) => [String(i + 1), e]))
    const text = list.map((e, i) => `${i + 1}. ${dayKey(e.at, deps.tz())} [${e.data.kind}${e.data.about ? ' 关于 ' + e.data.about : ''}] ${e.gist}`).join('\n')
    const out = parseJson(await mem.ask('consolidate', CONSOLIDATE_SYSTEM(), text, 2000))
    let facts = 0
    let links = 0
    store.tx(() => {
      for (const f of Array.isArray(out?.facts) ? out.facts : []) {
        const t = String(f?.text || '').trim()
        const src = (Array.isArray(f?.sources) ? f.sources : []).map((x) => num.get(String(x))).filter(Boolean)
        const days = new Set(src.map((e) => dayKey(e.at, deps.tz())))
        if (!t || days.size < 2) continue
        mem.insert({ at: now(), window: '', gist: t, kind: 'semantic', importance: Math.max(...src.map((e) => e.data.importance || 0.5)), about: String(f.about || ''), speaker: 'self', attention: 1, extra: { derivedFrom: src.map((e) => e.id) } })
        facts++
      }
      const ins = store.prep('INSERT OR IGNORE INTO links (a, b, kind, weight) VALUES (?, ?, ?, ?)')
      for (const l of Array.isArray(out?.links) ? out.links : []) {
        const a = num.get(String(l?.a))
        const b = num.get(String(l?.b))
        if (!a || !b || a.id === b.id) continue
        links += ins.run(a.id, b.id, l.kind === 'cause' ? 'cause' : 'followup', 0.7).changes
      }
    })
    return { facts, links }
  }

  const RECON_SYSTEM = (level) => `你是${name()}的记忆在被重新存一遍。人每次回忆都会按当下的心情和理解把记忆重新存，细节会慢慢变样。
把下面这条记忆按“改写程度 ${Math.round(level * 100)}%”重写一遍：程度低时只是措辞和细节变模糊；程度高时细节可能记偏、带上现在的心情${level >= 0.2 ? '，和相像的那件事的细节可能串在一起' : ''}。
硬规矩：大意不能变；不能编出没发生过的事；不能加入新的人或新的事件。
只输出 JSON：{"gist":"","detail":""}`

  /** 再巩固：被想起过的记忆重新存一遍。原始记录单独留着，她看不到。 */
  async function reconsolidate(limit = 20) {
    const level = Number(S('reconsolidation')) || 0
    let n = 0
    for (const job of mem.takeJobs('reconsolidate', limit)) {
      const e = mem.row(job.ref)
      if (!e || level <= 0) { mem.doneJob(job.id); continue }
      // 干扰：程度够高时，偶尔带上一件很像的事
      let similar = null
      if (level >= 0.2 && random() < level) {
        const v = vecOf(e.id)
        const h = v && mem.vectors.search(v, { model: String(S('embedModel')), limit: 1, min: 0.8, filter: (x) => x !== e.id })[0]
        similar = h ? mem.row(h.id) : null
      }
      const mood = Number(job.data.mood) || 0
      const text = `记忆：${e.gist}${e.detail ? '\n细节：' + e.detail : ''}\n现在的心情：${mood > 0.3 ? '不错' : mood < -0.3 ? '不太好' : '平常'}${similar ? '\n很像的另一件事：' + similar.gist : ''}`
      let out
      try {
        out = parseJson(await mem.ask('reconsolidate', RECON_SYSTEM(level), text, 500))
      } catch (error) {
        if (error.code === 'BUDGET') break
        log.debug('改写记忆失败：', error.message)
        mem.doneJob(job.id)
        continue
      }
      const gist = String(out?.gist || '').trim()
      // 大意不能丢：太短或太长都不要
      if (gist && gist.length >= e.gist.length * 0.5 && gist.length <= e.gist.length * 1.8 + 10) {
        if (!e.data.original) e.data.original = { gist: e.gist, detail: e.detail, at: now() }
        e.data.rewrites = (e.data.rewrites || 0) + 1
        e.gist = gist
        e.detail = String(out.detail || '').trim() || e.detail
        mem.save(e)
        n++
      }
      mem.doneJob(job.id)
    }
    return n
  }

  /** 来源被删掉了一部分的「知道的事」，按剩下的来源重写。 */
  async function recompute(limit = 20) {
    let n = 0
    for (const job of mem.takeJobs('recompute', limit)) {
      const f = mem.row(job.ref)
      const src = (f?.data.derivedFrom || []).map((id) => mem.row(id)).filter(Boolean)
      if (!f || !src.length) { mem.doneJob(job.id); continue }
      try {
        const out = parseJson(await mem.ask('consolidate', `只根据下面这些经历，重新概括这条“知道的事”。依据不够就输出 {"text":""}。不要编。只输出 JSON：{"text":""}`, `原来的：${f.gist}\n经历：\n${src.map((e) => '- ' + e.gist).join('\n')}`, 300))
        const t = String(out?.text || '').trim()
        if (!t) mem.deleteEpisode(f.id)
        else { f.gist = t; f.data.needsRecompute = false; mem.save(f); n++ }
      } catch (error) {
        if (error.code === 'BUDGET') break
      }
      mem.doneJob(job.id)
    }
    return n
  }

  /** 睡一觉，前一天的情绪淡一点（研究结论不一致，默认很弱）。 */
  function soften(since) {
    const k = Number(setting('emotion.sleepSoften')) || 0
    if (k <= 0) return 0
    let n = 0
    store.tx(() => {
      for (const r of store.prep("SELECT * FROM episodes WHERE at >= ? AND json LIKE '%\"emotion\":{%'").all(since)) {
        const e = { ...r, data: JSON.parse(r.json) }
        if (!e.data.emotion || e.data.softened) continue
        e.data.emotion.intensity = clamp01(e.data.emotion.intensity * (1 - k))
        e.data.softened = true
        mem.save(e)
        n++
      }
    })
    return n
  }

  /** 想不起来的归档（数据不删，主人在面板里看得到，加强一下就回来）。 */
  function archive() {
    const tip = Number(S('levelTip'))
    let n = 0
    const at = now()
    store.tx(() => {
      for (const r of store.prep("SELECT * FROM episodes WHERE status = 'live'").all()) {
        const e = { ...r, data: JSON.parse(r.json) }
        if (e.data.kind === 'intention' && !e.data.done) continue
        if (mem.rOf(e, at) < tip) { e.status = 'archived'; mem.save(e); n++ }
      }
    })
    return n
  }

  const DREAM_SYSTEM = () => `你是${name()}的梦。把下面这些最近的经历、旧记忆和心事打散了拼在一起，写一段梦（第一人称，一两百字，像真的梦那样跳跃、不讲逻辑）。
最后单独一行写：情绪强度=0到1之间的数。`

  /** 做梦。大部分醒来就忘；情绪强的、被叫醒的更容易记得。梦不会被当成真发生过的事。 */
  async function dream({ wokenUp = false } = {}) {
    const recent = store.prep("SELECT gist FROM episodes WHERE status = 'live' AND at >= ? AND json NOT LIKE '%\"kind\":\"dream\"%' ORDER BY random() LIMIT 5").all(now() - 2 * DAY).map((r) => r.gist)
    const old = store.prep("SELECT gist FROM episodes WHERE status IN ('live', 'archived') AND at < ? ORDER BY random() LIMIT 2").all(now() - 7 * DAY).map((r) => r.gist)
    const worries = mem.dueIntentions({ within: 3 * DAY }).map((e) => e.gist)
    if (!recent.length && !old.length) return null
    const out = await mem.ask('dream', DREAM_SYSTEM(), [...recent.map((x) => '最近：' + x), ...old.map((x) => '以前：' + x), ...worries.map((x) => '心事：' + x)].join('\n'), 600)
    const m = out.match(/情绪强度\s*[=＝:：]\s*([01](?:\.\d+)?)/)
    const intensity = m ? clamp01(m[1]) : 0.3
    const text = out.replace(/\n?.*情绪强度.*$/m, '').trim()
    if (!text) return null
    const chance = Math.min(1, Number(S('dreamRecall')) * (0.5 + intensity * 1.5) * (wokenUp ? 2.5 : 1))
    const remembered = random() < chance
    const log2 = store.get('dreams.log', [])
    log2.unshift({ at: now(), text, intensity, remembered })
    store.set('dreams.log', log2.slice(0, 30))
    let id = null
    if (remembered) id = mem.insert({ at: now(), window: '', gist: text.slice(0, 300), kind: 'dream', importance: 0.3, emotion: { name: '梦里的感觉', intensity, valence: 0 }, speaker: 'self', attention: 0.7 })
    store.set('dreams.last', { at: now(), text, intensity, remembered })
    return { text, intensity, remembered, id }
  }

  /**
   * 睡一觉的整理。quality 0～1：睡得少整理得也少（只做一部分）。
   * @returns 每一步做了多少
   */
  async function sleep({ quality = 1, wokenUp = false } = {}) {
    const report = {}
    const since = Number(store.get('sleep.lastAt', 0)) || now() - DAY
    const step = async (name, fn) => {
      try { report[name] = await fn() } catch (error) {
        report[name] = error.code === 'BUDGET' ? '预算用完' : '出错：' + error.message
        if (error.code !== 'BUDGET') log.warn(`睡觉整理「${name}」出错：`, error.message)
      }
    }
    await step('encode', () => mem.encodePending({ force: true }))
    await step('embed', async () => {
      const jobs = mem.takeJobs('embed', 200)
      const n = await mem.embedEpisodes(jobs.map((j) => j.ref).filter(Boolean))
      for (const j of jobs) mem.doneJob(j.id)
      return n
    })
    // 换过向量模型：每晚分批把旧记忆用新模型重新算一遍（新的先算），算完的又能按意思想起来；
    // 没算到的这几晚照常按字面找。算好的顺手和相像的事连上
    let reembedded = []
    await step('reembed', async () => {
      if (!mem.canEmbed()) return '没接向量接口'
      const per = Number(S('reembedPerNight') ?? 500)
      if (!(per > 0)) return '关着'
      const ids = mem.staleVectorIds(per)
      if (!ids.length) return 0
      const n = await mem.embedEpisodes(ids)
      if (n) reembedded = ids
      const p = mem.vectorProgress()
      log.info(`睡觉时重新算了 ${n} 条记忆的向量（${p.done}/${p.total}）`)
      return n
    })
    const fresh = store.prep('SELECT id FROM episodes WHERE at >= ?').all(since).map((r) => r.id)
    await step('links', () => linkSimilar([...new Set([...fresh, ...reembedded])]))
    if (quality >= 0.3) await step('replay', () => replay(since))
    await step('reconsolidate', () => reconsolidate(Math.round(20 * quality)))
    await step('recompute', () => recompute())
    await step('soften', () => soften(since))
    await step('archive', () => archive())
    await step('dream', () => dream({ wokenUp }))
    // 睡觉时别的部分也整理一下（人格走不走一步、关系变淡、自我故事）：由心智入口接上
    for (const [n, fn] of deps.nightly?.() || []) await step(n, () => fn({ quality, since }))
    store.set('sleep.lastAt', now())
    store.set('sleep.lastReport', { at: now(), quality, report })
    log.info('睡觉整理：', JSON.stringify(report).slice(0, 400))
    return report
  }

  return { sleep, replay, reconsolidate, recompute, soften, archive, dream, linkSimilar }
}
