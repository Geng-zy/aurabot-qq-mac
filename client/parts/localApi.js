    function LocalApi({ draft, setDraft, toast, slot }) {
      const f = useField(draft, setDraft)
      const [st, setSt] = useState(null)
      const [busy, setBusy] = useState('')
      const [img, setImg] = useState('')
      const load = () => get('/local/status').then(setSt)
      useEffect(() => { load() }, [])
      const act = async (path, target, label) => {
        setBusy(target + label)
        try {
          const r = await post(path, { slot: target })
          notify(toast, r)
          if (r.image) setImg(r.image)
          await load()
        } catch (error) {
          toast(error.message, 'err')
        } finally {
          setBusy('')
        }
      }
      return h('div', { className: 'ab-grid' },
        slot === 'video' ? h(Card, { title: '本地视频脚本', desc: '生成视频需要可用的本机服务和接入脚本。' }) : slot ? null : h(Card, { title: '本地接口', desc: '想用自己电脑上的模型或服务（GPT-SoVITS 语音、SD WebUI / ComfyUI 画图、自己训练的 so-vits-svc 音色、本地语音识别……）？在这里生成一个脚本模板，照注释改，或者点「复制给 DSH」粘给 DSH，让它帮你改。脚本放在插件数据目录的 local 文件夹里，插件升级不会覆盖；改完保存就生效，不用重启。每一项要打开开关才会用，出错时语音和识别会自动退回内置方式。' },
          h('div', { className: 'ab-flex' },
            h('code', { className: 'ab-small', style: { wordBreak: 'break-all', flex: 1 } }, st ? st.dir : '…'),
            h(Btn, { small: true, onClick: () => post('/local/open').then((r) => toast(r.message)) }, '打开文件夹')),
          h(Row, { label: 'ffmpeg 路径', hint: '语音转换与图片处理共用，留空时自动查找' }, f.text('local.ffmpegPath', { placeholder: '/opt/homebrew/bin/ffmpeg' }))),
        !st ? h(Empty, { icon: '⏳', text: '加载中…' }) : (st.list || []).filter((x) => !slot || x.slot === slot).map((x) => h(Card, { key: x.slot, title: x.title + '（' + x.file + '）', right: f.sw('local.' + x.slot) },
          h('div', { className: 'ab-flex', style: { marginBottom: 8 } },
            h('span', { className: 'ab-small', style: { color: x.active ? 'var(--ab-ok)' : 'var(--ab-muted)' } },
              x.active ? '● 正在由本地脚本接管' : !x.exists ? '还没有这个脚本' : x.exists && !x.approved ? '脚本还没确认（不会执行）' : !x.enabled ? '脚本已经有了，开关没开（用内置方式）' : '用内置方式'),
            x.last ? h('span', { className: 'ab-small', style: { color: x.last.ok ? 'var(--ab-ok)' : 'var(--ab-err)' } }, ' · 上次' + (x.last.ok ? '成功，' + x.last.message : '出错：' + x.last.message)) : null),
          h('div', { className: 'ab-flex' },
            x.exists ? (x.approved ? null : h(Btn, { small: true, kind: 'primary', disabled: !!busy, onClick: () => act('/local/trust', x.slot, 't') }, '确认这个脚本')) : h(Btn, { small: true, kind: 'primary', disabled: !!busy, onClick: () => act('/local/template', x.slot, 't') }, '生成模板'),
            h(Btn, { small: true, onClick: () => { clipboard(x.prompt).then(() => toast('修改提示词复制好了，粘给 DSH，再把【】里那句换成你的情况', 'ok'), () => toast('复制失败，手动选中复制吧', 'err')) } }, '复制给 DSH'),
            x.exists && (x.slot === 'tts' || x.slot === 'image') ? h(Btn, { small: true, disabled: !!busy, onClick: () => act('/local/test', x.slot, 'x') }, busy === x.slot + 'x' ? '正在试…' : '试一下') : null),
          x.slot === 'video' ? h(Row, { label: '最多等多久', hint: '生视频很慢，超过这个时间算失败' }, f.num('local.videoTimeoutMin', { min: 1 }), h('span', { className: 'ab-muted' }, '分钟')) : null,
          x.slot === 'image' && img ? h('img', { src: 'data:image/png;base64,' + img, style: { marginTop: 10, maxWidth: 240, borderRadius: 8 } }) : null)),
      )
    }

    // ---------------- 扩展：模块 ----------------
    const MOD_STATE = (m) => {
      if (m.safeSkipped) return { cls: 'dim', text: '安全模式，没加载' }
      if (!m.enabled) return { cls: 'dim', text: '关着' }
      if (m.running === 'user' && m.builtin) return { cls: 'mine', text: '用的是你的版本' }
      if (m.running === 'user') return { cls: 'mine', text: '在跑' }
      if (m.running === 'builtin' && m.fallback) return { cls: 'warn', text: '你的版本没加载成功，先用内置的' }
      if (m.running === 'builtin') return { cls: '', text: '在跑' }
      return { cls: 'err', text: m.error ? '没加载成功' : '没在跑' }
    }

    /** 一个模块一行：开关、状态、报错，能复制来改 / 用回内置的 / 重新加载。 */
