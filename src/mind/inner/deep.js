// 「认真想一次」的流程：什么时候需要深想、提示词、调用、把结论写回记忆与情绪。
// 从 inner/index.js 抽出来：那边是意识流的循环与状态，这里是单次的深想决策与副作用。
// 依赖全部由调用方注入（模型、预算、记忆、情绪、动机、当前上下文），因此可以单独喂假依赖测。

import { emotionOf } from '../emotion/catalog.js'

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number(x) || 0))
const clip = (x, n) => [...String(x || '').toWellFormed()].slice(0, n).join('')

/**
 * @param {object} o
 * @param {(o: object) => Promise<string>} o.ask 低层模型调用
 * @param {(kind: string, tokens: number) => boolean} o.budgetAllow 预算闸门
 * @param {object} o.memory / o.emotion / o.motivation / o.body 心智各层
 * @param {() => object} o.identity
 * @param {() => number} o.now
 * @param {() => string} o.tz
 * @param {() => string} o.ownerName
 * @param {(budget: object) => object} o.currentContext 取当前时间/近况
 * @param {(text: string) => object} o.parseJson
 * @param {(at: number, zone: string) => string} o.dayKey
 * @param {(at: number, zone: string) => string} o.shortTime
 * @param {string} o.factualRules
 * @param {number} o.affectWindow
 * @param {object} o.remoteContext
 * @param {object} o.log
 */
export function createDeepThink({ getAsk, budgetAllow, memory, emotion, motivation, body, identity, now, tz, ownerName, currentContext, parseJson, dayKey, shortTime, factualRules, affectWindow, remoteContext, log }) {
  function needsDeep(s, step) {
    const recent = [step, ...s.log.filter((x) => !x.repeated && !x.resumed && !x.deep && step.at - x.at < affectWindow).slice(0, 2)]
    const vals = recent.map((x) => (x.feel ? (emotionOf(x.feel.name)?.v ?? 0) * (x.rawFeelIntensity ?? x.feel.intensity) : 0))
    const spiral = recent.length === 3 && vals.every((v) => v < -0.1) && vals[0] <= vals[1] && vals[1] <= vals[2]
    const call = ownerName()
    const t = String(step.thought || '')
    const aboutOwner = step.ownerEvidence && (t.includes('管理员') || (call && t.includes(call)) || /我们(?:之间|的关系)/.test(t)) && vals[0] < -0.1
    return spiral ? '越想越难受' : aboutOwner ? '涉及管理员和你们的关系' : step.deep ? '小模型觉得要认真想' : ''
  }

  const DEEP_SYSTEM = () => `你是${identity().name || '她'}，现在静下来认真想一件让你在意的事。下面是你刚才一连串的念头、此刻的感受和你记得的相关的事（标着是谁、什么时候）。
先把误会想清楚。${factualRules} 没收到来信不代表对方不在线。小插曲可以放过去。若没有出现新情况，感受可以留空；想通了就用 reappraise，若已经平静可以只填 {"reg":"reappraise"}。
只输出 JSON：{"thought":"想明白后的一两句（第一人称）","feel":{"n":"情绪名","i":0到1,"reg":"reappraise 或 空"},"belief":"如果对自己或对某人有了新的看法，用「我觉得……」写一句；没有就空","want":"想做的事；虚拟进食只写吃点东西；没有就空"}`

  async function deepThink(s, step, reason, canCommit) {
    const ask = getAsk?.() || null
    const day = dayKey(now(), tz())
    if (s.deepToday.day !== day) s.deepToday = { day, n: 0 }
    if (!ask || !canCommit()) return null
    if (!budgetAllow('deep', 3000)) return { deferred: true }
    const thoughts = [step, ...s.log.slice(0, 5)].reverse().map((x) => `${shortTime(x.at, tz())} ${x.deep?.thought || x.thought}`).join('\n')
    const recalled = await memory.recall({ cue: step.thought, limit: 5, deliberate: true }).catch(() => [])
    if (!canCommit()) return null
    const current = currentContext(remoteContext)
    const text = `${current.clock}\n${current.recent}\n【为什么要认真想】${reason}\n【此前的念头】\n${thoughts}\n【想起的往事】\n${recalled.map((m) => `- ${dayKey(m.at, tz())} ${m.text}`).join('\n') || '（没有）'}\n${body.describe()}`
    let out
    try {
      out = parseJson(await ask({ scene: 'deep', system: DEEP_SYSTEM(), text, maxTokens: 800 }))
    } catch (error) {
      if (error.code === 'BUDGET') return { deferred: true }
      log.debug('深想失败：', error.message)
      return null
    }
    if (!out || !canCommit()) return null
    s.deepToday.n++
    const reappraised = out.feel?.reg === 'reappraise'
    if (reappraised) {
      const related = reason === '越想越难受' ? s.log.filter((x) => x.at <= step.at && step.at - x.at < affectWindow).slice(0, 2) : []
      emotion.reappraiseThoughts([step.at, ...related.map((x) => x.at)])
    }
    if (out.feel?.n) {
      const positive = emotionOf(out.feel.n)?.v > 0
      const intensity = Math.min(clamp(out.feel.i), positive || step.evidence ? 0.5 : 0.18)
      emotion.feel([{ name: out.feel.n, intensity, reg: out.feel.reg, why: clip(out.thought, 30), importance: 0.3 }], { source: 'deep' })
    }
    // 深想是聊天模型认真想的：「我觉得……」可以记成她的看法（仍然只是看法，不是事实）
    if (out.belief && /^我觉得/.test(String(out.belief).trim())) memory.insert({ at: now(), gist: clip(out.belief, 120), kind: 'belief', importance: 0.6, speaker: 'self', attention: 1 })
    if (out.want) motivation.want(out.want, { strength: 0.6, internal: true })
    return { thought: clip(out.thought, 160), reason, ...(reappraised ? { reappraised } : {}) }
  }


  return { needsDeep, deepThink, DEEP_SYSTEM }
}
