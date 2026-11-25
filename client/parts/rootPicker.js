    function RootPicker({ draft, setDraft, s }) {
      const val = draft.song.root || ''
      const cur = val || s.defaultRoot
      const [chk, setChk] = useState(null)
      useEffect(() => {
        const t = setTimeout(() => get('/song/root/check?path=' + encodeURIComponent(cur)).then(setChk), 300)
        return () => clearTimeout(t)
      }, [cur])
      const pick = (root) => setDraft(setPath(draft, 'song.root', root === s.defaultRoot ? '' : root))
      return h('div', { style: { width: '100%' } },
        h('div', { className: 'ab-flex', style: { gap: 8, width: '100%' } },
          h('input', { className: 'ab-input', style: { flex: '1 1 280px', minWidth: 0 }, value: val, placeholder: '留空 = 默认位置（' + s.defaultRoot + '）', onChange: (e) => setDraft(setPath(draft, 'song.root', e.target.value)) }),
          h(Btn, { small: true, kind: val ? 'ghost' : 'primary', onClick: () => pick(s.defaultRoot) }, val ? '用默认位置' : '默认位置')),
        chk ? h('div', { className: 'ab-small', style: { marginTop: 4, color: !chk.ok || chk.warn ? 'var(--ab-warn)' : 'var(--ab-sub)' } },
          !chk.ok ? chk.message : ['装在 ' + cur, chk.freeGB !== null ? '这个磁盘还剩 ' + chk.freeGB + ' GB' : '', chk.warn].filter(Boolean).join('；')) : null,
        val && val !== s.root && s.voices.length ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 2 } }, '换位置后，已导入的音色要重新导入（或把原来的 models 文件夹搬过去）') : null)
    }

    /** 安装进度：步骤条 + 当前这一步的用时、预计、下载量和网速，一看就知道没卡住。 */
