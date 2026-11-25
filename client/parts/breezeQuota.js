    function BreezeQuota({ b, toast }) {
      const [st, setSt] = useState(null)
      const [busy, setBusy] = useState('')
      const load = () => get('/voice/breeze-status').then((r) => setSt(r && r.ok !== false ? r : null)).catch(() => setSt(null))
      useEffect(() => { load() }, [b?.mode, b?.keySet, b?.emailSet, b?.autoClaim])
      const claim = async () => {
        setBusy('claim')
        try {
          const r = await post('/voice/breeze-claim', {})
          toast(r.message || (r.ok ? '领完了' : '没领到'), r.ok ? 'ok' : 'err')
          load()
        } catch (e) { toast(e.message, 'err') } finally { setBusy('') }
      }
      if (b?.mode === 'local') return h('div', { className: 'ab-muted ab-small' }, '本地自建模式：不查额度，也不用登录。')
      const when = st?.lastClaimAt ? new Date(st.lastClaimAt).toLocaleString() : ''
      return h('div', { className: 'ab-note', style: { marginTop: 8 } },
        st
          ? [
            h('div', { key: 'a' }, st.online
              ? '云端在线' + (st.balance == null ? '' : '（额度 ' + st.balance + '）')
              : '云端离线' + (st.note ? '：' + st.note : '')),
            when ? h('div', { key: 'b', className: 'ab-muted ab-small' }, '上次领取：' + when + (st.lastTier ? '（' + st.lastTier + '）' : '')) : null,
            !st.emailSet ? h('div', { key: 'c', className: 'ab-muted ab-small' }, '填了邮箱密码才能自动领每日额度。') : null,
          ]
          : h('div', { className: 'ab-muted ab-small' }, '正在查额度…'),
        h('div', { key: 'btn', style: { marginTop: 8 } },
          h(Btn, { small: true, disabled: busy === 'claim' || !st?.emailSet, onClick: claim }, busy === 'claim' ? '领取中…' : '领取今日额度')),
      )
    }
