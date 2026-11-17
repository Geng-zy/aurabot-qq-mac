// 给心智核心注册她自己能做的事：找管理员、自己吃点东西。
import { wantsMeal, wantsOwnerChat } from '../mind/motivation/index.js'

export function registerOffers({ mind, now, canReachOwner, actionBudget, reachOwner, handleBodyEvent }) {
  mind.motivation.offer({
    id: 'reach_owner', label: '找管理员说话', by: 'mind',
    needs: { companion: 1, intimacy: 0.6, care: 0.3 }, effort: 0.1, delayHours: 0.2, cooldownMinutes: 90, payoff: 0.7,
    matchWant: (text) => {
      const call = mind.self.ownerCall()
      return wantsOwnerChat(text) || Boolean(call && wantsOwnerChat(String(text).replaceAll(call, '管理员')))
    },
    available: () => {
      const status = canReachOwner()
      return status === true ? actionBudget() : status
    },
    run: () => reachOwner('想他了'),
  })
  mind.motivation.offer({
    id: 'eat', label: '吃点东西（虚拟）', needs: { body: 0.9 }, matchWant: wantsMeal,
    available: () => {
      if (mind.setting('body.hunger') === false) return '饥饿模拟已关闭'
      if (mind.setting('body.feedOnlyByOwner')) return '等管理员投喂'
      const body = mind.body.state({ persist: false })
      if (body.asleep) return '睡着了'
      return body.hunger >= 0.45 || '现在不饿'
    },
    run: async () => {
      const at = now()
      mind.body.feed('', 'self')
      await handleBodyEvent({ kind: 'ate', at })
      return { ok: true, summary: '吃了点东西（虚拟）', outcome: 0.7 }
    },
  })
}
