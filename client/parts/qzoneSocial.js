    function QzoneSocial({ draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const [s, setS] = useState(null)
      const load = () => get('/qzone/social/state').then(setS)
      useEffect(() => { load() }, [])
      return h(Card, { fold: 'diary-social', title: '空间互动', right: f.sw('qzoneSocial.enabled'), desc: '她醒着、空闲时会定期检查自己说说下的新评论，并决定是否回复。她想逛好友空间时，也会按设置点赞或评论。' },
        h(Row, { label: '回复自己说说下的评论' }, f.sw('qzoneSocial.replyOwn')),
        h(Row, { label: '评论好友的说说' }, f.sw('qzoneSocial.commentFriends')),
        h(Row, { label: '顺手点赞' }, f.sw('qzoneSocial.like')),
        h(Row, { label: '好友说说互动概率', hint: '每条说说只判断一次' }, f.percent('qzoneSocial.friendChance')),
        h(Row, { label: '你的说说互动概率' }, f.percent('qzoneSocial.ownerChance')),
        h(Row, { label: '每天最多评论', hint: '点赞不算' }, f.range('qzoneSocial.maxPerDay', 0, 30, 1, (v) => v + ' 条')),
        h('div', { className: 'ab-flex', style: { marginTop: 10 } },
          h('span', { className: 'ab-muted ab-small' }, s ? '今天评论了 ' + s.count + ' 条' + (s.lastReplyCheck ? '，上次检查新评论 ' + timeAgo(s.lastReplyCheck) : '') + (s.lastRun ? '，上次逛空间 ' + timeAgo(s.lastRun) : '') : ''),
          h('div', { className: 'ab-spacer' }),
          h(Btn, { small: true, onClick: async () => { toast('ta去逛空间了…'); const r = await post('/qzone/social/run'); notify(toast, r); load() } }, '现在逛一次')),
        s && s.history && s.history.length ? h('div', { className: 'ab-list', style: { marginTop: 10 } }, s.history.map((x, i) => h('div', { key: i, className: 'ab-li' },
          h('div', { className: 'meta' }, timeAgo(x.at), h('br'), SOCIAL_KIND[x.kind] || x.kind),
          h('div', { className: 'body' }, h('b', null, x.who), x.post ? h('span', { className: 'ab-muted' }, ' 的「' + x.post + '」') : null, x.text ? h('div', null, x.text) : null)))) : null,
      )
    }

    /** 内心：内心日记、想要的、能做的事和动力、主动找你、权限申请、本地小模型。 */
