    function Asr({ draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const a = draft.voice.asrApi || {}
      const ph = (sf, oa, other) => (a.provider === 'siliconflow' ? sf : a.provider === 'openai' ? oa : other)
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '听语音（语音转文字）', right: f.sw('voice.asr'), desc: '别人发来的语音会先转成文字再交给ta（群里没 @ 她的语音也会转，她能接上话）：本地接口 → QQ 自带转文字 → 云端识别（可选）→ DSH 自带识别，哪一层不行就试下一层。' },
          h(Row, { label: '云端识别', hint: '可选；不选就按 本地接口 → QQ → DSH 的顺序' },
            f.select('voice.asrApi.provider', [
              { value: '', label: '不用云端识别' },
              { value: 'siliconflow', label: '硅基流动' },
              { value: 'openai', label: 'OpenAI' },
              { value: 'custom', label: '自定义（OpenAI 兼容）' },
            ], { width: 220 })),
          a.provider ? [
            h(Row, { key: 'u', label: '服务地址', hint: '只填到 /v1，不要带 /audio/transcriptions；留空用预置地址' },
              f.text('voice.asrApi.baseUrl', { size: 'wide', placeholder: ph('https://api.siliconflow.cn/v1', 'https://api.openai.com/v1', 'http://127.0.0.1:8000/v1') })),
            h(Row, { key: 'm', label: '模型', hint: '留空用预置：硅基 FunAudioLLM/SenseVoiceSmall（免费），OpenAI whisper-1' },
              h('div', { style: { flex: 1 } },
                f.text('voice.asrApi.model', { size: 'wide', placeholder: ph('FunAudioLLM/SenseVoiceSmall', 'whisper-1', 'whisper-1') }),
                h(ModelPicker, { kind: 'asr', keyFrom: 'asr', toast, baseUrl: a.baseUrl || ph('https://api.siliconflow.cn/v1', 'https://api.openai.com/v1', ''), apiKey: a.apiKey, value: a.model, onPick: (m) => setDraft(setPath(draft, 'voice.asrApi.model', m)) }))),
            h(Row, { key: 'k', label: 'API Key', hint: '只存在本机，面板不回显；本地服务可留空。硅基的 Key 可以和「记忆」页的向量 Key 是同一个' },
              f.text('voice.asrApi.apiKey', { type: 'password', placeholder: a.apiKeySet ? '已保存（不改就留空）' : '没有就留空' })),
            h(Row, { key: 'l', label: '语言', hint: '可留空；只对支持 language 的模型有效' },
              f.text('voice.asrApi.language', { placeholder: 'zh' })),
            h(Row, { key: 'p', label: '先用谁', hint: 'QQ 自带一般 1~2 秒；硅基 SenseVoice 实测约 14 秒，建议先 QQ' },
              f.select('voice.asrApi.prefer', [{ value: 'qq', label: '先 QQ 自带（推荐）' }, { value: 'cloud', label: '先云端识别' }], { width: 220 })),
            h(Row, { key: 't', label: '测试', hint: '先用 macOS 自带语音念一句，再交给云端识别；用这一页现在的设置，没保存也行' },
              h(Btn, { small: true, onClick: async () => {
                toast('正在念一句再识别，可能要十几秒…')
                const r = await post('/voice/asr-provider-test', { text: '今天天气不错', voice: draft.voice })
                toast(r.ok ? '念的是「' + r.said + '」，听成了「' + r.heard + '」（' + r.ms + ' 毫秒）' : r.message)
              } }, '测试云端识别')),
          ] : null,
          h(AsrStatus, { toast })),
      )
    }
