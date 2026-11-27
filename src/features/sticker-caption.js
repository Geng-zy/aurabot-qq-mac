// 表情的「视觉起名」：让能看图的模型给表情写备注与标签，支持整库补名字（可取消、可看进度）。
// 从 features/stickers.js 抽出来：那边是采集与收藏（去重、限额、同步 QQ 收藏），
// 这边只跟「看图模型 + 库文件」打交道，任务状态（job/进度/取消）也归这里。
//
// 依赖全部注入：dsh / getConfig / log / canSeeImages / askModel / loadLibrary / saveLibrary /
// stickerDir / mimeOf / readFileSync / existsSync / join / modifyCustomFace / DEFAULT_TAGS。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mimeOf } from '../core/image-info.js'

export function createStickerCaption({ dsh, getConfig, log, canSeeImages, askModel, loadLibrary, saveLibrary, stickerDir, modifyCustomFace, DEFAULT_TAGS }) {
  let captionJob = null
  let disposed = false
  const dir = () => stickerDir()

  function captionModelOf(cfg = getConfig()) {
    const m = cfg && cfg.stickers && cfg.stickers.captionModel
    return m && m.provider && m.model ? { provider: m.provider, model: m.model } : null
  }

  async function caption(buf, mime, hint) {
    try {
      const cfg = getConfig()
      const target = captionModelOf(cfg)
      // 模型看不了图就别硬发：会报错，名字也起不出来
      if ((await canSeeImages(dsh, cfg, target)) === false) {
        log.debug('模型不支持看图，跳过表情起名')
        return { name: '', tags: [], noVision: true }
      }
      const ask = (extra = {}) => askModel(dsh, {
        module: 'stickers',
        cfg,
        ...(target ? { model: target } : {}),
        system: '你给表情包起名字。只输出一行：不超过 12 个字的中文备注，描述这个表情表达的情绪或内容（例如「委屈巴巴的小猫」「得意地叉腰」）。然后空格，再写 1~3 个标签，从这些里挑：' + DEFAULT_TAGS.join('、') + '。格式：备注 #标签1 #标签2',
        text: hint ? `QQ 给的描述是「${hint}」。请看图起名。` : '请看图起名。',
        images: [{ data: buf.toString('base64'), mediaType: mime }],
        // ⚠ 别给太小：模型会先思考，120 这种上限会被思考吃光，正文是空的（实测踩过）
        maxTokens: 1000,
        temperature: 0.2,
        ...extra,
      })
      let text = await ask()
      // 推理模型的思考有时会把预算吃光，正文空着回来（和记忆提炼同一类毛病）：这次先关思考（模型支持的话），
      // 再把预算放大；光放大预算、思考关不掉的话照样吃光。
      if (!text) {
        log.warn('看图起名：模型没给出文字，关掉思考、放大 token 预算重试一次')
        text = await ask({ reasoningEffort: 'off', maxTokens: 2500, temperature: 0.1 })
      }
      if (!text) log.warn('看图起名：重试后仍然没有文字')
      const line = text.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || ''
      const tags = [...line.matchAll(/#\s*([^\s#]+)/g)].map((m) => m[1]).filter((t) => t.length <= 6).slice(0, 3)
      const name = line.replace(/#\s*[^\s#]+/g, '').replace(/[「」"'“”]/g, '').trim().slice(0, 12)
      return { name, tags }
    } catch (error) {
      log.warn('看图起名失败：', error.message)
      return { name: '', tags: [] }
    }
  }

  function captionStatus() {
    const t = captionModelOf(getConfig())
    const model = t ? t.provider + '/' + t.model : ''
    if (!captionJob) return { running: false, total: 0, done: 0, ok: 0, failed: 0, skipped: 0, message: '', model }
    return {
      running: captionJob.running, total: captionJob.total, done: captionJob.done,
      ok: captionJob.ok, failed: captionJob.failed, skipped: captionJob.skipped,
      startedAt: captionJob.startedAt, current: captionJob.current, last: captionJob.last,
      canceled: Boolean(captionJob.cancel), message: captionJob.message, model,
    }
  }

  function captionCancel() {
    if (!captionJob || !captionJob.running) return { running: false, message: '没有在跑的任务' }
    captionJob.cancel = true
    return { running: true, message: '这一张跑完就停' }
  }

  /** 模块卸载 / 重载：叫停后台任务（循环里每张之前也会看 cancel）。 */
  function dispose() {
    disposed = true
    if (captionJob && captionJob.running) {
      captionJob.cancel = true
      captionJob.message = '模块重载，这一轮先停了'
      log.info('表情库批量起名：模块卸载，停止后台任务')
    }
  }

  /** 哪些要补：默认只补名字或标签空着的（文件丢了的跳过）；all = 全库重做。 */
  function captionTargets({ all = false } = {}) {
    const items = loadLibrary().items.filter((i) => existsSync(join(dir(), i.file)))
    return all ? items : items.filter((i) => !String(i.name || '').trim() || !(i.tags || []).length)
  }

  /** 开始批量起名：立刻返回，真正干活在后台。 */
  async function captionLibrary({ all = false, limit = 0 } = {}) {
    if (disposed) return { ok: false, message: '模块重载了，重新打开面板再试' }
    if (captionJob && captionJob.running) return { ok: false, message: '上一轮还在跑，等它跑完（或者点「停」）', status: captionStatus() }
    const target = captionModelOf(getConfig())
    if ((await canSeeImages(dsh, getConfig(), target)) === false) {
      return {
        ok: false,
        message: target
          ? '「起名用的模型」' + target.provider + '/' + target.model + ' 看不了图，起不了名字：换一个能看图的模型，或者把它清空、改用聊天模型'
          : '当前模型看不了图，起不了名字：面板「模型」里把「视觉能力」改成「支持」，或者换一个能看图的模型',
      }
    }
    let queue = captionTargets({ all })
    const cap = Math.max(0, Number(limit) || 0)
    if (cap) queue = queue.slice(0, cap)
    if (!queue.length) return { ok: true, total: 0, message: all ? '表情库里还没有表情' : '每张都有名字和标签了（想全部重做就勾「全部重做」）' }
    const job = { running: true, total: queue.length, done: 0, ok: 0, failed: 0, skipped: 0, startedAt: Date.now(), current: '', last: '', cancel: false, all, message: '' }
    captionJob = job
    log.info(`开始给 ${queue.length} 张表情补名字（${all ? '全部重做' : '只补空缺'}${target ? '，模型 ' + target.provider + '/' + target.model : ''}）`)
    ;(async () => {
      let streak = 0 // 连续失败几张就收手，别在额度用光 / 网络断了的时候还一路烧下去
      for (const want of queue) {
        if (job.cancel) break
        if (streak >= 5) { job.message = `连续失败 ${streak} 张，先停了（模型或网络有问题）`; break }
        // 一张一张来，别一瞬间把模型打满
        await new Promise((r) => setTimeout(r, 350))
        if (job.cancel) break
        // 每张都读一遍最新的库：跑到一半用户改过名字、或者删了这张，就跳过
        const it = loadLibrary().items.find((i) => i.md5 === want.md5)
        if (!it || (!all && String(it.name || '').trim() && (it.tags || []).length)) { job.skipped++; job.done++; continue }
        job.current = it.name || it.md5.slice(0, 8)
        let buf
        try { buf = readFileSync(join(dir(), it.file)) } catch { job.failed++; job.done++ }
        if (!buf) continue
        const { name, tags, noVision } = await caption(buf, mimeOf(buf), it.summary || '')
        if (!name) {
          job.failed++
          job.done++
          // 跑到一半模型换成看不了图的（或者元数据变了）：再跑下去只会一路失败，直接收手
          if (noVision) { job.message = '模型看不了图，先停了：换一个能看图的模型再试'; break }
          streak++
          continue
        }
        streak = 0
        const l = loadLibrary()
        const cur = l.items.find((i) => i.md5 === it.md5)
        if (!cur) { job.skipped++; job.done++; continue }
        cur.name = name
        if (tags.length) cur.tags = tags
        saveLibrary(l)
        if (cur.emojiId && !getConfig().dryRun) {
          try { await modifyCustomFace(cur.emojiId, cur.name.slice(0, 20)) } catch (error) { log.warn('写回 QQ 备注失败：', error.message) }
        }
        job.ok++
        job.last = cur.name
        job.done++
      }
      job.running = false
      job.current = ''
      if (!job.message) job.message = (job.cancel ? '停下来了：这轮' : '整理完了：') + `起了 ${job.ok} 张名字，跳过 ${job.skipped} 张，失败 ${job.failed} 张`
      log.info(job.message)
    })().catch((error) => {
      job.running = false
      job.message = '出错了：' + error.message
      log.warn('批量起名出错：', error.message)
    })
    return { ok: true, total: queue.length, started: true, status: captionStatus(), message: `开始给 ${queue.length} 张表情起名字（后台跑，可以关掉面板）` }
  }


  /** 模块卸载 / 重载：清掉任务状态（后台循环每张之前也会看 cancel）。 */
  function shutdown() {
    disposed = true
    if (captionJob && captionJob.running) {
      captionJob.cancel = true
      captionJob.message = '模块重载，这一轮先停了'
      log.info('表情库批量起名：模块卸载，停止后台任务')
    }
  }

  return { caption, captionModelOf, status: captionStatus, cancel: captionCancel, targets: captionTargets, run: captionLibrary, shutdown }
}
