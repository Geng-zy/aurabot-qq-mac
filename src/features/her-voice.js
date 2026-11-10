// 有事要告诉人时（DSH 卡在授权上、等人选选项、QQ 里批没批、点的歌没唱成），由她用自己的话说，不发固定模板。
// 默认是告诉主人（他的私聊）；传 chatId 就是在那个聊天里说（群也行）。
//
// 两条路：
//   1. 私聊会话空着：把「她看到的事」当一条心里的提示推进主人私聊会话，和她主动找人一样，
//      她带着完整人格、心情和私聊上下文自己组织语言（话也会照常记进心智核心）。
//   2. 私聊会话正忙（比如这一轮本身就卡在等授权上，推进去要等这轮结束才看得到）：
//      用她的人格卡和此刻的状态单独问一次模型，让她说一两句，发出去并记成她说的话。
// 两条都不成（模型出错、该带的字没带上）才退回固定文字，日志里留一笔。

const CLEAN_RE = /\[沉默\]|<\/?voice>/g

/**
 * @param {object} o
 * @param {() => string} o.ownerChatId 主人私聊的 chatId（private:QQ号）
 * @param {(chatId: string) => boolean} o.busy 这个聊天这一轮还在跑
 * @param {(note: string, chatId: string) => Promise<any>} o.pushNote 把一条提示推进那个聊天的会话，由她自己说
 * @param {(o: { system: string, text: string }) => Promise<string>} o.ask 单独问一次模型
 * @param {() => string} o.persona 她现在的人格（和会话里用的同一份）
 * @param {(chatId: string) => string} [o.context] 她此刻的状态（时间、身体、心情、在这个聊天里想起的事）
 * @param {(chatId: string, text: string) => Promise<any>} o.send 发到 QQ（会记成她说的话）
 * @param {object} [o.log]
 */
export function createHerVoice({ ownerChatId, busy, pushNote, ask, persona, context, send, log } = {}) {
  const hasAll = (text, must) => must.every((w) => text.includes(w))

  async function direct(chatId, facts, must, fallback, clean) {
    const mustLine = must.length ? `必须原样带上这些字：${must.map((w) => `「${w}」`).join('、')}（他要照着回）。` : ''
    const system = [
      String(persona?.() || '').trim(),
      String(context?.(chatId) || '').trim(),
      (chatId.startsWith('group:') ? '【现在要做的事】下面是你刚看到的一件事，要在这个 QQ 群里说一声。' : '【现在要做的事】下面是你刚看到的一件事，要在 QQ 私聊里告诉对方。') + '用你自己的口气说一两句，像平时聊天那样顺口说，别念条目、别写成通知、别加引号或前缀。' + mustLine + '只输出要发的那句话本身。',
    ].filter(Boolean).join('\n\n')
    for (let i = 0; i < 2; i++) {
      try {
        let out = String(await ask({ system, text: facts }) || '').replace(CLEAN_RE, '').trim()
        if (clean) out = String(clean(out) || '')
        if (out && hasAll(out, must)) {
          await send(chatId, out.slice(0, 400))
          return 'direct'
        }
        log?.info?.(`她的话没带上要回的字，${i ? '用固定文字' : '再问一次'}：${out.slice(0, 80)}`)
      } catch (error) {
        log?.warn?.('让她组织语言失败：', error.message)
        break
      }
    }
    if (!fallback) return false
    await send(chatId, fallback)
    return 'fallback'
  }

  /**
   * 告诉主人一件事。
   * @param {{ facts: string, must?: string[], fallback?: string, via?: 'auto' | 'direct', chatId?: string, clean?: (text: string) => string }} o
   *   facts：发生了什么（给她看的，不会原样发出去）；must：她的话里必须出现的字（比如「确认」「取消」）；
   *   fallback：两条路都不成时发的固定文字；via：direct = 不进会话，直接单独问一次；
   *   chatId：在哪个聊天里说（默认主人私聊）；clean：单独问时把她的话洗一遍，洗成空串算没说好
   * @returns {Promise<'session'|'direct'|'fallback'|false>}
   */
  async function tell({ facts, must = [], fallback = '', via = 'auto', chatId: target = '', clean = null } = {}) {
    const chatId = target || ownerChatId()
    if (!chatId || !facts) return false
    if (via !== 'direct' && !busy(chatId)) {
      try {
        const mustLine = must.length ? `一定要让他知道怎么回：${must.map((w) => `「${w}」`).join('、')}。` : ''
        const toWhom = chatId === ownerChatId() ? '他' : chatId.startsWith('group:') ? '群里' : '对方'
        await pushNote(`【你看到的事，不是${chatId === ownerChatId() ? '主人' : '谁'}说的话】${facts}\n这件事要告诉${toWhom}：用你自己的口气说一两句，别照着念、别像发通知。${mustLine}这次不要回 [沉默]。`, chatId)
        return 'session'
      } catch (error) {
        log?.info?.('推进私聊会话没成，改成单独组织一句：', error.message)
      }
    }
    return direct(chatId, facts, must, fallback, clean)
  }

  return { tell }
}
