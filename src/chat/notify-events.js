// QQ 通知和戳一戳：记流水、过滤白名单、把戳一戳转成一条消息。

export function createNotifyEvents({
  getConfig, channels, logChat, noticesFor, sentIds,
  isDisposed, hooks, titleFilter, channelOf, lastPoker, pokeAt, log, onMessage,
}) {
  /** notice 是连接认出的通知：{ platform, groupId, userId, people, raw }。 */
  async function onNotice(notice) {
    if (!notice) return
    const cfg = getConfig()
    const platform = notice.platform || 'qq'
    const platformCfg = cfg.platforms?.[platform] || {}
    const allow = platformCfg.allow || cfg.allow || {}
    const owner = String(platformCfg.ownerQQ || cfg.ownerQQ || '')
    const groupId = notice.groupId
    const inAllow = groupId ? (allow.groups || []).map(String).includes(groupId) : (allow.private || []).map(String).includes(notice.userId) || notice.userId === owner
    if (!inAllow) return
    const channel = channels.get(platform)
    if (!channel) return
    const names = new Map()
    for (const id of notice.people) {
      try {
        const groupChatId = groupId ? `${platform}:group:${groupId}` : ''
        const m = groupId ? await channel.member(groupChatId, id, { timeoutMs: 3000, retries: 0 }) : null
        names.set(id, `${m?.card || m?.nickname || (channel.label || '平台') + ' 用户'}(${id})`)
      } catch (error) { names.set(id, `${channel.label || '平台'} 用户(${id})`) }
    }
    if (isDisposed()) return
    const note = channel.noticeText(notice, { name: (id) => names.get(String(id)) || String(id), ownMessage: (id) => sentIds.has(`${notice.platform}:${id}`) })
    if (!note) return
    logChat(note.chatId, '系统', `【系统】${note.text}`)
    noticesFor.set(note.chatId, [...(noticesFor.get(note.chatId) || []), note.text].slice(-8))
  }

  async function onPoke(poke) {
    if (isDisposed() || !poke) return
    if (hooks?.poke) {
      try { if (await hooks.poke(poke.raw || poke)) return } catch {}
    }
    if (isDisposed()) return
    const group = poke.groupId
    const poker = poke.userId
    if (group && await titleFilter.shouldIgnore({ group_id: group, user_id: poker })) return
    if (isDisposed()) return
    const chatId = poke.chatId
    const channel = channelOf(chatId)
    if (!channel) return
    lastPoker.set(chatId, poker)
    if (Date.now() - (pokeAt.get(chatId) || 0) < 20_000) return
    pokeAt.set(chatId, Date.now())
    let nickname = poker
    try {
      const info = group ? await channel.member(chatId, poker) : await channel.user(poker)
      nickname = info?.card || info?.nickname || poker
    } catch {}
    if (isDisposed()) return
    log.info(`${chatId}：${nickname} 戳了戳她`)
    await onMessage(channel.pokeMessage(poke, nickname))
  }

  return { onNotice, onPoke }
}
