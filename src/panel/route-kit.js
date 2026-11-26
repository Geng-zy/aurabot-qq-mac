// 面板路由的共享小工具。
//
// 这里只放「每个路由文件都要写一遍、而且必须写得一模一样」的东西：
// 心智没起来时的统一回执、ok/fail 的返回形状。路由的业务逻辑留在各自的 *-routes.js。
//
// 不在这里做的事：鉴权与写方法闸（在 src/host.js 的 route() 里，见 host/post-only.js）、
// 模块前缀路由（在 src/core/modules.js）。

/** 心智核心没起来（比如这个 Node 没有 node:sqlite）：所有心智接口用同一句话回执。 */
export const MIND_OFF = Object.freeze({ ok: false, message: '心智核心没起来，看日志里的原因' })

/** 统一的成功回执：{ ok: true, ...extra }。 */
export function ok(extra = {}) {
  return { ok: true, ...extra }
}

/** 统一的失败回执：{ ok: false, message }。 */
export function fail(message, extra = {}) {
  return { ok: false, message: String(message ?? ''), ...extra }
}
