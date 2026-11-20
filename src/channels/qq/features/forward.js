// 合并转发展开：交给 forward.js 的 readForward，adapter 只注入 call/selfId/表情名。
import { readForward } from '../forward.js'

export function createForwardApi({ call, selfId, faceName, log }) {
  return {
    forward: (id) => readForward({ call }, id, { selfId: selfId(), faceName, log }),
  }
}
