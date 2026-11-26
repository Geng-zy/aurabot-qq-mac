    function ImageGen({ draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const [imageTest, setImageTest] = useState(null)
      const [testingImage, setTestingImage] = useState(false)
      const [lastImageError, setLastImageError] = useState(null)
      useEffect(() => { get('/image/status').then((r) => setLastImageError(r.lastError || null)).catch(() => {}) }, [])
      const testImage = async () => {
        if (!confirm('会先保存当前生图设置，再调用当前服务画一张测试图，可能消耗额度。继续？')) return
        setTestingImage(true); setImageTest(null)
        try {
          const saved = await post('/save', { imageGen: draft.imageGen })
          if (!saved.ok) { setImageTest({ ok: false, message: saved.message || '保存生图设置失败' }); return }
          const r = await post('/image/test')
          setImageTest(r.ok ? { ok: true, image: r.image, message: r.message } : { ok: false, message: r.message || '试画失败' })
        } catch (e) { setImageTest({ ok: false, message: e.message }) } finally { setTestingImage(false) }
      }
      const c = draft.imageGen
      const custom = c.custom || {}
      const readyNow = (() => {
        if (c.provider === 'local' || c.provider === 'codex') return true
        if (c.provider === 'custom') return Boolean(custom.url)
        if (c.provider === 'comfyui') return Boolean(c.comfy?.workflow && c.comfy?.baseUrl)
        const needsKey = ['openai', 'seedream', 'xai', 'gemini', 'sensenova'].includes(c.provider)
        return Boolean(c.baseUrl || ['seedream', 'xai', 'gemini', 'sensenova'].includes(c.provider)) && (!needsKey || c.apiKey || c.apiKeySet)
      })()
      const isCustom = c.provider === 'custom'
      const isCodex = c.provider === 'codex'
      const isLocal = c.provider === 'local'
      const isComfy = c.provider === 'comfyui'
      const isPost = custom.method === 'POST'
      const params = Array.isArray(custom.params) ? custom.params : []
      const setParams = (next) => setDraft(setPath(draft, 'imageGen.custom.params', next))
      const setP = (i, k, v) => setParams(params.map((p, j) => (j === i ? { ...p, [k]: v } : p)))
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '让ta画图', right: f.sw('imageGen.enabled'), desc: '选择生图方式。自定义生图脚本可在「系统 → 本地接口」管理。' },
          h(Row, { label: '生图方式' },
            h(Select, {
              value: c.provider || 'openai', width: 270,
              onChange: (v) => setDraft(setPath(draft, 'imageGen.provider', v)),
              options: [{ value: 'openai', label: 'OpenAI 格式' }, { value: 'seedream', label: '豆包 Seedream' }, { value: 'xai', label: 'xAI' }, { value: 'gemini', label: 'Gemini' }, { value: 'sensenova', label: 'SenseNova' }, { value: 'comfyui', label: 'ComfyUI' }, { value: 'custom', label: '自定义接口' }, { value: 'codex', label: 'Codex 订阅（实验性）' }, { value: 'local', label: '本地部署' }],
            })),
          isLocal ? h(BuiltinLocalImage, { draft, setDraft, toast }) : isCodex ? h(CodexSub, { draft, setDraft, toast }) : isComfy ? h('div', null,
            h(Row, { label: 'ComfyUI 地址', hint: '只填到主机和端口，不要带 /prompt' }, f.text('imageGen.comfy.baseUrl', { size: 'wide', placeholder: 'http://127.0.0.1:8188' })),
            h(Row, { label: 'API workflow', hint: 'ComfyUI「Save (API Format)」导出的 JSON；没有提示词节点时用 __PROMPT__ 占位，参考图用 __IMAGE__' },
              h('textarea', { className: 'ab-input wide', rows: 5, value: c.comfy?.workflow || '', placeholder: '{"6":{"class_type":"CLIPTextEncode","inputs":{"text":"__PROMPT__"}}}', onChange: (e) => setDraft(setPath(draft, 'imageGen.comfy.workflow', e.target.value)) })),
            h(Row, { label: '提示词节点', hint: '可选，如 6；填了就直接改这个节点的 inputs.text' }, f.text('imageGen.comfy.promptNode', { placeholder: '6' })),
            h(Row, { label: '参考图节点', hint: '可选，LoadImage 节点编号；用参考图时必须填' }, f.text('imageGen.comfy.imageNode', { placeholder: '10' })),
            h(Row, { label: '输出节点', hint: '可选，只从这个节点的 images 取图' }, f.text('imageGen.comfy.outputNode', { placeholder: '9' })),
            h(Row, { label: '轮询间隔', hint: '默认 1000ms' }, f.num('imageGen.comfy.pollMs', { min: 200, max: 10000, step: 100 })),
          ) : isCustom ? h('div', null,
            h(Row, { label: '请求方式', hint: 'GET 把参数都拼在地址上；POST 放进请求体' },
              h(Seg, {
                value: isPost ? 'POST' : 'GET',
                onChange: (v) => setDraft(setPath(draft, 'imageGen.custom.method', v)),
                options: [{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }],
              })),
            h(Row, { label: '接口地址', hint: '可以用 {prompt} {model} {size} {width} {height} {image}（参考图 base64）' },
              f.text('imageGen.custom.url', { size: 'wide', placeholder: 'https://image.pollinations.ai/prompt/{prompt}' })),
            h(Row, { label: 'API Key', hint: '会以 Authorization: Bearer 发出；不需要就留空' },
              f.secret('imageGen.apiKey')),
            h('div', { className: 'ab-label', style: { marginTop: 12 } },
              h('b', null, isPost ? '请求体参数' : 'URL 参数'),
              h('small', null, '参数名和值都自己填；值里可以用 {prompt}、{image}（参考图 base64）；参考图需配置 {image} 才能使用')),
            params.length
              ? params.map((p, i) => h('div', { key: i, className: 'ab-flex', style: { gap: 6, marginBottom: 6 } },
                h('input', { className: 'ab-input', style: { width: 170 }, value: p.key || '', placeholder: '参数名，如 model', onChange: (e) => setP(i, 'key', e.target.value) }),
                h('input', { className: 'ab-input', style: { flex: 1 }, value: p.value || '', placeholder: '值，可以用 {prompt}', onChange: (e) => setP(i, 'value', e.target.value) }),
                h(Btn, { small: true, onClick: () => setParams(params.filter((_, j) => j !== i)) }, '删')))
              : h('div', { className: 'ab-muted ab-small', style: { marginBottom: 6 } }, '还没有参数 —— 比如 model=flux-anime、width=1080、height=1920、nologo=true'),
            h('div', { className: 'ab-flex', style: { marginBottom: 10 } },
              h(Btn, { small: true, onClick: () => setParams([...params, { key: '', value: '' }]) }, '＋ 加一个参数')),
            isPost ? h(Row, { label: '请求体格式' },
              h(Seg, {
                value: custom.bodyType === 'form' ? 'form' : 'json',
                onChange: (v) => setDraft(setPath(draft, 'imageGen.custom.bodyType', v)),
                options: [{ value: 'json', label: 'JSON' }, { value: 'form', label: '表单' }],
              })) : null,
            h(Row, { label: '取值路径', hint: '接口直接回图片就留空；回 JSON 时填地址字段' },
              f.text('imageGen.custom.responsePath', { size: 'wide', placeholder: '如 data.0.url（留空自动找）' })),
          ) : h('div', null,
            h(Row, { label: '服务地址', hint: '一般以 /v1 结尾' }, f.text('imageGen.baseUrl', { size: 'wide', placeholder: 'https://api.siliconflow.cn/v1' })),
            h(Row, { label: 'API Key', hint: '只存在本机，不会显示出来' }, f.secret('imageGen.apiKey')),
            h(Row, { label: '模型' }, h('div', { style: { flex: 1 } },
              f.text('imageGen.model', { size: 'wide', placeholder: '例如 Kwai-Kolors/Kolors' }),
              h(ModelPicker, { kind: 'image', keyFrom: 'imageGen', toast, baseUrl: (draft.imageGen || {}).baseUrl, apiKey: (draft.imageGen || {}).apiKey, value: (draft.imageGen || {}).model, onPick: (m) => setDraft(setPath(draft, 'imageGen.model', m)) }))),
          ),
          h(Row, { label: '默认构图', hint: isLocal ? '本地模型最长边为 1024 像素，按构图比例缩放。' : isCodex ? '通过构图提示引导，实际尺寸由服务端选择，不保证严格比例' : '聊天工具可指定本次构图。服务不支持所选尺寸时会报告失败，请换一种构图；自定义接口需使用尺寸占位符' },
            f.select('imageGen.shape', [
              { value: 'her', label: '让ta选择', desc: isCodex ? '未指定时由服务端选择' : '未指定时沿用图片尺寸' },
              { value: 'square', label: isCodex ? '方图 1:1' : '方图 1:1（1024 × 1024）' },
              { value: 'portrait', label: isCodex ? '竖图 2:3' : '竖图 2:3（1024 × 1536）' },
              { value: 'landscape', label: isCodex ? '横图 3:2' : '横图 3:2（1536 × 1024）' },
              { value: 'wide', label: isCodex ? '宽幅 16:9' : '宽幅 16:9（1536 × 864）' },
            ], { width: 260 })),
          !isCodex && (!c.shape || c.shape === 'her') ? h(Row, { label: '图片尺寸', hint: isCustom ? '接口地址 / 参数里可以用 {size} 或 {width}/{height}' : '未指定构图时沿用这个尺寸' },
            f.select('imageGen.size', [{ value: '1024x1024', label: '1024 × 1024', desc: '方图' }, { value: '768x1024', label: '768 × 1024', desc: '竖图' }, { value: '1024x768', label: '1024 × 768', desc: '横图' }, { value: '512x512', label: '512 × 512', desc: '小图，更快' }, { value: '2048x2048', label: '2K · 2048 × 2048', desc: '2K 方图' }, { value: '4096x4096', label: '4K · 4096 × 4096', desc: '4K 方图' }].filter((size) => !isLocal || Number(size.value.split('x')[0]) <= 1024), { width: 230 })) : null,
          h(Row, { label: '固定风格', hint: '每次画都会加在描述前面' }, f.text('imageGen.stylePrompt', { size: 'wide', placeholder: '例如：日系二次元，柔和光线，蓝白配色' })),
          h(Row, { label: '允许参考图改画', hint: '默认开启，只接受当前聊天收到的图、引用图或图库文件名；Codex 订阅暂不支持' }, f.sw('imageGen.img2img')),
          h(Row, { label: '让ta画完自己看一眼', hint: '开着才把画好的图传给ta看（模型不支持看图时自动不传）；关掉就只回一句「画好了」，不传图' }, f.sw('imageGen.seeOwn')),
          h(Row, { label: '连通性测试', hint: '会真的调用当前生图服务画一张 512×512 测试图，可能消耗额度' },
            h(Btn, { small: true, disabled: testingImage || !readyNow, onClick: testImage }, testingImage ? '试画中…' : '试画一张'),
            h('span', { className: readyNow ? 'ab-badge' : 'ab-muted ab-small' }, readyNow ? '配置就绪' : '还缺端点配置'),
            imageTest ? h('span', { className: 'ab-muted ab-small' }, imageTest.message || (imageTest.ok ? '成功' : '失败')) : null),
          imageTest?.image ? h('img', { src: 'data:image/png;base64,' + imageTest.image, alt: '生图测试结果', style: { maxWidth: 220, borderRadius: 8, marginTop: 8 } }) : null,
          lastImageError ? h('div', { className: 'ab-note', style: { marginTop: 8 } },
            `上次失败（${new Date(lastImageError.at).toLocaleString()}，${lastImageError.provider || '未知服务'}）：${lastImageError.message}`,
            h(Btn, { small: true, kind: 'ghost', onClick: async () => { await post('/image/status/clear'); setLastImageError(null) } }, '清除')) : null,
          isCustom ? h('div', { className: 'ab-note', style: { marginTop: 10 } }, '例子：地址填 https://image.pollinations.ai/prompt/{prompt}，再加 model=flux-anime、width=1080、height=1920、nologo=true 四个参数，GET 就会请求 …/prompt/<提示词>?model=flux-anime&width=1080&…') : null,
          !c.enabled ? h('div', { className: 'ab-note', style: { marginTop: 10 } }, isLocal ? '部署完成后，打开右上角开关并保存。' : '填好接口信息后，打开右上角开关并保存。') : null,
        ),
        isLocal ? null : h(ImageFallbacks, { draft, setDraft }),
        h(AppearanceCard, { draft, toast }),
        h(PaintGallery, { draft, setDraft, toast }),
      )
    }

    /** 云备份（Gitee 私有仓库 / WebDAV）：每天到点自动打包，把最新备份推上去，远端只留最近 N 份。 */
