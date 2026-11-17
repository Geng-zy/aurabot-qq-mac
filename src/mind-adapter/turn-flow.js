// 群聊/私聊的接话判断、叫醒、每轮结束的身体消耗。
export function createTurnFlow({ mind, log, now, debug, syncOwner, noteChatActivity, notRemembered, personIn, personOf, windowOf, handleBodyEvent, noteMissed }) {
  function gate(m) {
    syncOwner()
    const speaker = personIn(m.chatId, m.userId)
    const decision = mind.conversation.attend({ speaker, direct: Boolean(m.direct), explicitlyAddressed: m.explicitlyAddressed === true })
    if (decision.wake) {
      handleBodyEvent({ ...decision.wake, byChat: m.chatId }).catch(() => {})
      return { reply: true, woke: true, reason: decision.reason }
    }
    if (!decision.reply && mind.body.state({ persist: false }).asleep && m.direct && m.event) {
      noteMissed(windowOf(m.chatId), { event: m.event, owner: mind.isOwner(speaker), at: now() })
    }
    return decision
  }

  function mustReplyOwner(chatId, userId) {
    syncOwner()
    return mind.setting('identity.mustReplyOwner') === true && mind.isOwner(personIn(chatId, userId))
  }

  function wakeUp(byQQ = '') {
    const ev = mind.body.wake(byQQ ? personOf(byQQ) : '')
    if (ev) handleBodyEvent(ev).catch(() => {})
    return ev
  }

  function noteTurn(chatId, senders = []) {
    if (debug()) return
    try {
      noteChatActivity()
      mind.body.spend(Number(mind.setting('body.energyPerTurn')) || 0)
      const people = [...new Set(senders.map((u) => personIn(chatId, u)).filter(Boolean))]
      const withOwner = people.some((id) => mind.isOwner(id))
      if (withOwner) mind.body.noteOwner()
      for (const id of people) if (!notRemembered(id)) mind.relations.touch(id, now())
      mind.motivation.satisfy('companion', withOwner ? 0.2 : 0.08)
      if (withOwner) mind.motivation.satisfy('intimacy', 0.1)
      mind.inner.relieve(0.2)
    } catch (error) {
      log.debug('记这一轮的消耗失败：', error.message)
    }
  }

  return { gate, mustReplyOwner, wakeUp, noteTurn }
}
