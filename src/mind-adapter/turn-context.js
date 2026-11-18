// 回复前准备：本轮记忆工作区、群成员映射、准备竞态和结束清理。
export function createTurnContext({ mind, windowOf, parseChat, personIn, noteChatActivity, syncOwner, speakersOf, debug, isClosed, chatEffort }) {
  const working = new Map() // chatId → { text, at }
  const preparing = new Map()

  async function beforeTurn(chat, text, speakers = [], { timeoutMs = 3000, direct = true, observations } = {}) {
    syncOwner()
    const chatId = windowOf(chat?.chatId)
    if (!parseChat(chatId)) return null
    const senders = [...new Set(speakers.map((speaker) => personIn(chatId, speaker)).filter(Boolean))]
    if (senders.length) noteChatActivity({ chatId, direct, owner: senders.some((id) => mind.isOwner(id)) })
    speakersOf.set(chatId, senders)
    const ticket = {}
    const wasDebug = debug()
    preparing.set(chatId, ticket)
    working.delete(chatId)
    const isCurrent = () => !isClosed() && debug() === wasDebug && preparing.get(chatId) === ticket
    try {
      const turn = await mind.conversation.prepare({
        window: chatId, text, people: senders, readOnly: wasDebug, direct, timeoutMs, isCurrent, compactRecall: true,
        observations: observations?.map(({ speaker, text }) => ({ speaker: personIn(chatId, speaker), text })),
      })
      if (!turn || !isCurrent()) return null
      working.set(chatId, { text: turn.memory.text, recalled: turn.memory.recalled, plan: turn.plan })
      return { ...turn.plan, thinking: chatEffort(text, turn.appraisal) }
    } finally {
      if (preparing.get(chatId) === ticket) preparing.delete(chatId)
    }
  }

  function endTurn(chatId) {
    const window = windowOf(chatId)
    working.delete(window)
    speakersOf.delete(window)
    preparing.delete(window)
  }

  function invalidateMemory() {
    working.clear()
    preparing.clear()
  }

  const workingOf = (chatId) => working.get(chatId)
  function clearWorking() { working.clear(); preparing.clear() }

  return { beforeTurn, endTurn, invalidateMemory, workingOf, clearWorking }
}
