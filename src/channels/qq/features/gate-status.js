// 网关状态 + 登录核对：连接状态机、核对登录号是不是机器人、核对期间先把事件攒着。
// 从 qq/index.js 抽出来的：这段以前和装配混在一起，改一处要通读整份装配。
// 它对补发队列和网关停机都不直接下手 —— 通过回调告诉调用方「核对通过了」「这个号不对」，由装配决定做什么。

/**
 * @param {object} o
 * @param {(deps: object) => object} o.createLoginGate 登录核对的工厂（features/login.js）
 * @param {(action: string, params?: object, opts?: object) => Promise<any>} o.call 网关调用
 * @param {() => string} o.getBotAccount 机器人号
 * @param {object} o.inbox 入站队列
 * @param {(ev: object) => void} o.dispatch 派发一条已核对的原始事件
 * @param {(e: object) => void} o.emit 广播给订阅者
 * @param {() => object} o.getChannel 取通道本身（登录核对里要用自检）
 * @param {() => boolean} o.isDisposed
 * @param {object} o.log
 * @param {(revision: number) => void} [o.onLoginOk] 核对通过（且仍是最新一次连接）
 * @param {(reason: string) => void} [o.onLoginFatal] 号不对/没拿到登录信息，调用方决定是否停机
 */
export function createGateStatus({ createLoginGate, call, getBotAccount, inbox, dispatch, emit, getChannel, isDisposed, log, onLoginOk, onLoginFatal }) {
  let gwState = 'stopped'
  let revision = 0
  const auth = { loginOk: false, verifiedLogin: null, wrongAccount: '', verifying: false, pendingEvents: [] }

  const ready = () => gwState === 'connected' && auth.loginOk

  const loginGate = createLoginGate({
    call, getBotAccount, inbox, dispatch, emit, getChannel, isDisposed,
    getRevision: () => revision,
    isReady: ready,
    state: auth,
    log,
  })

  function onState(s, d) {
    const current = ++revision
    gwState = s
    if (s !== 'connected') loginGate.onDisconnected()
    else loginGate.checkLogin(current, Date.now()).then((result) => {
      if (current === revision && result?.ok) onLoginOk?.(current)
      else if (result?.reason === 'no-login' || result?.reason === 'wrong-account') onLoginFatal?.(result.reason)
    }).catch((error) => log.warn('核对登录号出错：', error.message))
    log.info(`QQ 网关：${s}${d ? '（' + d + '）' : ''}`)
    emit({ type: 'state', state: s })
  }

  return {
    auth,
    loginGate,
    onState,
    onEvent: (ev) => loginGate.onEvent(ev),
    ready,
    state: () => gwState,
    revision: () => revision,
    /** 机器人号或连接设置改了：旧的核对结果作废，攒着的事件也丢掉。 */
    resetAccount() {
      auth.wrongAccount = ''
      auth.loginOk = false
      auth.verifiedLogin = null
      auth.verifying = false
      auth.pendingEvents = []
    },
  }
}
