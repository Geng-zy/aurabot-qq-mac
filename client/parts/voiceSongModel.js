    function VoiceSongModel({ draft, setDraft }) {
      const [s, setS] = useState(null)
      const f = useField(draft, setDraft)
      useEffect(() => { get('/voice/song-voices').then(setS).catch(() => setS({ ok: false, voices: [], message: '没查到翻唱音色' })) }, [])
      const voices = (s && s.voices) || []
      return h(Card, { fold: 'voice-rvc', title: '语音条变声（RVC）', desc: '把ta说话的声音也换成「翻唱」页导入的 RVC 音色模型：先 TTS 念出来，再用同一个音色变声。默认不变声，直接用 TTS 原声；变声失败会自动回退原声，不影响发送。' },
        h(Row, { label: '翻唱音色', hint: s && s.available === false ? (s.message || '翻唱环境还没装好，装好并导入音色后才能选') : '只列「翻唱」页导入过的 .pth 音色（带 index 的会标出来）' },
          f.select('voice.songVoice', [{ value: '', label: '不变声（TTS 原声）' }, ...voices.map((v) => ({ value: v.id, label: v.id + (v.hasIndex ? '（有 index）' : '') }))], { width: 280 })),
        h(Row, { label: '变调', hint: '模型是男声训练的、想变成女声一般 +12；不确定就 0' },
          f.num('voice.songPitch', { min: -24, max: 24 }), h('span', { className: 'ab-muted' }, ' 半音')),
        h('div', { className: 'ab-muted ab-small' }, !s ? '正在查翻唱音色…' : (s.available ? '变声要跑一次 RVC，会比普通语音慢几秒；单次变声失败会自动用原声。' : (s.message || '翻唱环境还没装好（面板「翻唱」页一键安装、导入音色后才能给语音条变声）')))) 
    }

    /** Breeze 云端音色：点一下拉列表，选中即填 voice id（不用去官网抄）。 */
