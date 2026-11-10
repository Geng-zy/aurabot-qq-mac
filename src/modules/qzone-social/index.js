// 内置模块：空间互动。逛好友动态点赞评论，回复自己说说下的新评论。

import { createQzoneSocial } from '../../features/qzone-social.js'

export default {
  id: 'qzone-social',
  name: '空间互动',
  version: '1.0.0',
  description: '逛好友的 QQ 空间点赞评论，回复自己说说下的评论',
  tab: 'diary',
  files: ['features/qzone-social.js'],
  setup(api) {
    const { hub, onebot } = api.core
    const social = createQzoneSocial({ getConfig: api.config, onebot, hub, mind: api.mind, log: api.log })
    // 逛好友空间、回自己说说下的评论：由她自己决定什么时候去
    api.mind?.offer?.({
      id: 'social', label: '逛 QQ 空间', needs: { companion: 0.6, fun: 0.4, care: 0.4, recognition: 0.3 }, effort: 0.15, delayHours: 0.1,
      cooldownMinutes: 60, payoff: 0.6, keywords: ['空间', '说说', '好友动态'],
      available: () => social.canRun(),
      run: async () => {
        const r = await social.run()
        return { ok: r?.ok !== false, summary: r?.message || '', outcome: r?.ok === false ? 0 : 0.6 }
      },
    })
    api.route('/qzone/social/run', async () => social.run({ force: true }))
    api.route('/qzone/social/state', async () => ({ ok: true, ...social.state() }))
    return social
  },
}
