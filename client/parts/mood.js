    function Mood({ draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const mc = draft.mind || {}
      const [vp, setVp] = useState(null)
      const [ms, setMs] = useState(null)
      const [savingPrivacy, setSavingPrivacy] = useState(false)
      const loadMs = () => get('/mind/settings').then((r) => setMs(r && r.ok ? r.values : null)).catch(() => {})
      const shareEveryday = 'memory.ownerEverydayExcerpts'
      const setPrivacy = async (value) => {
        setSavingPrivacy(true)
        try {
          const r = await post('/mind/settings/save', { patch: { [shareEveryday]: value } })
          if (!r.ok) { toast(r.message || '隐私设置保存失败', 'err'); return }
          setMs(r.values)
          toast('已保存隐私设置', 'ok')
        } finally { setSavingPrivacy(false) }
      }
      const backend = mc.embedBackend || 'remote'
      const offline = backend === 'local'
      useEffect(() => { loadMs() }, [])
      useEffect(() => {
        let active = true
        const refresh = () => get('/mind/vectors').then((r) => { if (active) setVp(r && r.ok ? r : null) })
        refresh()
        const timer = setInterval(refresh, 5000)
        return () => { active = false; clearInterval(timer) }
      }, [backend])
      // 选了模型直接存进设置（和「设置」页是同一处）
      const pickMind = async (key, m) => { const r = await post('/mind/settings/save', { patch: { [key]: m } }); if (r && r.ok === false) toast(r.message, 'err'); loadMs() }
      const privacy = typeof ms?.[shareEveryday] === 'boolean' ? h(Card, { section: 'memory-privacy', title: '私聊隐私', className: 'ab-privacy' },
          h(Row, { className: 'ab-param-row', label: '跨会话使用日常片段', hint: '你们的私聊原话和私密经历留在原会话。关掉后，日常片段也留在原会话。你指定会话的分享仍然有效。' },
            h(Switch, { label: '跨会话使用日常片段', on: ms[shareEveryday], disabled: savingPrivacy, onChange: setPrivacy }))) : null
      return h('div', { className: 'ab-grid' },
        h(MindMemory, { toast, privacy }),
        h(Card, { fold: 'memory-vectors', title: '向量检索与精排', desc: '向量可用来找措辞不同但意思相近的记忆。切换方式并保存后，旧记忆会在睡眠整理时分批重算。' },
          h(Row, { label: '向量后端' }, f.select('mind.embedBackend', [
            { value: 'remote', label: '兼容接口', desc: '用设置的接口计算向量' },
            { value: 'local', label: '离线中文模型', desc: '在本机计算，暂停远程精排' },
          ])),
          offline ? h('div', { className: 'ab-muted ab-small' },
            vp?.backend !== 'local' ? '保存设置后切换到离线模型。' : vp.error || '本机模型 bge-small-zh-v1.5 已就绪。') : null,
          !offline ? h(Row, { label: '向量服务密钥', hint: '只存在本机，不会显示出来。按意思想起相近的事（向量）和精排（「设置 → 记忆」里打开）都用它' }, f.text('mind.embedKey', { type: 'password', placeholder: mc.embedKeySet ? '已保存（不改就留空）' : '没有就留空' })) : null,
          !offline && ms ? h(Row, { label: '向量模型', hint: '现在用的：' + (ms['memory.embedModel'] || '—') + '。换了以后，旧记忆她每晚睡觉时分批重新算' },
            h('div', { style: { flex: 1 } }, h(ModelPicker, { kind: 'embedding', keyFrom: 'mind', toast, baseUrl: ms['memory.embedUrl'], apiKey: mc.embedKey, value: ms['memory.embedModel'], onPick: (m) => pickMind('memory.embedModel', m) }))) : null,
          !offline && ms ? h(Row, { label: '精排模型', hint: '现在用的：' + (ms['memory.rerankModel'] || '—') + (ms['memory.rerank'] ? '' : '（精排没开，在「设置 → 记忆」打开）') },
            h('div', { style: { flex: 1 } }, h(ModelPicker, { kind: 'rerank', keyFrom: 'mind', toast, baseUrl: ms['memory.embedUrl'], apiKey: mc.embedKey, value: ms['memory.rerankModel'], onPick: (m) => pickMind('memory.rerankModel', m) }))) : null,
          vp && vp.backend === backend && vp.total ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, vp.done >= vp.total ? '全部 ' + vp.total + ' 条记忆都算好了（' + vp.model + '）。' : '已经按意思算好 ' + vp.done + ' / ' + vp.total + ' 条（' + vp.model + '）。换过向量模型或刚填密钥时，剩下的她每晚睡觉时分批算，没算到的照常按字找。') : null),
        h(Card, { fold: 'memory-chat-log', title: '聊天流水保留', desc: '聊天中枢自己的近几天流水（空间日记等功能会看今天的）。她的完整经历在心智核心里，和这个无关。' },
          h(Row, { label: '聊天流水留多久', hint: '超过的按天移到废纸篓（不直接删）；-1 = 一直留；0 = 只留今天' }, f.num('memory.keepChatlogDays', { min: -1, max: 3650 }))))
    }

    /** 一条 0～1 的状态条。 */
