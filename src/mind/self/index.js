// 自我：她自己决定的变化和她的自我故事（设计文档「她自己决定的变化」「自我故事」）。
// - 什么时候都可以改：人格卡原文、价值观、爱好、名字和小名、外貌描写、自我故事；也可以写「我想变成……」的目标。
// - 每次改都存一个版本（改了什么、为什么），她改的时候能看到以前改过什么。
// - 年龄、生日和「专一」由主人在面板里设，她写不进去。
// - 自我故事（McAdams 的叙事身份）：她用自己的话写「我是怎么变成现在这样的」，重要的经历成为其中的章节；睡觉时更新。

import { parseJson } from '../memory/index.js'
import { TRAIT, TRAITS } from '../personality/traits.js'

const DAY = 86400000
const WHAT = {
  persona: '人格卡', name: '名字', nickname: '小名', values: '价值观', hobbies: '爱好', looks: '外貌', story: '自我故事', goal: '想变成的样子', ownerCall: '对主人的称呼',
}
export const SELF_FIELDS = Object.keys(WHAT)

const ROMANCE = /(喜欢上|爱上|暗恋|心动|恋人|恋爱|男朋友|女朋友|男友|女友|对象|老公|老婆|伴侣|结婚|嫁给|娶)/
const NEGATED = /(不想|不会|没有|才不|不要|拒绝|不谈|不喜欢)/
const sentences = (t) => String(t || '').split(/[。！？!?\n；;]/).map((x) => x.trim()).filter(Boolean)
/**
 * 新写进去的句子里，有没提主人、却有恋爱说法的（「我不想谈恋爱」这种否定的不算）：「专一」开着时她写不进去。
 * 原来就有的句子不管（人格卡里本来写着的，由主人负责）。
 */
export function romanceElsewhere(text, before = '', ownerWords = ['主人']) {
  const old = new Set(sentences(before))
  const words = ['主人', ...ownerWords].map((w) => String(w || '').trim()).filter(Boolean)
  return sentences(text).some((s) => !old.has(s) && ROMANCE.test(s) && !words.some((w) => s.includes(w)) && !NEGATED.test(s))
}
/** 新文字里出现了旧文字里没有的年龄、生日说法。 */
export function touchesAge(before, after) {
  const pick = (t) => new Set([...String(t || '').matchAll(/(\d{1,3})\s*(岁|周岁)|生日[^，。,\n]{0,12}|(\d{1,2})\s*月\s*(\d{1,2})\s*(日|号)\s*(出生|生)/g)].map((m) => m[0].replace(/\s+/g, '')))
  const old = pick(before)
  return [...pick(after)].some((x) => !old.has(x))
}

/**
 * @param {{ store: any, now: () => number, setting: (k: string) => any, log?: any, identity: () => any,
 *   personaCard: () => string, setPersonaCard: Function, addVersion: Function, listVersions: Function }} deps
 */
export function createSelf(deps) {
  const { store, now } = deps
  const setting = (k) => deps.setting?.(k)
  const log = deps.log || { info() {}, warn() {} }

  function profile() {
    const p = store.get('self.profile', null)
    return p && typeof p === 'object' ? { values: '', hobbies: '', looks: '', goals: [], story: { text: '', chapters: [], at: 0 }, ...p } : { values: '', hobbies: '', looks: '', goals: [], story: { text: '', chapters: [], at: 0 } }
  }
  function saveProfile(p) { store.set('self.profile', p) }

  // ---------- 对主人的称呼 ----------
  /** 她现在怎么叫主人：她自己改过就用她的，没改过用主人一开始设的。 */
  function ownerCall() {
    return String(profile().ownerCall || deps.ownerName?.() || '主人')
  }
  /**
   * 她现在能不能自己改对主人的称呼：只看主人开没开这个开关（什么时候改由她自己）。
   * @returns {true|string} 能改返回 true，不能返回原因
   */
  function canChangeOwnerCall() {
    if (setting('identity.ownerCallChange') === false) return '主人没开「她可以自己改对你的称呼」'
    return true
  }

  /** 她以前改过什么（最近几次），改的时候给她看。 */
  function history(limit = 10) {
    return deps.listVersions('self', limit).map((v) => ({ id: v.id, at: v.at, by: v.by, what: v.data.what, reason: v.reason, after: v.data.after }))
  }

  /**
   * 改自己。by：'self' 她自己；'owner' 主人在面板里改。
   * @param {{ what: string, content: string, why?: string, trait?: string, dir?: number }} c
   * @returns {{ ok: boolean, message: string, change?: { what: string, label: string, why: string, before: string, after: string } }}
   */
  function change(c, { by = 'self' } = {}) {
    const what = String(c?.what || '')
    if (!WHAT[what]) return { ok: false, message: '能改的是：' + Object.values(WHAT).join('、') }
    const content = String(c?.content ?? '').trim()
    const why = String(c?.why || '').trim().slice(0, 200)
    if (by === 'self' && !why) return { ok: false, message: '改自己要有理由：为什么想改？' }
    const id = deps.identity()
    const p = profile()
    const before = what === 'persona' ? deps.personaCard() : what === 'name' ? id.name : what === 'nickname' ? id.nickname : what === 'story' ? p.story.text : what === 'goal' ? '' : what === 'ownerCall' ? ownerCall() : p[what] || ''
    if (what !== 'goal' && content === before) return { ok: false, message: '和现在一样，不用改' }
    if (what === 'ownerCall') {
      if (!content) return { ok: false, message: '想怎么叫他？' }
      if ([...content].length > 12) return { ok: false, message: '称呼太长了（12 个字以内）' }
      if (by === 'self') {
        const ok = canChangeOwnerCall()
        if (ok !== true) return { ok: false, message: '现在还不能改称呼：' + ok }
      }
    }
    if (by === 'self' && what !== 'ownerCall') {
      if (id.exclusive && romanceElsewhere(content, before, [ownerCall(), deps.ownerName?.()])) return { ok: false, message: '「专一」是主人设的：你的喜欢只给主人，写不进喜欢别人' }
      if (touchesAge(before, content)) return { ok: false, message: '年龄和生日只有主人能在面板里改' }
    }
    if (what === 'name' && !content) return { ok: false, message: '名字不能是空的' }
    if ((what === 'name' || what === 'nickname') && [...content].length > 20) return { ok: false, message: '名字太长了' }
    if (what === 'persona' && content.length < 20) return { ok: false, message: '人格卡要写完整的（整段新的人格卡原文）' }
    const limit = what === 'persona' ? 20000 : what === 'story' ? 3000 : what === 'ownerCall' ? 12 : 600
    const after = content.slice(0, limit)
    const reason = (by === 'self' ? '她自己改的：' : by === 'owner' ? '主人改的：' : '') + (why || WHAT[what])
    if (what === 'persona') deps.setPersonaCard(after, { by, reason })
    else if (what === 'name') deps.setPersonaCard(deps.personaCard(), { by, reason: `改名：${before || '（没有）'} → ${after}。${why}`, name: after })
    else if (what === 'nickname') deps.setPersonaCard(deps.personaCard(), { by, reason: `改小名：${before || '（没有）'} → ${after}。${why}`, nickname: after })
    else if (what === 'goal') {
      if (!after) return { ok: false, message: '想变成什么样？' }
      const trait = TRAIT.has(c.trait) ? c.trait : ''
      const dir = Number(c.dir) > 0 ? 1 : Number(c.dir) < 0 ? -1 : 0
      p.goals = [{ text: after.slice(0, 120), trait, dir: trait ? dir || 1 : 0, at: now() }, ...p.goals.filter((g) => g.text !== after)].slice(0, 5)
      saveProfile(p)
    } else if (what === 'ownerCall') {
      p.ownerCall = after
      saveProfile(p)
      try { deps.onOwnerCall?.(after) } catch {}
    } else if (what === 'story') {
      p.story = { ...p.story, text: after, at: now() }
      saveProfile(p)
    } else {
      p[what] = after
      saveProfile(p)
    }
    deps.addVersion('self', { what, before: String(before).slice(0, 20000), after }, { by, reason })
    log.info(`${by === 'self' ? '她' : '主人'}改了${WHAT[what]}：${why.slice(0, 60)}`)
    return { ok: true, message: `改好了（${WHAT[what]}）`, change: { what, label: WHAT[what], why, before: String(before), after } }
  }

  /** 放下一个「想变成……」的目标。 */
  function dropGoal(text) {
    const p = profile()
    const n = p.goals.length
    p.goals = p.goals.filter((g) => g.text !== text && !g.text.includes(String(text || '')))
    saveProfile(p)
    return n !== p.goals.length
  }

  /** 退回某个「自我」版本（只退那一项）。 */
  function restore(versionId) {
    const v = deps.listVersions('self', 500).find((x) => x.id === Number(versionId))
    if (!v) throw new Error('没有这个版本')
    const { what, before } = v.data
    if (what === 'goal') return { ok: false, message: '目标不用退回，直接删掉就行' }
    return change({ what, content: before, why: `退回到版本 ${versionId} 之前` }, { by: 'owner' })
  }

  // ---------- 自我故事 ----------
  const STORY_SYSTEM = (name) => `你是${name || '她'}。你在用自己的话写「我是怎么变成现在这样的」：一条连贯的故事，第一人称，口语，像写给自己看的。
规矩：只用下面给的真实经历，不编没发生过的事；重要的经历可以成为新的一章；保留原来故事里重要的部分，可以改写、压缩；不超过 600 字。
只输出 JSON：{"story":"整段故事","chapter":"如果这次有一件事重要到算新的一章，写章节名（十个字以内），没有就空字符串"}`

  /**
   * 睡觉时：有重要的新经历就更新一次自我故事（一天最多一次）。
   * @param {{ ask: Function, episodes: () => Array<{ id: string, at: number, gist: string, importance: number }> }} o
   */
  async function updateStory({ ask, episodes }) {
    if (typeof ask !== 'function') return null
    const p = profile()
    if (p.story.at && now() - p.story.at < DAY * 0.8) return null
    const fresh = (episodes() || []).filter((e) => e.at > (p.story.at || 0)).slice(0, 20)
    const day = (at) => (deps.dayKey ? deps.dayKey(at) : new Date(at).toISOString().slice(0, 10))
    if (!fresh.length) return null
    const id = deps.identity()
    const text = [
      `现在的故事：\n${p.story.text || '（还没写过）'}`,
      `人格卡（你对自己的描述）：\n${deps.personaCard().slice(0, 1500)}`,
      `最近重要的经历：\n${fresh.map((e) => `- ${day(e.at)} ${e.gist}`).join('\n')}`,
    ].join('\n\n')
    const j = parseJson(await ask('selfstory', STORY_SYSTEM(id.name), text, 1500))
    const story = String(j?.story || '').trim()
    if (!story) return null
    const before = p.story.text
    const chapter = String(j?.chapter || '').trim().slice(0, 20)
    p.story = { text: story.slice(0, 3000), at: now(), chapters: chapter ? [...p.story.chapters, { at: now(), title: chapter }].slice(-40) : p.story.chapters }
    saveProfile(p)
    deps.addVersion('self', { what: 'story', before, after: p.story.text }, { by: 'sleep', reason: chapter ? `自我故事新的一章：${chapter}` : '睡觉时更新了自我故事' })
    return { chapter, length: story.length }
  }

  /** 放进系统提示词的「她是谁」：人格卡 + 她自己写的价值观、爱好、外貌、目标 + 自我故事摘要。 */
  function prompt() {
    const id = deps.identity()
    const p = profile()
    const parts = [deps.personaCard()]
    const nameLine = [id.name ? `你现在的名字是「${id.name}」` : '', id.nickname ? `小名「${id.nickname}」` : ''].filter(Boolean).join('，')
    if (nameLine) parts.push(`【你的名字】${nameLine}（以这里为准）。`)
    if (p.ownerCall) parts.push(`【你怎么叫主人】你现在叫他「${p.ownerCall}」（这是你自己改的，以这里为准）。`)
    if (id.age !== null && id.age !== undefined) parts.push(`【年龄】你 ${id.age} 岁${id.birthday ? `，生日是 ${id.birthday}` : ''}（以这里为准）。`)
    const own = [
      p.values ? `价值观：${p.values}` : '',
      p.hobbies ? `爱好：${p.hobbies}` : '',
      p.looks ? `外貌：${p.looks}` : '',
      p.goals.length ? `想变成的样子：${p.goals.map((g) => g.text).join('；')}` : '',
    ].filter(Boolean)
    if (own.length) parts.push('【你自己写下的】\n' + own.join('\n'))
    const words = store.get('self.habitWords', [])
    if (Array.isArray(words) && words.length) parts.push(`【你平时不知不觉会用的说法】${words.join('、')}（自然带一点就好，别刻意）`)
    if (p.story.text) parts.push('【你的故事（你自己写的）】\n' + [...p.story.text].slice(0, 400).join('') + (p.story.text.length > 400 ? '……' : ''))
    return parts.filter((x) => String(x || '').trim()).join('\n\n')
  }

  /** 给工具说明用：她以前改过什么。 */
  function historyText(limit = 4) {
    const h = history(limit)
    if (!h.length) return '你还没改过自己。'
    return '你以前改过：' + h.map((x) => `${deps.dayKey ? deps.dayKey(x.at) : new Date(x.at).toISOString().slice(0, 10)} ${WHAT[x.what] || x.what}（${String(x.reason || '').slice(0, 40)}）`).join('；')
  }

  return { profile, ownerCall, canChangeOwnerCall, change, dropGoal, restore, history, historyText, updateStory, prompt, goals: () => profile().goals, WHAT, TRAITS }
}
