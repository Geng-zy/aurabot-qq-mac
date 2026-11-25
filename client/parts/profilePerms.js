    function ProfilePerms({ st, draft, setDraft }) {
      const perms = draft.profilePerms || {}
      const opts = [
        { value: 'off', label: '关', desc: '谁说都不改' },
        { value: 'owner', label: '仅管理员私聊', desc: '只有你私聊让ta改才改（默认）' },
        { value: 'all', label: '所有人', desc: '白名单里的人、群里的人都能让ta改' },
      ]
      const ownerOpts = [...opts.slice(0, 2), { value: 'all', label: '管理员私聊或群聊', desc: '这一轮只有管理员发言时可用' }]
      const row = (key, label, hint, options = opts) => h(Row, { label, hint },
        h(Choices, { value: perms[key] || 'owner', onChange: (v) => setDraft(setPath(draft, 'profilePerms.' + key, v)), options }))
      return h(Card, { fold: 'qq-profile', title: '改资料与名单', desc: 'ta能不能听人的话改自己的 QQ 昵称、签名、头像，处理好友申请和改白名单；外部模块的权限在各自模块面板里设置。改 QQ 资料要 SnowLuma 支持。各项默认仅管理员。' },
        row('qqNickname', 'QQ 昵称', '', ownerOpts),
        row('qqSignature', 'QQ 个性签名', '', ownerOpts),
        row('qqAvatar', 'QQ 头像', '只用网址图片，或「刚才发的那张图」。', ownerOpts),
        row('qqFriendRequest', '处理好友申请', '让ta通过或拒绝好友申请。处理加群申请须在管理员私聊。', ownerOpts),
        row('whitelist', '改白名单', '让ta把 QQ 号或群号加进或移出白名单。管理员会保留在白名单中。', ownerOpts),
      )
    }

    /** QQ 里的管理员命令一览。 */
