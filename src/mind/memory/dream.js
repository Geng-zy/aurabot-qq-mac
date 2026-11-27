// 睡觉时做梦：把最近的经历、旧记忆和心事打散了拼一段；情绪强的、被叫醒的更容易记得。
// 梦不会被当成真发生过的事（sleep.js 的 NOT_EVIDENCE 里有 'dream'）。
// 从 memory/sleep.js 抽出来：梦是整理流程最后一步，只读经历、只写一条 dream，与其它步骤互不依赖。

const DAY = 86400000
const clamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0))

export function createDream({ store, mem, now, random, log, name, parseJson, setting, sourceUnchanged }) {
  const S = (k) => setting('memory.' + k)
  const DREAM_SYSTEM = () => `你是${name()}的梦。把下面这些最近的经历、旧记忆和心事打散了拼在一起，写一段梦（第一人称，一两百字，像真的梦那样跳跃、不讲逻辑）。
最后单独一行写：情绪强度=0到1之间的数。`

  /** 做梦。大部分醒来就忘；情绪强的、被叫醒的更容易记得。梦不会被当成真发生过的事。 */
  async function dream({ wokenUp = false } = {}) {
    const recent = store.prep("SELECT * FROM episodes WHERE status = 'live' AND at >= ? AND coalesce(kind, '') != 'dream' ORDER BY random() LIMIT 5").all(now() - 2 * DAY)
    const old = store.prep("SELECT * FROM episodes WHERE status IN ('live', 'archived') AND at < ? ORDER BY random() LIMIT 2").all(now() - 7 * DAY)
    const worries = mem.dueIntentions({ within: 3 * DAY })
    if (!recent.length && !old.length) return null
    const out = await mem.ask('dream', DREAM_SYSTEM(), [...recent.map((x) => '最近：' + x.gist), ...old.map((x) => '以前：' + x.gist), ...worries.map((x) => '心事：' + x.gist)].join('\n'), 600)
    const sources = [...recent, ...old, ...worries]
    if (!sources.every(sourceUnchanged)) return null
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
    if (remembered) id = mem.insert({ at: now(), window: '', gist: text.slice(0, 300), kind: 'dream', importance: 0.3, emotion: { name: '梦里的感觉', intensity, valence: 0 }, speaker: 'self', attention: 0.7, extra: { from: sources.map((e) => e.id) } })
    store.set('dreams.last', { at: now(), text, intensity, remembered })
    return { text, intensity, remembered, id }
  }


  return { dream }
}
