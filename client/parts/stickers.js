    function Stickers({ draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const [items, setItems] = useState(null)
      const fileRef = useRef(null)
      const load = () => get('/stickers').then((r) => setItems(r.items || []))
      useEffect(() => { load() }, [])
      const [newName, setNewName] = useState('')
      // 起名用哪个模型：列 DSH 里已经接好的模型，能看图的标出来（AI 补全必须看图）
      const [models, setModels] = useState(null)
      useEffect(() => { get('/models').then((r) => setModels(r.list || [])).catch(() => setModels([])) }, [])
      const cm = (draft.stickers && draft.stickers.captionModel) || {}
      const cmKey = cm.provider && cm.model ? cm.provider + '::' + cm.model : ''
      const cmHit = cmKey && models ? models.find((m) => m.provider + '::' + m.model === cmKey) : null
      const pickCaptionModel = (v) => {
        const [p, ...rest] = String(v || '').split('::')
        setDraft(setPath(setPath(draft, 'stickers.captionModel.provider', v ? p : ''), 'stickers.captionModel.model', v ? rest.join('::') : ''))
      }
      // 多选：勾中若干张，一次确认全部删掉（不用一张张点、一张张确认）
      const [picking, setPicking] = useState(false)
      const [picked, setPicked] = useState([])
      const [dropQQ, setDropQQ] = useState(true)
      // AI 批量补名字 / 标签：后台跑，这里每 2 秒看一次进度
      const [job, setJob] = useState(null)
      const [redoAll, setRedoAll] = useState(false)
      const shown = useRef(0)
      const jobRunning = Boolean(job && job.running)
      // 面板关掉再打开时，后台可能还有一轮在跑：接上它的进度，别让按钮看起来能再点一次
      useEffect(() => {
        get('/sticker/caption-status').then((r) => { if (r && r.running) { shown.current = r.done || 0; setJob(r) } })
      }, [])
      useEffect(() => {
        if (!jobRunning) return undefined
        let live = true
        const timer = setInterval(async () => {
          const r = await get('/sticker/caption-status')
          if (!live || !r || r.ok === false) return
          setJob(r)
          if (!r.running) {
            clearInterval(timer)
            load()
            toast(r.message || '整理完了', r.failed ? 'err' : 'ok')
          } else if ((r.done || 0) - shown.current >= 5) {
            shown.current = r.done || 0 // 每跑五张刷一下，新起的名字能早点看到
            load()
          }
        }, 2000)
        return () => { live = false; clearInterval(timer) }
      }, [jobRunning])
      const startCaption = async () => {
        const r = await post('/sticker/caption-all', { all: redoAll })
        if (!r.ok) { toast(r.message || '没开始', 'err'); return }
        toast(r.message || '开始了')
        if (!r.total) return
        shown.current = 0
        setJob({ running: true, total: r.total, done: 0, ok: 0, failed: 0, skipped: 0, last: '' })
      }
      const toggle = (md5) => setPicked((cur) => (cur.includes(md5) ? cur.filter((x) => x !== md5) : [...cur, md5]))
      const allPicked = Boolean(items && items.length) && picked.length === items.length
      const dropPicked = async () => {
        if (!picked.length) return
        const n = picked.length
        const ask = dropQQ ? '删掉选中的 ' + n + ' 张表情？（QQ 收藏里也会一起删）' : '删掉选中的 ' + n + ' 张表情？（只删本地库，QQ 收藏保留）'
        if (!confirm(ask)) return
        const r = await post('/sticker/delete-batch', { md5s: picked, fromQQ: dropQQ })
        toast(r.message || (r.ok ? '删掉了 ' + n + ' 张' : '没删成'), r.ok ? 'ok' : 'err')
        setPicked([])
        load()
      }
      // DSH 是 Electron，不支持 prompt() 弹框：名字在页面上填（不填就自动看图起名）
      const upload = async (files) => {
        const list = [...(files || [])]
        if (!list.length) return
        let ok = 0
        const errs = []
        for (const file of list) {
          if (file.size > 5 * 1024 * 1024) { errs.push(file.name + ' 超过 5MB'); continue }
          try {
            const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('读不了这个文件')); fr.readAsDataURL(file) })
            const r = await post('/sticker/upload', { data, name: list.length === 1 ? newName.trim().slice(0, 12) : '' })
            if (r.ok) ok++
            else errs.push(file.name + '：' + (r.reason || r.message || '没加成功'))
          } catch (e) {
            errs.push(file.name + '：' + e.message)
          }
        }
        setNewName('')
        toast(errs.length ? (ok ? `加好 ${ok} 张；` : '') + errs.join('；') : `加好了 ${ok} 张`, errs.length ? 'err' : 'ok')
        load()
      }
      // 右上角工具条：平时是上传 / 导入 / AI 补标签 / 多选，多选模式下换成批量操作
      const bar = picking
        ? [
          h('span', { key: 'n', className: 'ab-muted ab-small' }, '已选 ' + picked.length + ' 张'),
          h(Btn, { key: 'all', small: true, kind: 'ghost', onClick: () => setPicked(allPicked ? [] : (items || []).map((i) => i.md5)) }, allPicked ? '全不选' : '全选'),
          h(Btn, { key: 'inv', small: true, kind: 'ghost', onClick: () => setPicked((items || []).map((i) => i.md5).filter((md5) => !picked.includes(md5))) }, '反选'),
          h('label', { key: 'qq', className: 'ab-small ab-muted', title: '取消勾选就只删本地库，QQ 收藏里的表情留着' },
            h('input', { type: 'checkbox', checked: dropQQ, onChange: (e) => setDropQQ(e.target.checked) }), ' 连 QQ 收藏一起删'),
          h(Btn, { key: 'del', small: true, kind: 'danger', disabled: !picked.length, onClick: dropPicked }, '删除所选'),
          h(Btn, { key: 'end', small: true, kind: 'ghost', onClick: () => { setPicking(false); setPicked([]) } }, '取消多选'),
        ]
        : [
          h('input', { key: 'file', ref: fileRef, type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' }, onChange: (e) => { upload(e.target.files); e.target.value = '' } }),
          h('input', { key: 'name', className: 'ab-input sm', style: { width: 140 }, placeholder: '名字（可不填）', value: newName, onChange: (e) => setNewName(e.target.value) }),
          h(Btn, { key: 'up', small: true, onClick: () => fileRef.current && fileRef.current.click() }, '＋ 上传'),
          h(Btn, { key: 'imp', small: true, title: '把机器人号 QQ「我喜欢的」里已有的表情导进来', onClick: async () => { toast('正在从 QQ 收藏导入…'); const r = await post('/sticker/import-qq'); toast(r.message, r.ok === false ? 'err' : 'ok'); load() } }, '从 QQ 收藏导入'),
          h(Btn, { key: 'ai', small: true, kind: 'primary', disabled: jobRunning, title: '用「起名用的模型」看图（默认跟随聊天模型），给还没有名字或标签的表情起名字、打标签（后台跑，可以关掉面板）', onClick: startCaption }, 'AI 补全标签'),
          h('label', { key: 'redo', className: 'ab-small ab-muted', title: '勾上以后连已经有名字的也重新起一遍（会重新花模型调用）' },
            h('input', { type: 'checkbox', checked: redoAll, onChange: (e) => setRedoAll(e.target.checked) }), ' 全部重做'),
          h(Btn, { key: 'pick', small: true, kind: 'ghost', onClick: () => { setPicking(true); setPicked([]) } }, '多选'),
          h(Btn, { key: 'reload', small: true, kind: 'ghost', onClick: load }, '刷新'),
        ]
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '表情包', right: f.sw('stickers.enabled'), desc: '回复里写 <sticker:名字> 就会发对应的表情；也会按概率自动配一张。' },
          h(Row, { label: '自动配表情的概率' }, f.percent('stickers.autoChance')),
          h(Row, { label: '夹 QQ 小黄脸', hint: '回复里能夹 QQ 自带的系统表情（/捂脸 /斜眼笑 这种），和文字在同一条消息里' }, f.sw('stickers.faces')),
          h(Row, { label: '偷表情', hint: '别人发的表情包会被收藏（普通照片不收）。' }, f.sw('stickers.collect'), h('span', { className: 'ab-muted' }, '从群里'), f.sw('stickers.fromGroups'), h('span', { className: 'ab-muted' }, '从私聊'), f.sw('stickers.fromPrivate')),
          draft.stickers.collect ? h(Row, { label: '怎么偷', hint: '「ta挑」只递给ta看，喜欢才收；「只听管理员的」只在管理员私聊 / 这一轮只有管理员时ta才可自己收，有别人在场要管理员发话' },
            f.choices('stickers.collectMode', [
              { value: 'auto', label: '全都偷', desc: '看到就收，不用ta同意（默认，保持原行为）' },
              { value: 'ask', label: 'ta挑', desc: '先记着，给ta一句轻提示，喜欢才凭编号收' },
              { value: 'owner', label: '只听管理员的', desc: '只有管理员私聊 / 只有管理员时ta才可自己收；别人在场要管理员发话' },
            ])) : null,
          h(Row, { label: '每小时最多收' }, f.num('stickers.maxPerHour', { min: 0 }), h('span', { className: 'ab-muted' }, '张')),
          h(Row, { label: '表情库最多存', hint: 'QQ 收藏表情有数量上限，满了就收不进去了。超过这个数会自动清掉最少用的偷来的表情（你自己加的不会动）' }, f.num('stickers.maxLibrary', { min: 20, max: 2000 }), h('span', { className: 'ab-muted' }, '张')),
          h(Row, { label: '看图起名', hint: '收下后让模型看图起个 12 字以内的备注；库里已有的名字可以点右边「AI 补全标签」批量补' }, f.sw('stickers.caption')),
          h(Row, { label: '起名用的模型', hint: 'AI 补全标签 / 看图起名都要看图：留空就用「模型」页那个聊天模型，也可以单独挑一个 DSH 里已经接好的视觉模型。' },
            h(Select, {
              value: cmKey, width: 320,
              options: [{ value: '', label: '跟随聊天模型', desc: '和「模型」页选的一样' }].concat((models || []).map((m) => ({
                value: m.provider + '::' + m.model,
                label: m.name + (m.vision === true ? '（能看图）' : m.vision === false ? '（不看图）' : ''),
                desc: m.provider,
                group: m.provider,
              }))),
              onChange: pickCaptionModel,
            }),
            models === null ? h('span', { className: 'ab-muted ab-small' }, ' 正在查模型…') : null,
            cmHit && cmHit.vision === false ? h('span', { className: 'ab-small', style: { color: 'var(--ab-warn)' } }, ' 这个模型看不了图，起名会被跳过') : null),
        ),
        h(Card, { title: '表情库' + (items ? '（' + items.length + ' 张）' : ''), right: h('div', { className: 'ab-flex' }, bar) },
          job ? h('div', { className: 'ab-flex', style: { margin: '0 0 10px' } },
            job.running ? h('i', { key: 's', className: 'ab-spin' }) : h('span', { key: 'k', style: { color: job.failed ? 'var(--ab-warn)' : 'var(--ab-ok)' } }, '✓'),
            h('span', { key: 't', className: 'ab-small' }, job.running
              ? 'AI 起名中 ' + (job.done || 0) + ' / ' + (job.total || 0) + (job.model ? '（' + job.model + '）' : '') + (job.last ? '，刚起好「' + job.last + '」' : '')
              : (job.message || '整理完了')),
            job.running ? h('div', { key: 'bar', className: 'ab-progress' }, h('i', { style: { width: Math.round(((job.done || 0) / Math.max(job.total || 1, 1)) * 100) + '%' } })) : null,
            job.running
              ? h(Btn, { key: 'stop', small: true, kind: 'ghost', onClick: async () => { const r = await post('/sticker/caption-stop', {}); toast(r.message || '停了') } }, '停')
              : h(Btn, { key: 'ok', small: true, kind: 'ghost', onClick: () => setJob(null) }, '知道了'),
          ) : null,
          items === null ? h(Empty, { icon: '⏳', text: '加载中…' }) : items.length === 0 ? h(Empty, { icon: '🐳', text: '表情库还是空的。别人在群里发表情包，ta会自己收；也可以点右上角上传，或者「从 QQ 收藏导入」机器人号已经收藏的表情。' }) :
            h('div', { className: cx('ab-stickers', picking && 'picking') },
              items.map((it) => h(StickerCell, { key: it.md5, it, onChanged: load, toast, picking, selected: picked.includes(it.md5), onToggle: toggle }))),
        ),
        h(Card, {
          title: '贴表情',
          right: f.sw('stickers.react'),
          desc: '默认关。打开后看到谁的消息，就可能贴个表情——不一定回话，只在旁边看着也行。emoji 直接给 Unicode 码点（🍬 127852、👍 128077），QQ 老表情是另一套编号（❓ 10068），两种混着用都行。',
        },
          h(Row, { label: '主动贴表情的概率', hint: '默认 15%，和「表情包」那张卡里的自动配表情各算各的，互不影响；心情好会更频繁' },
            h(Range, {
              min: 0,
              max: 100,
              value: pct(draft.stickers.reactChance ?? 0.15),
              onChange: (v) => setDraft(setPath(draft, 'stickers.reactChance', v / 100)),
              fmt: (v) => v + '%',
            })),
          h(Row, { label: '概率表', hint: '实际概率 = 拖拽条的值 × 心情系数（心情越高越爱贴；超过 100% 就是必贴）' },
            (() => {
              const base = Number(draft.stickers.reactChance ?? 0.15) || 0
              const cell = (key, text, extra) => h('td', { key, style: Object.assign({ padding: '3px 16px 3px 0' }, extra) }, text)
              return h('table', { style: { borderCollapse: 'collapse', fontSize: 12, marginTop: 2 } },
                h('thead', null, h('tr', null,
                  cell('h0', '心情', { opacity: 0.55, fontWeight: 500 }),
                  cell('h1', '系数', { opacity: 0.55, fontWeight: 500, textAlign: 'right' }),
                  cell('h2', '实际概率', { opacity: 0.55, fontWeight: 500, textAlign: 'right', paddingRight: 0 }),
                )),
                h('tbody', null, REACT_MOOD_BANDS.map(([label, mult]) => h('tr', { key: label },
                  cell('m', label, { opacity: 0.8 }),
                  cell('k', mult + '×', { opacity: 0.55, textAlign: 'right' }),
                  cell('p', Math.min(100, Math.round(base * mult * 1000) / 10) + '%', { textAlign: 'right', paddingRight: 0, fontVariantNumeric: 'tabular-nums' }),
                ))),
              )
            })()),
          h(Row, { label: '每小时上限', hint: '每个会话单独算，免得在热闹的群里刷屏' }, f.range('stickers.reactMaxPerHour', 0, 60, 1, (v) => v + ' 次')),
        ),
        h(FaceMapCard, null),
      )
    }

    /**
     * 一张表情：名字（备注）和标签都能直接改，改完离开输入框就保存（#31：模型起的名字 / 标签不对时手动纠正）。
     * 多选模式下整张卡片就是勾选框，点一下就选中。
     */
