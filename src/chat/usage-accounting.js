// 一轮模型调用的用量怎么记账。
//
// 规则（从 session-events.js 里搬出来的，语义一字未改）：
//   · token 数按 input/output/cacheRead/cacheWrite 求和；
//   · 系统会话（外部模块后台 / 日记 / 目的引擎）把用量累到 st.system.tokens，不算聊天；
//   · 正在等回执的投递（deliveryReceipt）也累一份到 st.deliveryTokens；
//   · 紧跟 tool/call 的那次模型调用是「处理工具结果」，记到工具所属模块名下，别把生图算成聊天；
//   · 其余记到 sessionTarget 上的 provider/model 名下。
//
// 单独成一个模块的原因：这段是业务规则（谁该为这次 token 付费），埋在 230 行的状态机里
// 既不好测也不好改；现在它的接口只有一次调用和一份账。

const TOKEN_KEYS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']

/**
 * @param {object} d
 * @param {Function} d.recordUsage 真正落账（core/usage.js）
 * @param {(chatId: string) => string} d.moduleLabel 这个聊天默认记在谁名下
 * @param {(toolName: string) => string} d.moduleOfTool 这个工具属于哪个模块（空串 = 认不出）
 */
export function createUsageAccounting({ recordUsage, moduleLabel, moduleOfTool }) {
  /**
   * @param {object} p
   * @param {object} p.st 这一轮的会话状态
   * @param {string} p.chatId
   * @param {{provider?: string, model?: string}|undefined} p.target 这条会话用的模型
   * @param {object} p.usage DSH 事件里的 usage
   * @param {number|undefined} p.turn 这一步属于第几轮
   * @param {number|undefined} p.time 事件时间
   * @returns {number} 这次一共多少 token
   */
  return function accountUsage({ st, chatId, target, usage, turn, time }) {
    const used = TOKEN_KEYS.reduce((sum, key) => sum + (Number(usage?.[key]) || 0), 0)
    if (st.system) st.system.tokens = (st.system.tokens || 0) + used
    if (st.deliveryReceipt) st.deliveryTokens += used
    const viaTool = st.lastTool && st.lastTool.turn === turn ? moduleOfTool(st.lastTool.name) : ''
    st.lastTool = null
    try {
      recordUsage({
        module: viaTool || moduleLabel(chatId),
        chat: chatId,
        provider: target?.provider || '',
        model: target?.model || '',
        usage,
        at: time,
      })
    } catch {}
    return used
  }
}
