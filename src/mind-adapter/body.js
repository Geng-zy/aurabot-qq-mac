// 身体 tick：睡眠、醒来补消息、自己吃东西；以及睡着时谁来找过她。
export function createBody({ mind, mem, opts, log, now, isClosed, windowOf, deliveryChat, parseChat, checkPromises, dailySnapshot, missOwner }) {
  let sleeping = false
  const missed = new Map()

  async function bodyTick() {
    if (isClosed()) return null
    const { events } = mind.body.tick()
    for (const ev of events) await handleBodyEvent(ev)
    if (!mind.body.state().asleep) { try { missOwner() } catch (error) { log.debug('想管理员出错：', error.message) } }
    try { await checkPromises() } catch (error) { log.debug('到点的约定出错：', error.message) }
    return events
  }

  async function handleBodyEvent(ev) {
    if (ev.kind === 'slept') {
      dailySnapshot()
      log.info('她睡着了')
    }
    if (ev.kind === 'ate') {
      mind.motivation.satisfyWants('eat', ev.at)
      mem.insert({ at: ev.at, gist: '饿了，自己吃了点东西', kind: 'event', importance: 0.15, speaker: 'self', attention: 0.6 })
      mind.emotion.feel([{ name: '满足', intensity: 0.3, why: '吃饱了', importance: 0.2 }], { source: 'body' })
    }
    if (ev.kind === 'woke') {
      log.info(`她醒了（睡了 ${ev.hours.toFixed(1)} 小时${ev.by ? '，被叫醒' : ''}）`)
      mind.emotion.afterSleep()
      if (opts.ask && !sleeping) {
        sleeping = true
        mind.sleep({ quality: ev.quality, wokenUp: ev.wokenUp }).catch((error) => log.warn('睡觉整理出错：', error.message)).finally(() => { sleeping = false })
      }
      const list = [...missed.entries()].filter(([chatId]) => chatId !== windowOf(ev.byChat)).map(([chatId, x]) => ({ chatId: deliveryChat(chatId), ...x }))
      missed.clear()
      const group = (item) => Number(parseChat(item.chatId)?.kind === 'group')
      list.sort((a, b) => Number(b.owner) - Number(a.owner) || group(a) - group(b) || a.at - b.at)
      if (list.length && typeof opts.onWakeReplay === 'function') {
        try { await opts.onWakeReplay(list) } catch (error) { log.warn('醒来补回消息出错：', error.message) }
      }
    }
  }

  function noteMissed(chatId, item) { missed.set(chatId, item) }

  return { bodyTick, handleBodyEvent, noteMissed }
}
