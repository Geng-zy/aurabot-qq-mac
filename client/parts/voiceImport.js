    function VoiceImport({ s, toast, onChange }) {
      const [over, setOver] = useState(false)
      const [busy, setBusy] = useState('')
      // 生成音色档案：DSH 是 Electron，不支持 prompt() 弹框，数据集文件夹在列表里就地填
      const [profFor, setProfFor] = useState('')
      const [profDir, setProfDir] = useState('')
      const buildProfile = async (id) => {
        const folder = profDir.trim()
        if (!folder) { toast('先填数据集文件夹的完整路径', 'err'); return }
        const r = await post('/song/voice/profile', { id, folder })
        notify(toast, r)
        if (r.ok) { setProfFor(''); setProfDir('') }
        onChange()
      }
      const upload = async (files) => {
        for (const file of [...files]) {
          if (!/\.(zip|pth|index|ckpt|yaml)$/i.test(file.name)) { toast('「' + file.name + '」不是 .zip / .pth / .index / .ckpt / .yaml', 'err'); continue }
          setBusy('正在导入「' + file.name + '」（' + Math.round(file.size / 1024 / 1024) + 'MB）…')
          const r = await fetch(API + '/song/import?name=' + encodeURIComponent(file.name), { method: 'POST', body: file })
            .then((x) => x.json()).catch((e) => ({ ok: false, message: '上传失败：' + e.message }))
          notify(toast, r)
        }
        setBusy('')
        onChange()
      }
      const pick = () => {
        const inp = document.createElement('input')
        inp.type = 'file'
        inp.multiple = true
        inp.accept = '.zip,.pth,.index,.ckpt,.yaml'
        inp.onchange = () => inp.files && upload(inp.files)
        inp.click()
      }
      return h(Card, { title: '音色模型', desc: '插件不自带音色。把你有权使用的 RVC 模型导进来：.pth（可以带 .index），或者装着它们的 zip。只存在本机。自己训练的是 so-vits-svc 之类别的模型、或者想用自己的推理参数？去「本地接口」页接「翻唱换声」。' },
        h('div', {
          className: 'ab-drop' + (over ? ' over' : ''), role: 'button', tabIndex: 0,
          onClick: pick, onKeyDown: (e) => (e.key === 'Enter' || e.key === ' ') && pick(),
          onDragOver: (e) => { e.preventDefault(); setOver(true) }, onDragLeave: () => setOver(false),
          onDrop: (e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files) },
        }, busy ? h('span', null, h('i', { className: 'ab-spin' }), ' ' + busy) : h('span', null, '把 .zip / .pth / .index 拖到这里，或者点击选择文件')),
        // 分离模型自动下载不动时：给几个地址，用浏览器或下载工具下好，拖进上面这个框
        s.parts && !s.parts.separatorModel && (s.separatorLinks || []).length ? h('div', { className: 'ab-note', style: { marginTop: 10 } },
          h('b', null, '人声分离模型下不动？'), ' 安装时会自动试好几个源（断了能接着下，太慢会换源）。实在不行，用浏览器或下载工具把下面还缺的文件下好（同一个文件名的几个地址是同一个文件，任选一个），拖进上面这个框就行，插件会核对文件对不对：',
          (s.separatorLinks || []).map((u) => h('div', { key: u, className: 'ab-flex', style: { marginTop: 4 } },
            h('code', { className: 'ab-small', style: { wordBreak: 'break-all', flex: 1 } }, u),
            h(Btn, { small: true, kind: 'ghost', onClick: () => { clipboard(u).then(() => toast('复制了', 'ok'), () => toast('复制失败，手动选中复制吧', 'err')) } }, '复制')))) : null,
        s.voices.length && !s.enabled ? h('div', { className: 'ab-note warn', style: { marginTop: 10 } }, '音色导入好了，但翻唱开关还没开（这一页最上面），打开并保存后ta才会唱。') : null,
        s.profileJob ? h('div', { className: cx('ab-note', s.profileJob.ok === false && 'err'), style: { marginTop: 10 } }, (s.profileJob.running ? '⏳ ' : '') + '音色档案「' + s.profileJob.id + '」：' + s.profileJob.message) : null,
        s.voices.length === 0 ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 8 } }, '还没有音色。') :
          h('div', { className: 'ab-list', style: { marginTop: 10 } }, s.voices.map((v) => h(Fragment, { key: v.id },
            h('div', { className: 'ab-li' },
              h('div', { className: 'body' }, h('b', null, v.id), v.hasIndex ? h('span', { className: 'ab-muted ab-small' }, ' · 带 index') : null,
                h('span', { className: 'ab-small', style: { color: v.hasProfile ? 'var(--ab-ok)' : 'var(--ab-sub)' } }, v.hasProfile ? ' · 有音色档案' : ' · 没有音色档案（不定调、不校正音色）')),
              h(Btn, { small: true, kind: 'ghost', disabled: Boolean(s.profileJob && s.profileJob.running), onClick: () => { setProfFor(profFor === v.id ? '' : v.id); setProfDir('') } },
                profFor === v.id ? '收起' : v.hasProfile ? '重新生成档案' : '生成音色档案'),
              h(Btn, { small: true, kind: 'ghost', onClick: async () => { if (!confirm('删掉音色「' + v.id + '」？（连同它的 index 和音色档案）')) return; const r = await post('/song/voice/delete', { id: v.id }); notify(toast, r); onChange() } }, '删除')),
            profFor === v.id ? h('div', { className: 'ab-flex', style: { margin: '6px 0 10px' } },
              h('input', { className: 'ab-input', style: { flex: 1 }, value: profDir, placeholder: '「' + v.id + '」的数据集文件夹完整路径（本人的干声录音，wav / flac / mp3），如 ' + exPath('Downloads/数据集'),
                onChange: (e) => setProfDir(e.target.value), onKeyDown: (e) => e.key === 'Enter' && buildProfile(v.id) }),
              h(Btn, { small: true, kind: 'primary', disabled: Boolean(s.profileJob && s.profileJob.running), onClick: () => buildProfile(v.id) }, '开始生成')) : null))))
    }

    const fmtBytes = (n) => (n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(2) + ' GB' : (n / 1024 ** 2).toFixed(n >= 100 * 1024 ** 2 ? 0 : 1) + ' MB')
    const fmtDur = (ms) => { const sec = Math.max(0, Math.round(ms / 1000)); return sec >= 60 ? Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒' : sec + ' 秒' }

    /** 装到哪里：默认位置一键选回；也可以自己填路径。 */
