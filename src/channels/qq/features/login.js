// QQ 登录核对：连上后确认是机器人号；核对期间暂存事件，通过后补处理。
export function createLoginGate({ call, getBotAccount, inbox, dispatch, emit, getChannel, isDisposed, getRevision, isReady, state, log }) {
  async function checkLogin(revision, connectedAt) {
    state.verifying = true
    state.pendingEvents = []
    try {
      let login = null
      try {
        const info = await call('get_login_info', {}, { timeoutMs: 10000, wsOnly: true })
        login = { uin: String(info?.user_id ?? ''), nickname: info?.nickname || '' }
      } catch (error) {
        if (revision !== getRevision()) return
        log.warn('核对登录的 QQ 号失败：', error.message)
      }
      if (revision !== getRevision()) return
      if (!login?.uin) {
        // 核对不了就别用，断开后由看门狗重试
        state.loginOk = false
        state.verifiedLogin = null
        state.wrongAccount = ''
        return { ok: false, reason: 'no-login' }
      }
      if (login.uin === getBotAccount()) {
        state.loginOk = true
        state.verifiedLogin = login
        state.wrongAccount = ''
        const recovery = inbox.prepare(connectedAt)
        const queued = state.pendingEvents
        state.pendingEvents = []
        for (const ev of queued) {
          if (revision !== getRevision()) break
          dispatch(ev)
        }
        void inbox.recover(recovery, {
          call,
          isCurrent: () => !isDisposed() && revision === getRevision() && isReady(),
          onMessage: (ev) => emit({ type: 'message', msg: { ...getChannel().parse(ev), recovered: true } }),
        })
      } else {
        state.loginOk = false
        state.verifiedLogin = null
        state.wrongAccount = login.uin
        state.pendingEvents = []
        return { ok: false, reason: 'wrong-account' }
      }
    } finally {
      if (revision === getRevision()) state.verifying = false
    }
    return { ok: state.loginOk }
  }

  function onDisconnected() {
    if (state.loginOk) inbox.disconnect()
    state.loginOk = false
    state.verifiedLogin = null
    state.verifying = false
    state.pendingEvents = []
  }

  function onEvent(ev) {
    if (!state.loginOk) {
      if (state.verifying) {
        state.pendingEvents.push(ev)
        if (state.pendingEvents.length > 200) state.pendingEvents.shift()
      }
      return
    }
    dispatch(ev)
  }

  return { checkLogin, onDisconnected, onEvent }
}
