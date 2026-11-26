// 投递结果 → 给管理员看的一句话。纯函数，不碰状态。
//
// 从 chat/reply.js 搬出来的原因：core/bridge.js 要用它回执联动工具的投递结果，
// 而 chat/reply.js 是 586 行的重模块；core 反向依赖它会把分层搅乱。

/**
 * @param {{delivered?: boolean, simulated?: number, queued?: number, unconfirmed?: number}} result
 * @returns {{ok: boolean, delivered: boolean, queued: number, simulated?: boolean, message: string}}
 */
export function describeDelivery(result) {
  const { delivered = false, simulated = 0, queued = 0, unconfirmed = 0 } = result || {}
  const receipt = { delivered, queued }
  if (unconfirmed) {
    const pending = queued ? `，另有 ${queued} 条正在排队` : ''
    return { ...receipt, ok: false, message: `${delivered ? '部分已发出，' : ''}${unconfirmed} 条未确认送达${pending}` }
  }
  if (queued) return { ...receipt, ok: true, message: delivered ? '部分已发出，其余正在排队' : '已排队，正在等待发送' }
  if (simulated) return { ...receipt, ok: true, simulated: true, message: '模拟发送完成，未发到 QQ' }
  return { ...receipt, ok: delivered, message: delivered ? '发出去了' : '未确认送达' }
}
