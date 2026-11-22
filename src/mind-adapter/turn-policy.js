// 会话策略：注意力设置、心情/身体影响、换会话判断、历史种子和最近管理员原话。
export function createTurnPolicy({ mind, now, debug, isOwnerChat, ownerOf, notRemembered, parseChat, personIn, refOfChat, windowOf }) {
  function canSeedHistory(chatId, senderId) {
    const chat = parseChat(chatId)
    return Boolean(chat && senderId) &&
      !(chat.kind === 'private' && notRemembered(refOfChat(chatId))) &&
      !notRemembered(personIn(chatId, senderId))
  }

  function recentUserMessages(chat, currentText) {
    const chatId = windowOf(chat?.chatId)
    if (debug() || !isOwnerChat(chatId)) return []
    const current = new Set(String(currentText || '').split('\n').map((line) => line.trim()))
    return mind.history(chatId, { since: now() - 30 * 60_000, limit: 32 })
      .filter((row) => row.dir === 'in' && row.who === ownerOf() && !notRemembered(row.who) && !current.has(row.text.trim()))
      .slice(-8).map((row) => ({ speakerId: row.who, at: row.at, text: row.text.slice(0, 300) }))
  }

  function shouldRotate({ lastInput = 0, lastAt = 0, contextWindow = 0 } = {}) {
    const ratio = Number(mind.setting('session.rotateRatio')) || 0.5
    const limit = Math.floor((contextWindow > 0 ? contextWindow : 128000) * ratio)
    if (lastInput > 0 && lastInput >= limit) return `上下文到了 ${lastInput} tokens（换新线 ${limit}）`
    const idleH = Number(mind.setting('session.idleNewSceneHours')) || 6
    if (lastAt > 0 && now() - lastAt >= idleH * 3600000) return `停了 ${Math.round((now() - lastAt) / 3600000)} 小时，开始新的一段`
    return ''
  }

  function attention() {
    return { single: mind.setting('attention.single') !== false, ownerCuts: mind.setting('attention.ownerCutsQueue') !== false }
  }

  function effects() {
    try { return mind.emotion.effects(mind.body.state({ persist: false })) } catch { return null }
  }

  return { canSeedHistory, recentUserMessages, shouldRotate, attention, effects }
}
