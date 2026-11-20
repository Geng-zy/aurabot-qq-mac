// 内置模块：生图。她能画图发到聊天里（OpenAI 兼容的生图服务，或「本地接口」里接的 SD WebUI / ComfyUI）。

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createAppearance, DESCRIBE_SYSTEM, MAX_APPEARANCE } from '../../features/appearance.js'
import { findSharp, shrinkWithSharp } from '../../core/img.js'
import { canSeeImages } from '../../core/llm.js'
import { createImageGen, drawResultBlocks, drawToolMessage, imageToolBlock, resolveDrawImage } from '../../features/imagegen.js'
import { listPaintings, openPaintFolder, paintingPath, rememberPainting, removePainting, savePainting } from '../../features/paintings.js'
import { defineTool, str } from '../../tools/tools.js'
import { SIZE_OPTIONS } from '../../features/image-shape.js'
import { dataDir } from '../../core/store.js'
import { hasActionPhrase } from '../../mind/motivation/index.js'
import { mimeOf } from '../../core/image-info.js'
import { drawChatAllowed, isOwner } from '../../chat/access.js'
import { ownerAuthorizationRevision } from '../../core/config.js'
import { createLocalImage } from '../../features/local-image.js'

export default {
  id: 'imagegen',
  name: '生图',
  version: '1.0.0',
  description: '画一张图发到聊天里（qq_draw_image）',
  tab: 'imagegen',
  files: ['features/imagegen.js', 'features/image-shape.js', 'features/paintings.js', 'features/codex-auth.js', 'features/codex-image.js', 'features/appearance.js', 'features/local-image.js'],
  setup(api) {
    const { hub, local } = api.core
    const localImage = createLocalImage({ log: api.log, mirror: () => api.config().song?.pypiMirror || 'auto' })
    const gen = createImageGen({ getConfig: api.config, log: api.log, local, localImage })
    const auth = gen.codexAuth
    const lifetime = new AbortController()
    api.onDispose?.(() => { lifetime.abort(); localImage.dispose(); gen.dispose() })
    const closed = () => lifetime.signal.aborted

    const accountAction = (fn) => async (req) => {
      if (req?.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(String(req.headers?.['content-type'] || ''))) return { ok: false, message: '账号操作需要 POST JSON 请求' }
      return fn(req)
    }
    api.route('/image/codex/status', async () => ({ ok: true, ...auth.status(), login: auth.loginStatus() }))
    api.route('/image/codex/login', accountAction(async () => ({ ok: true, ...(await auth.startLogin()), ...auth.loginStatus() })))
    api.route('/image/codex/login/status', async () => ({ ok: true, ...auth.loginStatus(), ...auth.status() }))
    api.route('/image/codex/complete', accountAction(async (req) => {
      const body = await api.core.http.body(req)
      const credential = await auth.completeLogin(String(body?.input || ''))
      return { ok: true, email: credential.email || '', accountId: credential.accountId || '' }
    }))
    api.route('/image/codex/cancel', accountAction(async () => ({ ok: true, ...auth.cancelLogin('已取消') })))
    api.route('/image/codex/logout', accountAction(async () => ({ ok: true, ...auth.logout() })))

    const localAction = (fn) => async (req) => {
      if (req?.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(String(req.headers?.['content-type'] || ''))) return { ok: false, message: '请从生图面板发起操作。' }
      return fn()
    }
    const panelOnly = { access: 'panel' }
    api.route('/image/local/status', async () => localImage.status(), panelOnly)
    api.route('/image/local/install', localAction(async () => {
      const status = localImage.status()
      if (!status.supported || status.running || status.pending) return localImage.install()
      void localImage.install()
      return { ok: true, ...localImage.status() }
    }), panelOnly)
    api.route('/image/local/test', localAction(async () => {
      try {
        const buf = await localImage.generate('一条蓝色小鱼在水草间游动，柔和光线，水彩插画', { size: '512x512', steps: 8 })
        return { ok: true, image: buf.toString('base64'), message: '本地试画成功。' }
      } catch (error) { return { ok: false, message: error.message } }
    }), panelOnly)
    api.rule?.(() => api.config().imageGen.provider === 'local' && gen.enabled()
      ? '你会画图，可以用 qq_draw_image 在当前聊天发图。是否能画由生图权限决定。'
      : '')

    // ---------- 她的形象：管理员导入的几张参考图，她画自己时照着画 ----------
    const looks = createAppearance({
      dir: dataDir('appearance'),
      trashDir: join(homedir(), '.Trash'),
      // 存之前缩到 1536 以内（有 sharp 用 sharp），省地方也省生图请求的大小
      shrink: async (buf) => { const sharp = await findSharp().catch(() => null); return sharp ? shrinkWithSharp(sharp, buf, 1536) : buf },
    })
    api.route('/image/appearance', async () => ({ ok: true, list: looks.list(), description: looks.description(), max: MAX_APPEARANCE }))
    api.route('/image/appearance/image', async (req, res) => {
      const buf = looks.read(String(api.core.http.query(req).file || ''))
      if (!buf) return api.core.http.send(res, 404, '')
      api.core.http.send(res, 200, buf, String(mimeOf(buf) || 'image/png'))
    })
    api.route('/image/appearance/upload', async (req) => {
      if (req?.method !== 'POST') return { ok: false, message: '要用 POST 上传' }
      try { return await looks.add(await api.core.http.raw(req, 20 * 1024 * 1024)) } catch (error) { return { ok: false, message: error.message } }
    }, { access: 'panel' })
    api.route('/image/appearance/delete', async (req) => looks.remove(String((await api.core.http.body(req)).file || '')), { access: 'panel' })
    api.route('/image/appearance/primary', async (req) => looks.setPrimary(String((await api.core.http.body(req)).file || '')), { access: 'panel' })
    api.route('/image/appearance/description', async (req) => looks.setDescription(String((await api.core.http.body(req)).text || ''), 'owner'), { access: 'panel' })
    // 看图写一段外貌描述（要看得懂图的模型：表情起名单独挑了模型就用它，不然用聊天模型）
    api.route('/image/appearance/describe', async () => {
      const imgs = looks.buffers(4)
      if (!imgs.length) return { ok: false, message: '先导入几张她的图' }
      const pick = api.config().stickers?.captionModel
      const target = pick && pick.provider && pick.model ? { provider: pick.provider, model: pick.model } : null
      if ((await canSeeImages(api.dsh, api.config(), target).catch(() => null)) === false) return { ok: false, message: '现在用的模型看不了图：在「模型」页换一个能看图的，或者自己写描述' }
      try {
        const text = String(await api.ask({ system: DESCRIBE_SYSTEM, text: '这几张都是她。', images: imgs.map((b) => ({ data: b.toString('base64'), mediaType: String(mimeOf(b)) })), maxTokens: 600, ...(target ? { model: target } : {}) }) || '').trim()
        if (!text) return { ok: false, message: '模型没写出描述' }
        looks.setDescription(text, 'vision')
        return { ok: true, description: looks.description() }
      } catch (error) {
        return { ok: false, message: '没写成：' + error.message }
      }
    }, { access: 'panel' })

    // 她的画作：面板底下的图库（直接读存图目录，可以单张删、开文件夹）
    api.route('/image/gallery', async (req) => {
      const q = api.core.http.query(req)
      const limit = q && q.limit ? Number(q.limit) : api.config().imageGen.galleryShown
      return { ok: true, ...listPaintings({ limit }), dir: dataDir('imagegen') }
    })
    api.route('/image/gallery/image', async (req, res) => {
      const p = paintingPath(api.core.http.query(req).file)
      if (!p) return api.core.http.send(res, 404, '')
      const buf = readFileSync(p)
      api.core.http.send(res, 200, buf, String(mimeOf(buf) || 'image/png'))
    })
    api.route('/image/gallery/delete', async (req) => {
      const b = await api.core.http.body(req).catch(() => ({}))
      return removePainting(String((b && b.file) || ''))
    }, { access: 'panel' })
    api.route('/image/open-folder', async () => openPaintFolder(), { access: 'panel' })

    api.mind?.offer?.({
      id: 'own-painting', label: '画一张自己的画', needs: { beauty: 0.75, fun: 0.3 },
      effort: 0.3, cooldownMinutes: 360,
      matchWant: (text) => hasActionPhrase(text, /画(?:画|图|一张|一幅|下来|点什么|个)|涂鸦|(?:想|去|先)画/u),
      available: () => api.mind.creativeBlocked('art') || gen.enabled() || '生图服务未启用或尚未就绪',
      async run({ checkpoint, signal, wants }) {
        await checkpoint()
        const prompt = await api.mind.creativeIdea('art', wants)
        if (!prompt) return { ok: false, summary: '这次没有想出画面' }
        if (!gen.enabled() || !api.mind.creativeTarget('art', { continuing: true })) return { ok: false, summary: '主动画画已暂停' }
        if (!gen.localReady() && hub.containsProtectedText?.('system:creative', prompt)) return { ok: false, summary: '画面描述含私密内容' }
        await checkpoint()
        const bytes = await gen.generate(prompt, { signal })
        await checkpoint()
        if (!api.mind.creativeTarget('art', { continuing: true })) return { ok: false, summary: '主动画画已暂停' }
        const saved = savePainting(bytes, prompt)
        if (!saved) return { ok: false, summary: '画作未能保存' }
        api.mind.experience({ text: `自己画了一张图，主题是：${prompt}`, tags: ['画画'], importance: 0.5, effort: 0.05, secret: true })
        return { ok: true, summary: '画了一张图，已保存', outcome: 0.7 }
      },
    })

    api.tool(({ chat, sessionId }) => (gen.enabled() && chat.kind !== 'system' ? defineTool({
      name: 'qq_draw_image',
      description: '画一张图并发到当前 QQ 聊天里。prompt 详细描述画面；可以用 image 参考当前聊天最近收到的图（last）、引用消息里的图（quote）或自己画作的文件名来改画；shape 可按用途选择方图、竖图、横图或宽幅；size 可显式指定常用尺寸（含 2K/4K），不填就沿用 shape / 面板默认。画好会直接发出去，并给你一个画作编号（换头像、收成表情时用这个编号）。回复里用自己的话简单说一句。对方先发图然后让你画这个，用 last。引用带图的消息，用 quote。想重画同一角色时具体描述新的构图，并设置 redraw；局部改图不用 redraw。任务排队时只能说正在画，以成品实际发出为准。',
      properties: {
        prompt: str('画面描述，保留对方说的角色原名'),
        image: str('可选参考图：last = 当前聊天最近收到的一张图；quote = 当前聊天引用消息里的图；也可用画作文件名。禁止本地路径、网址'),
        self: { type: 'boolean', description: '画的是你自己（自拍、你的样子、你穿什么、合照里有你）时填 true：会照着管理员给你导入的形象图和形象描述画，画出来才像你' },
        shape: { type: 'string', enum: ['square', 'portrait', 'landscape', 'wide'], description: 'square 方图 1:1；portrait 竖图 2:3；landscape 横图 3:2；wide 宽幅 16:9。可不填' },
        size: { type: 'string', enum: SIZE_OPTIONS, description: '可选尺寸，例如 2048x2048（2K）、4096x4096（4K）；优先于 shape / 面板默认，不填沿用原逻辑' },
        redraw: { type: 'boolean', description: '以参考图的角色为基础重新设计构图和场景时填 true；仅改局部时留空' },
        background: { type: 'boolean', description: '默认后台画好直接发。本轮还要看成品、换头像或收表情时填 false' },
      },
      required: ['prompt'],
      // 能看图时把原图放进工具结果（image 块），她当轮就能看见自己画了什么
      render: drawResultBlocks,
      execute: async ({ prompt, shape, image, size, self, redraw, background }) => {
        const cfg = api.config()
        const ownerTurn = hub.turnSendersAllOwner(sessionId)
        const ownerPrivate = ownerTurn && chat.kind === 'private' && isOwner(cfg, chat.userId, chat.chatId)
        const ownerRevision = ownerAuthorizationRevision(cfg)
        const allowed = () => {
          const active = api.config()
          const verifiedOwner = ownerPrivate && ownerAuthorizationRevision(active) === ownerRevision && isOwner(active, chat.userId, chat.chatId)
          return String(active.platforms?.qq?.botQQ || active.botQQ) === String(cfg.platforms?.qq?.botQQ || cfg.botQQ) && (verifiedOwner || drawChatAllowed(active, chat.chatId))
        }
        if (!allowed()) return { ok: false, message: '这个会话未开放生图，请在生图白名单勾选。' }
        if (image && cfg.imageGen.img2img === false) return { ok: false, message: '参考图功能已关闭' }
        if (hub.containsProtectedText?.(chat.chatId, prompt)) return { ok: false, message: '画面描述含私密内容' }
        const startedAt = Date.now()
        let reference
        try {
          reference = await resolveDrawImage(image, { hub, chat, allowGlobalPaintings: ownerPrivate, quoteId: hub.quoteIdOf?.(sessionId) })
        } catch (error) {
          return { ok: false, message: error.message }
        }
        // 画她自己：有形象图就照着画（没指定别的参考图时用主图，其余几张能收的服务也一起给）；
        // 形象描述总是加进提示词，生图服务不收参考图、或者这次参考的是别的图时也画得像她
        let drawPrompt = String(prompt || '')
        let extra = []
        let usedLooks = false
        if (self) {
          const desc = looks.description()
          if (desc) drawPrompt = `画面里的「她」就是你自己，长这样：${desc}。${drawPrompt}`
          const mine = api.config().imageGen.img2img === false ? [] : looks.buffers()
          if (mine.length) {
            if (!reference) { reference = mine[0]; extra = mine.slice(1) } else extra = mine
            usedLooks = true
          }
        }
        if (redraw && reference) {
          drawPrompt = '以原图角色为参考绘制新的独立画面。重新设计取景与构图，去掉参考图的文字、白边和原排版。用户指定的细节优先。\n' + drawPrompt
        }
        if (hub.containsProtectedText?.(chat.chatId, drawPrompt)) return { ok: false, message: '画面描述含私密内容' }
        const draw = async (task) => {
          const isCurrent = () => !closed() && allowed() && api.config().enabled !== false && (!task || task.isCurrent())
          if (!isCurrent()) return { ok: false, message: '生图目前不可用' }
          const signal = task?.signal ? AbortSignal.any([task.signal, lifetime.signal]) : lifetime.signal
          const renderImage = () => gen.generate(drawPrompt, {
            shape, image: reference, size, extra, redraw: Boolean(redraw && reference), signal,
          })
          task?.checkpoint('生成图片')
          let buf
          try {
            buf = await renderImage()
          } catch (error) {
            // 生图服务不收参考图：形象图不用了，只靠形象描述再画一次（她自己要的参考图出错就照常报错）
            if (!(usedLooks && !image && /参考图|reference|edit/i.test(String(error.message)))) throw error
            api.log.info('生图服务不支持参考图，这次只按形象描述画她自己')
            reference = null
            usedLooks = false
            task?.checkpoint('生成图片')
            extra = []
            buf = await renderImage()
          }
          task?.checkpoint('准备发送')
          if (!isCurrent()) return { ok: false, message: '生图目前不可用' }
          const cfg = api.config()
          const dryRun = cfg.dryRun && !cfg.debug
          if (!dryRun) task?.beginDelivery()
          const sent = dryRun ? null : await hub.sendSegments(chat.chatId, [{ type: 'image', data: { file: 'base64://' + buf.toString('base64') } }], `[生图] ${String(prompt).slice(0, 30)}`, { isCurrent, allowQueue: !task })
          if (!sent && !dryRun) {
            const message = '画好了，但未确认图片已发到 QQ。'
            return { ok: false, message, summary: message, deliveryFailed: true }
          }
          const saved = savePainting(buf, String(prompt || ''))
          if (saved) api.log.debug(`生图已存盘：${saved}`)
          try {
            if (sent && !sent.queued && !sent.simulated) api.mind?.experience?.({ chatId: chat.chatId, about: chat.kind === 'private' ? chat.userId : '', text: reference ? `参考了一张图画了：${String(prompt).slice(0, 120)}（提示词不一定等于实际画面）` : `按提示词画了一张图（不一定等于实际画面）：${String(prompt).slice(0, 120)}`, tags: ['画画'], importance: 0.4 })
          }
          catch (error) { api.log.warn('生图已发送，但经历没记下来：', error.message) }
          if (task) {
            if (saved) rememberPainting(chat.chatId, saved)
            return { ok: Boolean(sent && !sent.queued && !sent.simulated), simulated: dryRun }
          }
          let visual = (await hub.canSeeImages(chat)) === true
          // 「让她画完自己看一眼」是总开关：关掉就当没视觉能力处理 —— 不给图、也不给路径。
          const seeOwn = api.config().imageGen.seeOwn !== false
          // 只有明确能看图的模型才把图交给它；纯文本模型只拿文字，不会崩。
          // 图要先缩、再登记成 DSH 附件块 —— 直接塞 base64 会让下一轮请求整轮失败（实测）
          let img = null
          if (visual && seeOwn) {
            img = await imageToolBlock(api.dsh, buf, { ffmpegPath: api.config().local?.ffmpegPath })
            if (!img) {
              // 图没给成：如实说看不了，别让她照着提示词编画面细节
              visual = false
              api.log.debug('这次生图没把图交给模型（缩图/登记失败），只给文字')
            }
          }
          const shown = Boolean(img)
          let message
          if (!visual) message = drawToolMessage({ visual: false })
          else if (!seeOwn) message = drawToolMessage({ visual: true, seeOwn: false })
          else if (!shown) message = drawToolMessage({ visual: false })
          else message = drawToolMessage({ visual: true, seeOwn: true })
          if (dryRun) message = saved ? '试运行已生成图片并存入画作库，未发送到聊天。' : '试运行已生成图片，保存失败，未发送到聊天。'
          else if (sent?.queued) message = '画好了，图片正在排队发送。' + (!shown ? '你还没看到图，别描述画面。' : '')
          // 画作编号：换头像 / 收表情时用编号，别用路径（路径只在图真的交出去时才附带）
          const index = saved ? rememberPainting(chat.chatId, saved) : 0
          const out = {
            ok: true,
            message,
            prompt: String(prompt || ''),
            bytes: buf.length,
            elapsedMs: Date.now() - startedAt,
            ...(saved ? { path: saved } : {}),
          }
          if (img) out.image = img
          if (index && saved) out.message += `\n画作编号 #${index}（想换头像、收成表情时用这个编号）`
          // 只有**图真的交给模型了**才把本地路径告诉她（#59）：收录表情包 / 存素材 / qq_add_sticker 用；
          // 看不了图或开关关着时不给路径，免得她知道路径就去读图，绕开「不给看」的判断。
          if (shown && saved) out.message += `\n已保存到本机：${saved}（要收录表情包、存素材时可以用这个路径）`
          return out
        }
        const run = async (task) => {
          const current = () => !closed() && allowed() && api.config().enabled !== false && task?.isCurrent()
          let result
          try { result = await draw(task) }
          catch (error) {
            const detail = error?.safeDetail || '生图服务未能完成这张图。'
            if (current()) await hub.sendText(chat.chatId, detail).catch(() => {})
            return { ok: false, message: detail, detail }
          }
          if (current() && result.deliveryFailed) await hub.sendText(chat.chatId, result.message).catch(() => {})
          return result
        }
        if (background === false || !api.core.tasks || api.config().debug) return run()
        const scheduled = api.core.tasks.start({
          kind: '生图', chatId: chat.chatId, requesters: api.core.taskRequesters?.({ chat, sessionId }) || [], run,
        })
        return scheduled.ok ? { ...scheduled, message: '图片已排队，画好会发到当前聊天。请用你自己的话回应。' } : scheduled
      },
    }) : []))
    return gen
  },
}
