// 核对登录通过后的事件分发：raw → message / poke / notice / 群文件。
export function createDispatcher({ emit, inbox, getChannel, isDisposed, log }) {
  return function dispatch(ev) {
    if (ev.post_type === 'message' && !inbox.accept(ev)) return
    emit({ type: 'raw', event: ev })
    const channel = getChannel()
    if (ev.post_type === 'message') emit({ type: 'message', msg: channel.parse(ev) })
    else if (ev.post_type !== 'notice') return
    else if (ev.notice_type === 'bot_offline') {
      log.warn(`QQ 账号离线${ev.tag ? '（' + String(ev.tag).slice(0, 100) + '）' : ''}${ev.message ? '：' + String(ev.message).slice(0, 300) : ''}`)
    } else if (ev.notice_type === 'notify' && ev.sub_type === 'poke') {
      const poke = channel.pokeOf(ev)
      if (poke) emit({ type: 'poke', poke })
    } else if (ev.notice_type === 'group_upload') {
      // 群文件是单独的通知，不是消息：转成一条文件消息走正常流程（白名单、头衔过滤都照旧）
      channel.groupFileMessage(ev).then((msg) => { if (msg && !isDisposed()) emit({ type: 'message', msg }) }).catch((error) => log.warn('处理群文件出错：', error.message))
    } else {
      emit({ type: 'notice', notice: channel.noticeOf(ev) })
    }
  }
}
