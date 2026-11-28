    function Voice({ st, draft, setDraft, toast, reload }) {
      const f = useField(draft, setDraft)
      const voiceDirty = Boolean(st && st.config) && JSON.stringify(draft.voice) !== JSON.stringify(st.config.voice)
      const [txt, setTxt] = useState('晚安啦，今天也辛苦了，明天见～')
      const noEngine = Boolean(st && st.voice) && !st.voice.edgeInstalled && !(st.voice.custom && st.voice.custom.url)

      const [src, setSrc] = useState('')
      return h('div', { className: 'ab-grid' },
        noEngine ? h(Empty, {
          icon: '🔈', title: '还没有可用的语音引擎',
          text: '装一个语音组件（edge-tts，会建在插件自己的 Python 环境里），或者在下面填一个你自己的 HTTP 语音接口；装好后再打开开关。',
          action: '安装语音组件', onAction: async () => { toast('正在安装，装完这里会自己变'); await post('/voice/install', {}); reload && reload() },
        }) : null,
        h(Card, { title: '说话（文字转语音）', right: f.sw('voice.enabled'), desc: '回复里写了 <voice>…</voice> 的部分会变成 QQ 语音条；对方明确要语音时一定发语音；短回复也有一定概率整条变语音。' },
          voiceDirty ? h('div', { className: 'ab-note' }, '语音设置有没保存的改动：点「生成」试听会直接用这一页现在的设置；真正聊天要点底部「保存设置」后才生效。') : null,
          h('div', { style: { margin: '4px 0 12px' } }, f.choices('voice.engine', [
            { value: 'auto', label: '自动', desc: 'edge-tts 优先，不行用 macOS 自带语音' },
            { value: 'edge', label: '微软 edge-tts', desc: st.voice.edgeInstalled ? '在线，音色自然（已装好）' : '在线，音色自然（还没装）' },
            { value: 'cosyvoice', label: '本地 CosyVoice', desc: '自己部署的 CosyVoice 服务，可克隆音色' },
            { value: 'gptsovits', label: '本地 GPT-SoVITS', desc: 'GPT-SoVITS api_v2，用参考音频定音色' },
            { value: 'breeze', label: 'Breeze 语音', desc: 'BreezeBlue 云端或自建，填 Key + 音色 id' },
            { value: 'http', label: '其他 HTTP 接口', desc: '任意返回音频的地址' },
            { value: 'system', label: 'macOS 自带', desc: '离线可用，机械感重一些' },
          ])),
          ['auto', 'edge'].includes(draft.voice.engine) ? [
            !st.voice.edgeInstalled ? h(Row, { key: 'i', label: 'edge-tts', hint: '装在插件自己的 Python 环境里，不影响系统' }, h(Btn, { small: true, onClick: async () => { toast('正在安装，可能要一两分钟…'); const r = await post('/voice/install'); toast(r.message); reload() } }, '安装 edge-tts')) : null,
            h(Row, { key: 'v', label: '音色' }, f.select('voice.voice', [
              { value: 'zh-CN-XiaoyiNeural', label: '晓伊', desc: '活泼女声', group: '普通话' }, { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓', desc: '温柔女声', group: '普通话' },
              { value: 'zh-CN-YunxiNeural', label: '云希', desc: '少年男声', group: '普通话' },
              { value: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北', desc: '东北女声', group: '方言' }, { value: 'zh-CN-shaanxi-XiaoniNeural', label: '晓妮', desc: '陕西女声', group: '方言' },
              { value: 'zh-TW-HsiaoChenNeural', label: '曉臻', desc: '台湾女声', group: '方言' }], { width: 220 })),
            h(Row, { key: 'r', label: '语速' }, f.select('voice.rate', [{ value: '-20%', label: '慢一点' }, { value: '-10%', label: '稍慢' }, { value: '+0%', label: '正常' }, { value: '+10%', label: '稍快' }, { value: '+20%', label: '快一点' }], { width: 140 })),
            h(Row, { key: 'p', label: '音调', hint: '拖动调整，±80Hz 为上限（实测再往上 edge-tts 会静默夹住）；只对 edge-tts 有效' },
              h(Range, {
                min: -80,
                max: 80,
                step: 10,
                value: pitchNum(draft.voice.pitch),
                fmt: pitchLabel,
                onChange: (v) => setDraft(setPath(draft, 'voice.pitch', pitchText(v))),
              })),
          ] : null,
          draft.voice.engine === 'cosyvoice' ? [
            h(Row, { key: 'u', label: '服务地址', hint: 'CosyVoice 自带 runtime/python/fastapi/server.py' }, f.text('voice.cosyvoice.url', { size: 'wide', placeholder: 'http://127.0.0.1:50000' })),
            h(Row, { key: 'm', label: '模式' }, f.select('voice.cosyvoice.mode', [{ value: 'sft', label: '预置音色（sft）' }, { value: 'instruct', label: '带语气指令（instruct）' }], { width: 220 })),
            h(Row, { key: 's', label: '音色 ID', hint: '例如 中文女、中文男' }, f.text('voice.cosyvoice.spkId')),
            draft.voice.cosyvoice.mode === 'instruct' ? h(Row, { key: 'i', label: '语气指令', hint: '例如：用甜美撒娇的语气说' }, f.text('voice.cosyvoice.instruct', { size: 'wide' })) : null,
            h(Row, { key: 'r', label: '采样率', hint: 'CosyVoice 1 是 22050，CosyVoice 2 是 24000' }, f.select('voice.cosyvoice.sampleRate', [{ value: 22050, label: '22050 Hz' }, { value: 24000, label: '24000 Hz' }], { width: 160 })),
          ] : null,
          draft.voice.engine === 'gptsovits' ? [
            h(Row, { key: 'u', label: '服务地址', hint: 'GPT-SoVITS 的 api_v2.py' }, f.text('voice.gptsovits.url', { size: 'wide', placeholder: 'http://127.0.0.1:9880' })),
            h(Row, { key: 'a', label: '参考音频路径', hint: '服务那台电脑上的路径' }, f.text('voice.gptsovits.refAudio', { size: 'wide' })),
            h(Row, { key: 'p', label: '参考音频的文字' }, f.text('voice.gptsovits.promptText', { size: 'wide' })),
          ] : null,
          draft.voice.engine === 'breeze' ? [
            (() => {
              // 缺东西时先提示（不拦保存）：不然只有点「试听」才报错，还看不懂缺哪个
              const b = draft.voice.breeze || {}
              const miss = b.mode === 'local'
                ? (!String(b.url || '').trim() ? ['服务地址'] : [])
                : [
                  !String(b.key || '').trim() && !b.keySet ? 'API Key' : '',
                  !String(b.voiceId || '').trim() ? '音色 id' : '',
                ].filter(Boolean)
              const localDown = b.mode === 'local' && !String(b.url || '').trim()
              return miss.length
                ? h('div', { className: 'ab-note warn', style: { marginBottom: 8 } },
                  '还差：' + miss.join('、') + '。不填的话说话会退回 macOS 自带语音（照常发声，只是不是 Breeze 的音色）。',
                  localDown ? '本地模式要先把 breeze_infer 跑起来，地址填它的 /v1 前缀（例如 http://127.0.0.1:7860）。' : '')
                : null
            })(),
            h(Row, { key: 'mode', label: '模式', hint: '云端走 BreezeBlue 官方接口；本地走自己跑的 breeze_infer' }, h(Select, {
              width: 240,
              value: draft.voice.breeze?.mode || 'cloud',
              options: [{ value: 'cloud', label: '云端（BreezeBlue）' }, { value: 'local', label: '本地自建（breeze_infer）' }],
              // 切模式时顺手把服务地址换成对应的默认值（自己填过的自定义地址不动）
              onChange: (v) => {
                const cur = String(draft.voice.breeze?.url || '').trim()
                const defaults = ['', 'https://api.breeze.blue', 'http://127.0.0.1:7860']
                const url = defaults.includes(cur) ? (v === 'local' ? 'http://127.0.0.1:7860' : 'https://api.breeze.blue') : cur
                setDraft(setPath(setPath(draft, 'voice.breeze.mode', v), 'voice.breeze.url', url))
              },
            })),
            h(Row, { key: 'u', label: '服务地址', hint: '云端填 https://api.breeze.blue；自建就填自己的地址' }, f.text('voice.breeze.url', { size: 'wide', placeholder: 'https://api.breeze.blue' })),
            draft.voice.breeze?.mode === 'local' ? null : h(Row, { key: 'k', label: 'API Key', hint: 'Breeze 控制台 → API Keys 生成，brz_ 开头；已保存就不回显' }, f.secret('voice.breeze.key', { savedText: '已保存', fallback: 'brz_…', size: 'wide' })),
            draft.voice.breeze?.mode === 'local' ? null : h(Row, { key: 'v', label: '音色 id', hint: '云端只用这个 id（不发描述，音色最稳）；也可以点下面的「列出音色」直接挑' }, f.text('voice.breeze.voiceId', { size: 'wide', placeholder: 'voc_…' })),
            draft.voice.breeze?.mode === 'local' ? null : h(BreezeVoices, { key: 'voices', b: draft.voice.breeze, draft, setDraft }),
            h(Row, { key: 'm', label: '模型', hint: '默认 breeze-tts-2' }, f.text('voice.breeze.model', { placeholder: 'breeze-tts-2' })),
            h(Row, { key: 'l', label: '语种' }, f.text('voice.breeze.languageCode', { placeholder: 'zh' })),
            draft.voice.breeze?.mode === 'local' ? h(Row, { key: 'i', label: '语气说明', hint: '本地模式用：这段描述就是音色设计（voice design），不填就用模型默认声音' }, f.text('voice.breeze.instructions', { size: 'wide', placeholder: '清亮柔软、略带奶气的普通话少女音' })) : null,
            draft.voice.breeze?.mode === 'local' ? h(Row, { key: 'g', label: '指令遵循强度', hint: '本地模式的 cfg_scale，越大越贴着描述走（默认 4）' }, f.range('voice.breeze.guidanceScale', 0, 10, 0.5, (v) => (String(v || '4')))) : null,
            draft.voice.breeze?.mode === 'local' ? null : h(Row, { key: 'em', label: '账号邮箱', hint: '填了才能自动领每日额度（免费额度约 250 句短话）' }, f.text('voice.breeze.email', { size: 'wide', placeholder: 'you@example.com' })),
            draft.voice.breeze?.mode === 'local' ? null : h(Row, { key: 'pw', label: '账号密码', hint: '存在本机 config.json（和别的密钥一样，面板里不回显）；留空 = 用已保存的' }, f.secret('voice.breeze.password', { savedText: '已保存', fallback: '不填就不自动领额度' })),
            draft.voice.breeze?.mode === 'local' ? null : h(Row, { key: 'ac', label: '自动领每日额度', hint: '每小时醒一次，一天最多领一次；失败只记日志' }, f.sw('voice.breeze.autoClaim')),
            draft.voice.breeze?.mode === 'local' ? null : h(BreezeQuota, { key: 'quota', b: draft.voice.breeze, toast }),
          ] : null,
          draft.voice.engine === 'http' ? [
            h(Row, { key: 'u', label: '接口地址', hint: 'GET：地址里带 {text}；POST：填接口地址就行' }, f.text('voice.http.urlTemplate', { size: 'wide', placeholder: 'https://openspeech.bytedance.com/api/v1/tts' })),
            h(Row, { key: 'm', label: '请求方式' }, f.select('voice.http.method', [{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }], { width: 140 })),
            h(Row, { key: 'h', label: '请求头', hint: '一行一个。多个头就多写几行' }, f.area('voice.http.headers', { size: 'wide', rows: 2, placeholder: 'Authorization: Bearer;你的token' })),
            String((draft.voice.http || {}).method || 'GET').toUpperCase() !== 'GET'
              ? h(Row, { key: 'b', label: '请求体', hint: '{text} 换成要念的话（自动转义），{reqid} 换成每次不同的随机串' }, f.area('voice.http.body', { size: 'wide', rows: 6, placeholder: '{"app":{"appid":"你的appid","token":"随便填","cluster":"volcano_tts"},"user":{"uid":"aurabot"},"audio":{"voice_type":"zh_female_wanwanxiaohe_moon_bigtts","encoding":"mp3"},"request":{"reqid":"{reqid}","text":"{text}"}}' }))
              : null,
          ] : null,
          h(Row, { label: '短回复变语音的概率' }, f.percent('voice.autoChance')),
          h(Row, { label: '多短算短回复' }, f.range('voice.autoMaxChars', 10, 200, 5, (v) => v + ' 字')),
          h(Row, { label: '表情和语音分开发', hint: '语音条里的表情 / emoji 不念出来，语音发完再单独补一条文字发出去（没有表情就不补）；关掉 = 表情直接丢掉，不补发' }, f.sw('voice.emojiSeparate')),
          h(Row, { label: '试听', hint: '用这一页现在的设置试听（没保存也行；本地接口不会把这里顶掉）' },
            h('input', { className: 'ab-input', value: txt, onChange: (e) => setTxt(e.target.value) }),
            h(Btn, { small: true, onClick: async () => {
              setSrc('')
              const r = await post('/voice/test', { text: txt, voice: draft.voice })
              if (r.ok) setSrc('data:' + r.mime + ';base64,' + r.data)
              else toast(r.message)
            } }, '生成'),
            src ? h('audio', { key: src, src, controls: true, autoPlay: true, style: { height: 32 } }) : null),
        ),
        h(VoiceSongModel, { draft, setDraft }),
      )
    }

    /** 语音识别单独一页：和「语音」「表情包」同级（移植自原项目 2baf896）。 */
    /**
     * 「获取可用模型」：按这一页填的地址和 Key 问服务有哪些模型，点一下就填进去，不用自己抄模型名。
     * Key 没填（已保存、面板不回显）时用已保存的那个（keyFrom 指明是哪一个）。
     */
