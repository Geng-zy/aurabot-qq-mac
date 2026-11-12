// 使用虚拟时钟和临时内存库，回放同一批观察与模型结果。
import { createMind } from './index.js'
import { dayKey } from './clock.js'

const DAY = 86_400_000
const asTime = (value) => typeof value === 'number' ? value : Date.parse(value)

export async function replayMind(events, { ownerId = 'demo:owner', settings = {}, model, costPerMillion = null } = {}) {
  if (!Array.isArray(events) || !events.length) throw new Error('回放需要至少一条事件')
  let clock = asTime(events[0].at)
  if (!Number.isFinite(clock)) throw new Error('第 1 条事件的时间无效')
  let seed = 17
  let replies = {}
  const ids = new Map()
  const tracked = [...new Set(events.filter((e) => e.kind === 'recall' && e.ref).map((e) => e.ref))].slice(0, 12)
  const days = new Map()
  const checkpoints = []
  const mind = createMind({
    memoryDb: true, ownerId, now: () => clock,
    random: () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 },
    model: model || (async ({ scene }) => {
      const reply = replies[scene] ?? {}
      return typeof reply === 'string' ? reply : { text: JSON.stringify(reply), tokens: reply.tokens }
    }),
  })
  const sample = (day) => {
    const previous = days.get(day)
    const usage = mind.budget.spent(day)
    const memory = mind.memory.counts()
    const { mood, emotions } = mind.feeling()
    days.set(day, {
      day, at: clock, traits: mind.personality.values(), mood,
      emotions: emotions.map(({ name, intensity }) => ({ name, intensity })),
      memory, retention: Object.fromEntries(tracked.map((ref) => {
        const episode = ids.has(ref) ? mind.memory.row(ids.get(ref)) : null
        return [ref, episode ? mind.memory.rOf(episode) : null]
      })),
      usage, cost: costPerMillion === null ? null : usage.tokens * costPerMillion / 1_000_000,
      growth: previous?.growth || [],
    })
  }
  try {
    mind.updateSettings(settings)
    for (const [i, event] of events.entries()) {
      const at = asTime(event.at)
      if (!Number.isFinite(at) || at < clock) throw new Error(`第 ${i + 1} 条事件时间无效或顺序错误`)
      const priorDay = mind.today()
      if (at - clock > 366 * DAY) throw new Error(`第 ${i + 1} 条事件的时间跨度超过一年`)
      if (dayKey(at, mind.identity().timezone) !== priorDay) sample(priorDay)
      clock = at
      const day = mind.today()
      replies = event.replies || {}
      switch (event.kind) {
        case 'message':
          mind.perceive({ window: event.window, who: event.speaker, text: event.text, msgId: event.id || 'in:' + i })
          break
        case 'said':
          mind.said({ window: event.window, text: event.text, msgId: event.id || 'out:' + i })
          break
        case 'appraise':
          await mind.conversation.prepare({ window: event.window, text: event.text, people: [event.speaker], direct: event.direct !== false })
          break
        case 'encode': {
          const result = await mind.memory.encodeWindow(event.window, { force: true })
          if (event.ref && result.ids?.length) ids.set(event.ref, result.ids[0])
          break
        }
        case 'night': {
          const result = await mind.sleep({ quality: event.quality ?? 1 })
          sample(day)
          days.get(day).growth.push(...(result.personality?.steps || []))
          break
        }
        case 'think':
          await mind.inner.step()
          break
        case 'forget': {
          const id = ids.get(event.ref)
          if (!id) throw new Error(`第 ${i + 1} 条事件引用了不存在的经历`)
          const deleted = mind.memory.deleteEpisode(id)
          checkpoints.push({ at, kind: 'forget', ref: event.ref, deleted })
          break
        }
        case 'recall': {
          const results = await mind.memory.recall({ cue: event.text, window: event.window, audienceWindow: event.window })
          const id = ids.get(event.ref)
          const experience = id ? mind.memory.row(id) : null
          checkpoints.push({
            at, kind: 'recall', ref: event.ref, found: results.some((item) => item.id === id),
            strength: experience ? mind.memory.rOf(experience) : null, count: results.length,
          })
          break
        }
        default:
          throw new Error(`第 ${i + 1} 条事件的种类不支持：${event.kind}`)
      }
      sample(day)
    }
    return { days: [...days.values()], checkpoints, diarySample: mind.inner.diary(10), estimatedRatePerMillion: costPerMillion }
  } finally { mind.close() }
}

/** 一组无真实聊天内容的 35 天场景，覆盖积累、反向反馈、遗忘及删除。 */
export function exampleMindReplay() {
  const start = Date.UTC(2026, 8, 1, 1)
  const window = 'demo:group:friends'
  const events = []
  for (let day = 0; day < 35; day++) {
    const at = start + day * DAY
    if (day < 9 || day === 12) {
      const speaker = day % 2 ? 'demo:friend-a' : 'demo:friend-b'
      const text = day === 0 ? '今天我们把旧钢琴修好了' : day === 12 ? '我很难过，演出临时取消了' : '今天一起练琴吧'
      events.push({ at, kind: 'message', window, speaker, text })
      if (day === 12) events.push({
        at: at + 1000, kind: 'appraise', window, speaker, text, direct: false,
        replies: { appraisal: { e: '演出临时取消了', v: [4, -3, 4, 1, 2, 0], tokens: 135 } },
      })
      else events.push({ at: at + 1000, kind: 'said', window, text: '我想主动提个练琴的安排。' })
      events.push({
        at: at + 2000, kind: 'encode', window, ref: 'day-' + day,
        replies: { record: {
          episodes: [{ type: 'event', gist: text, importance: day === 0 ? 0.3 : 0.6, sources: day === 12 ? [1] : [1, 2] }],
          self: day === 12 ? [] : [{ t: 'sociability', d: 1, line: 2, react: 'good', by: speaker }],
          tokens: 850,
        } },
      })
    }
    if (day === 5 || day === 32) events.push({ at: at + 3000, kind: 'recall', window, ref: 'day-0', text: '旧钢琴修好了' })
    if (day === 13) events.push({ at: at + 4000, kind: 'forget', ref: 'day-2' })
    if (day === 14) events.push({
      at: at + 4000, kind: 'think', replies: { think: '念头：我还想听听那架旧钢琴。\n感受：期待 0.4\n深想：否' },
    })
    events.push({ at: at + 12 * 3_600_000, kind: 'night' })
  }
  return events
}
