// 关系上下文、群聊接话意愿、贴表情意愿、叫醒词。
export function createSocialPreferences({ mind, mem, isOwnerChat, shortId, speakersOf, windowOf, personIn, effects, debug }) {
  function relationContext(chat) {
    if (!chat || chat.kind === 'system') return ''
    try {
      const group = chat.kind === 'group'
      const people = group ? speakersOf.get(windowOf(chat.chatId)) || [] : [personIn(chat.chatId, chat.userId)].filter(Boolean)
      const nameOf = (pid) => (mind.isOwner(pid) ? (isOwnerChat(chat.chatId) ? mind.self.ownerCall() : '管理员') : mind.person(pid)?.name || shortId(pid))
      const parts = []
      const here = windowOf(chat.chatId)
      const rel = mind.relations.prompt(people, { nameOf, window: here, privateDetails: isOwnerChat(here),
        canSee: (source) => mem.sourceVisible(source, here) })
      if (rel) parts.push(rel)
      const scene = mind.personality.sceneText({ group, withOwner: people.some((p) => mind.isOwner(p)) })
      if (scene) parts.push(scene)
      const text = parts.join('\n')
      if (text.length <= 6000) return text
      return text.slice(0, 6000).replace(/[^\n]*$/, '') + '\n（关系提示过长，后面的细节省略。）'
    } catch { 
      return ''
     }
  }

  function dislikes(userId, chatId) {
    try { return mind.relations.dislikes(personIn(chatId, userId)) } catch { return false }
  }
  function ignoreChance() {
    return Number(mind.setting('relations.ignoreDisliked')) || 0
  }

  function groupInterest({ chatId = '', texts = [], speakers = [] } = {}) {
    try {
      const scale = Number(mind.setting('relations.interjectScale'))
      if (!(scale > 0)) return { chance: 0, relevance: 0, why: '群里主动接话关着' }
      const soc = mind.personality.value('sociability')
      const base = 0.02 + 0.33 * Math.pow(soc, 1.5)
      const joined = texts.join(' ')
      let rel = 0
      try { rel = Math.max(0, Math.min(1, mem.topicScore(joined, { audienceWindow: windowOf(chatId) }))) } catch {}
      const hobbies = String(mind.self.profile().hobbies || '').split(/[，,、；;。\s]+/).filter((w) => [...w].length >= 2)
      const hits = hobbies.filter((w) => joined.includes(w)).length
      rel = Math.min(1, rel * 0.7 + hits * 0.3)
      const people = speakers.map((u) => personIn(chatId, u)).filter(Boolean)
      const close = Math.max(0, ...people.map((id) => (mind.isOwner(id) ? 0.8 : mind.relations.closeness(id))))
      const fx = effects()?.chatty ?? 1
      const chance = Math.min(0.8, base * (1 + 3 * rel) * (1 + close) * fx * scale)
      return { chance, relevance: rel, why: `爱社交 ${soc.toFixed(2)}，话题相关 ${rel.toFixed(2)}，在场最亲近 ${close.toFixed(2)}，心情倍数 ${fx.toFixed(2)}` }
    } catch (error) {
      return { chance: 0.1, relevance: 0, why: '算不出来，按一般' }
    }
  }

  function reactWish({ chatId, userId, text = '' } = {}) {
    if (debug()) return null
    try {
      const body = mind.body.state()
      if (body.asleep) return { scale: 0, pool: [], why: '睡着了' }
      const pid = mind.canon(personIn(chatId, userId))
      if (dislikes(userId, chatId)) return { scale: 0, pool: [], why: '不想理 ta' }
      const st = mind.emotion.state(body)
      const sore = st.active.find((e) => e.target === pid && (e.def?.v ?? 0) < -0.2 && e.intensity > 0.3)
      if (sore) return { scale: 0, pool: [], why: `对 ta 还${sore.name}着` }
      const { v, a, label } = st.mood
      const close = mind.isOwner(pid) ? 0.8 : mind.relations.closeness(pid)
      const expr = mind.personality.value('expressiveness')
      let scale = (effects()?.sticker ?? 1) * (0.4 + close) * (0.5 + expr)
      const t = String(text || '')
      let pool
      if (/难过|伤心|想哭|哭了|呜呜|好累|累死|烦死|心累|唉|emo|😭|😢|💔/.test(t)) pool = v < 0 ? ['爱心', '可怜'] : ['爱心']
      else if (/成功|过了|上岸|拿到|好消息|生日快乐|发工资|赢了|考完|搞定/.test(t)) pool = ['赞', '鼓掌']
      else if (/哈哈|hhh|笑死|233|绷不住|😂|🤣/.test(t)) pool = v > -0.15 ? ['笑哭', '斜眼笑', '捂脸'] : ['捂脸']
      else if (v >= 0.25 && a >= 0.3) pool = ['呲牙', '调皮', '偷笑', '赞']
      else if (v >= 0.25) pool = ['微笑', '爱心', '可爱']
      else if (v > -0.15) pool = ['吃瓜', '托腮', '暗中观察', 'OK']
      else { pool = ['无奈', 'emm', '捂脸']; scale *= 0.5 }
      return { scale: Math.max(0, Math.min(2, scale)), pool, why: `${label}，亲近 ${close.toFixed(2)}，爱用表情 ${expr.toFixed(2)}` }
    } catch { 
      return null
     }
  }
  function interjectCap() {
    return Number(mind.setting('relations.interjectCapPerHour')) || 0
  }
  function wakeWords(extra = []) {
    return mind.wakeWords(extra)
  }

  return { relationContext, dislikes, ignoreChance, groupInterest, reactWish, interjectCap, wakeWords }
}
