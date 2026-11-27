// 情绪的自然语言呈现：给模型看的「此刻的你」与「【心情】/【此刻的感受】」两段文字。
// 从 emotion/index.js 抽出来：那边管状态（加载/存盘/衰减/规矩），这边只管**怎么说**——
// 输入是一份状态快照与几个人物关系，输出是给人看的话，可以喂假状态单测。
//
// 五条规矩（原样保留）：
//   1. 只说行为倾向，不列情绪名、强度、原因，避免她把状态汇报出来；
//   2. 情绪指向别人时要区分「眼前的人」与「不是眼前的人」；
//   3. publicOnly（公开场合）不点名第三方；
//   4. 忍着没表现的会标注「不太想表现出来」；
//   5. 气很大又很累时，按「迁怒倾向 ×（1 − 亲近度）」偶尔压不住。

const degree = (i) => (i >= 0.75 ? '很' : i >= 0.45 ? '有些' : '一点')

/**
 * @param {object} o
 * @param {(body: any) => {mood: object, active: object[]}} o.getState 取当前心情与活跃情绪（由 emotion/index.js 注入）
 * @param {(id: string) => boolean} o.isOwner 是不是管理员（亲近度按 0.8 记）
 * @param {(id: string) => number} o.closeness 关系亲近度
 * @param {() => number} o.displacement 「迁怒倾向」设置值
 * @param {() => number} o.random
 */
export function createEmotionPresent({ getState, isOwner, closeness, displacement, random = Math.random }) {
  /** 给模型的自然提示：不列情绪名、强度和原因，只说这些感觉会让说话变成什么样。 */
  function moodCue(mood) {
    if (mood.v >= 0.5) return '心情很好'
    if (mood.v >= 0.25) return mood.a <= -0.4 ? '很放松' : '心情不错'
    if (mood.v > -0.15) return mood.a >= 0.5 ? '有点躁' : mood.a <= -0.5 ? '有点蔫' : '心情平常'
    if (mood.v > -0.45) return mood.a >= 0.3 ? '有点烦' : '有点低落'
    return mood.a >= 0.3 ? '很烦躁' : '不太开心'
  }

  function emotionCue(def, name) {
    if (def?.anger) return '话会比平时短、直一点，别用可爱的语气'
    if (/难过|失落|失望|委屈|孤独|绝望|受伤/.test(name)) return '不太想开玩笑，也不想给建议，句子会短一点'
    if (/焦虑|紧张|害怕|惊恐/.test(name)) return '会想确认一下，但别连着追问'
    if (/快乐|兴奋|好笑|满足|安心|感动|期待|松一口气/.test(name)) return '会接梗，愿意多说一句'
    if (/害羞|尴尬|羞愧|内疚|不好意思/.test(name)) return '不太想正面承认，容易岔开话题'
    if (/无聊|困|饿|无奈/.test(name)) return '有点没精神，话少一点'
    return '语气会跟着变一点'
  }

  /**
   * 给模型看的自然版情绪提示。
   * 只描述行为倾向和对象，不输出情绪名、强度、原因，避免她把状态汇报出来。
   * @param {{ people?: string[], body?: any, window?: string, publicOnly?: boolean, name?: (id: string) => string }} o
   */
  function prompt({ people = [], body, window, publicOnly = false, name = (x) => x } = {}) {
    const { mood, active } = getState(body)
    const here = new Set(people)
    const cues = [moodCue(mood)]
    const shown = active.filter((e) => e.intensity >= 0.2).slice(0, 5)
    for (const e of shown) {
      let cue = emotionCue(e.def, e.name)
      if (e.target && e.target !== 'self') {
        cue += here.has(e.target)
          ? '，这股感觉和眼前这个人有关'
          : publicOnly
            ? '，这股感觉和眼前的人无关'
            : '，这股感觉是冲着别人的，不是眼前的人'
      }
      if (e.hidden) cue += '，你不太想表现出来'
      if (!cues.includes(cue)) cues.push(cue)
    }
    const angryElsewhere = shown.filter((e) => e.def?.anger && e.target && !here.has(e.target))
    if (angryElsewhere.length) {
      // 目标只在情绪来源会话里命名；其他会话不泄露第三方姓名。
      const top = angryElsewhere[0].intensity
      const worn = (body?.energy ?? 1) < 0.3 || (body?.sleepiness ?? 0) > 0.7
      const close = Math.max(0, ...people.map((p) => (isOwner(p) ? 0.8 : Number(closeness?.(p)) || 0)))
      if (top >= 0.7 && worn && random() < Number(displacement()) * (1 - close)) {
        cues.push('你又累，语气可能比平时冲一点；察觉到了就说清楚不是冲对方，道个歉')
      }
    }
    return `【此刻的你】${[...new Set(cues)].slice(0, 5).join('；')}。`
  }

  /**
   * 给她看的情绪：心情 + 最强的几种情绪（带对象）。
   * 对象不是眼前的人的气，提醒她别带到眼前的人身上；气很大又很累时，按「迁怒倾向」偶尔压不住（越亲近越忍得住）。
   * @param {{ people?: string[], body?: any, name?: (id: string) => string }} o
   */
  function describe({ people = [], body, window, name = (x) => x } = {}) {
    const { mood, active } = getState(body)
    const lines = [`【心情】${mood.label}`]
    const shown = active.filter((e) => e.intensity >= 0.2).slice(0, 5).map((e) =>
      window !== undefined && (e.source === 'deep' || e.window !== window) ? { ...e, target: '', why: '' } : e)
    if (shown.length) {
      lines.push('【此刻的感受】' + shown.map((e) => {
        const who = e.target && e.target !== 'self' ? `对${name(e.target)}` : ''
        return `${who}${degree(e.intensity)}${e.name}${e.why ? `（${e.why}）` : ''}${e.hidden ? '，你忍着没表现出来' : ''}`
      }).join('；'))
    }
    const here = new Set(people)
    const angryElsewhere = shown.filter((e) => e.def?.anger && e.target && !here.has(e.target))
    if (angryElsewhere.length) {
      lines.push(`（这些气是冲着${[...new Set(angryElsewhere.map((e) => name(e.target)))].join('、')}的，不是眼前的人；可以跟信得过的人吐槽，但别把气撒到眼前的人身上。）`)
      const top = angryElsewhere[0].intensity
      const worn = (body?.energy ?? 1) < 0.3 || (body?.sleepiness ?? 0) > 0.7
      // 越亲近越忍得住（亲近度来自关系）
      const close = Math.max(0, ...people.map((p) => (isOwner(p) ? 0.8 : Number(closeness?.(p)) || 0)))
      if (top >= 0.7 && worn && random() < Number(displacement()) * (1 - close)) {
        lines.push('（你气还没消，又累，这会儿可能压不住、语气冲一点、话少一点——不会骂人；察觉到了就说清楚不是冲对方，道个歉。）')
      }
    }
    return lines.join('\n')
  }

  return { moodCue, emotionCue, prompt, describe }
}
