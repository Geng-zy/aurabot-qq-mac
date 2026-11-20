// QQ 连接状态、登录信息、诊断、重连。连接本身由 transport 负责。
import { diagnose as diagnoseOneBot } from '../diagnose.js'

export function createConnectionApi({ call, endpoint, getConfig, getState, ready, getLogin, getWrongAccount, setWrongAccount, isDisposed, connectionProblem, enabled, restart }) {
  return {
    async login(timeoutMs = 5000) {
      const info = await call('get_login_info', {}, { timeoutMs })
      return { uin: String(info?.user_id ?? ''), nickname: info?.nickname || '' }
    },

    async status() {
      const ep = endpoint()
      return { state: getState(), login: ready() ? getLogin() : null, endpoint: { httpUrl: ep.httpUrl, wsUrl: ep.wsUrl }, problem: ready() ? '' : connectionProblem() }
    },

    diagnose: () => diagnoseOneBot({ cfg: getConfig(), state: getState(), wrongAccount: getWrongAccount(), call }),

    /** 面板「重新连接」：等几秒看结果，别只回一句「正在重连」。 */
    async reconnect() {
      if (isDisposed()) return { ok: false, message: 'QQ 连接已关闭' }
      if (!enabled()) return { ok: false, message: 'QQ 平台已停用' }
      setWrongAccount('')
      restart()
      for (let i = 0; i < 24 && !isDisposed() && !ready() && !getWrongAccount(); i++) await new Promise((r) => setTimeout(r, 500))
      if (isDisposed()) return { ok: false, message: 'QQ 连接已关闭' }
      if (ready()) return { ok: true, message: '连上了' }
      return { ok: false, message: '没连上：' + connectionProblem() }
    },
  }
}
