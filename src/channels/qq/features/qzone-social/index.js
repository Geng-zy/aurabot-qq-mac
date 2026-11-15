// QQ 渠道内置功能：空间互动。逛好友动态点赞评论，回复自己说说下的新评论。

import { createQzoneSocial } from './social.js'
import { wantsQzonePost } from '../../../../features/qzone.js'

export default {
  id: 'qzone-social',
  name: '空间互动',
  version: '1.0.0',
  description: '逛好友的 QQ 空间点赞评论，回复自己说说下的评论',
  tab: 'diary',
  files: ['channels/qq/features/qzone-social/social.js'],
  setup(api) {
    const { hub, onebot } = api.core
    const social = createQzoneSocial({ getConfig: api.config, onebot, hub, mind: api.mind, log: api.log })
    // 逛好友空间由她选择。自己的新评论单独检查，是否回复仍由她决定。
    api.mind?.offer?.({
      id: 'social', label: '逛 QQ 空间', needs: { companion: 0.6, fun: 0.4, care: 0.4, recognition: 0.3 }, effort: 0.15,
      cooldownMinutes: 60, payoff: 0.6,
      matchWant: (text) => !wantsQzonePost(text) && /(?:逛|刷|看|点赞|评论|回复).{0,12}(?:空间|说说|动态|评论)/u.test(text),
      available: () => {
        const status = social.canRun('friends')
        return status === true ? api.mind.actionBudget?.() ?? true : status
      },
      run: async () => {
        const r = await social.run({ scope: 'friends' })
        return { ok: r?.ok !== false, summary: r?.message || '', outcome: r?.ok === false ? 0 : 0.6 }
      },
    })
    api.every(60_000, () => {
      if (social.canRun('replies') === true) {
        return api.mind?.checkSpaceReplies?.(({ checkpoint }) => social.run({ scope: 'replies', checkpoint }))
      }
    }, '检查空间新评论')
    api.route('/qzone/social/run', async () => social.run({ force: true }))
    api.route('/qzone/social/state', async () => ({ ok: true, ...social.state() }))
    return social
  },
}
