// 内置模块：翻唱。点歌 → 网易云下载 → 分离人声 → RVC 换成她的音色 → 混音 → 发语音条。
// 换声这一步可以在「本地接口」里接你自己的推理（so-vits-svc、自己训练的 RVC……）；整个模块也可以替换掉。

import { createSongStudio, checkRoot } from '../../song/studio.js'
import { defineTool, str, int, bool } from '../../tools/tools.js'
import { ownerOrFree } from '../../chat/access.js'
import { normPerson, parseChat, refOfChat } from '../../channels/ids.js'

export default {
  id: 'song',
  name: '翻唱',
  version: '1.0.0',
  description: '用她的声音翻唱一首歌，做好发语音条（qq_song_cover、/sing）',
  tab: 'song',
  files: ['song/studio.js'],
  setup(api) {
    const { hub, local, http } = api.core
    let closed = false
    api.onDispose?.(() => { closed = true })
    const song = createSongStudio({
      local,
      getConfig: api.config,
      log: api.log,
      sendVoiceFile: (chatId, file, note, opts) => hub.sendVoiceFile(chatId, file, note, opts),
      sendText: (chatId, text) => hub.sendText(chatId, text),
      // 翻唱失败那句话不写死：把歌名和真实原因给她，在那个聊天里用她自己的话说（参考原项目 6ac8693）。
      // 聊天空着就交给那个聊天的会话；正忙就单独组织一句；念了内部信息的句子不发。都不成由 studio 发一句兜底短话。
      say: async ({ chatId, title, why }) => {
        const voice = api.core.herVoice
        if (!voice) throw new Error('没有接上她的说话通道')
        const r = await voice.tell({ chatId, facts: failFacts(title, why), clean: cleanFailLine })
        if (!r) throw new Error('她没说出来')
      },
      onSung: (title, chatId) => {
        const cfg = api.config()
        // 唱过的歌记成她的经历：私聊记到对方头上
        const target = parseChat(chatId)
        const who = target?.kind === 'private' ? (refOfChat(chatId) === normPerson(cfg.ownerQQ) ? cfg.ownerName || '主人' : '对方') : '群里'
        api.mind?.experience?.({ text: `给${who}唱了《${title}》`, chatId, tags: ['唱歌'], importance: 0.5, effort: 0.05, emotion: { name: '满足', intensity: 0.4 } })
        api.emit('song/sung', { title, chatId })
      },
    })
    function requestTask(options, requesters) {
      if (!api.core.tasks || api.config().debug) return song.request(options)
      if (!api.config().song.enabled) return { ok: false, message: '翻唱还没打开' }
      const status = song.status()
      if (!status.ready) return { ok: false, message: '翻唱环境还没装好：' + status.message }
      if (hub.containsProtectedText?.(options.chatId, options.song)) return { ok: false, message: '点歌内容含私密信息' }
      return api.core.tasks.start({
        kind: '翻唱', chatId: options.chatId, requesters,
        run: async (task) => {
          const checkpoint = (stage) => {
            if (closed) throw new Error('翻唱模块已关闭')
            task.checkpoint(stage)
          }
          checkpoint('等待翻唱')
          const result = await song.requestAutonomous({ ...options, checkpoint, progress: checkpoint, delivery: { ...task, isCurrent: () => !closed && task.isCurrent() } })
          if (!result.ok && !result.simulated && !closed && task.isCurrent()) await hub.sendText(options.chatId, '这首歌没唱成，可以问我当前进度。')
          return result
        },
      })
    }

    api.mind?.offer?.({
      id: 'own-song', label: '翻唱一首自己想唱的歌', needs: { beauty: 0.55, competence: 0.5, companion: 0.3 },
      effort: 0.55, cooldownMinutes: 720, keywords: ['想唱', '唱歌', '唱一首'],
      available: () => Boolean(api.config().song.enabled && api.mind.creativeTarget('song') && song.status().ready),
      async run({ checkpoint, wants }) {
        const chatId = api.mind.creativeTarget('song')
        if (!chatId) return { ok: false }
        const title = await api.mind.creativeIdea('song', wants)
        if (!title) return { ok: false }
        return await song.requestAutonomous({ song: title, chatId, checkpoint: async () => {
          await checkpoint()
          if (api.mind.creativeTarget('song', { continuing: true }) !== chatId) throw new Error('主动翻唱已暂停')
        } })
      },
    })

    // 面板里打开了才给她（没开就别让她答应唱歌）
    api.tool(({ chat, sessionId }) => (api.config().song.enabled && chat.kind !== 'system' ? defineTool({
      name: 'qq_song_cover',
      description: '用你自己的声音翻唱一首歌，做好后自动以语音条发到当前聊天（要两三分钟，调用后先简单回一句「等我一下」就好）。song 照点歌的人原话写：只说了歌名就只写歌名（会用网易云搜索结果的第一首），说了歌手或版本（比如「小幸运 田馥甄」「Live 版」）才带上，不要自己猜着加歌手。pitch 是变调半音：你是女声，原唱是男声时一般 +12，原唱是女声时 0。别人说清唱、不要伴奏时 acapella 填 true。点歌的人明确说了「对唱」「男女对唱」时 duet 填 true（本地换声脚本会先把男声、女声分开各自唱，换人处不破音，多花两三分钟）；没说就别填。',
      properties: { song: str('歌名；对方说了歌手 / 版本才带上，别自己加'), pitch: int('变调半音：原唱男声 +12，女声 0'), acapella: bool('清唱：只留人声，不要伴奏'), duet: bool('男女对唱：点歌的人说了「对唱」「男女对唱」才填 true') },
      required: ['song'],
      slow: '好，我这就去弄，稍等一会儿（做好了发你）。',
      execute: async ({ song: name, pitch, acapella, duet }) => {
        if (api.config().song.ownerOnly && !ownerOrFree(api.config(), hub.turnSendersAllOwner(sessionId))) return { ok: false, message: '只有主人能点歌' }
        return requestTask({ song: name, pitch, acapella, duet, chatId: chat.chatId }, api.core.taskRequesters?.({ chat, sessionId }) || [])
      },
    }) : []))

    api.route('/song/status', async () => ({ ok: true, ...song.status() }))
    api.route('/song/install', async () => song.install())
    api.route('/song/root/check', async (req) => ({ ok: true, ...checkRoot(http.query(req).path || '') }))
    api.route('/song/search', async (req) => {
      try { return { ok: true, list: await song.search(http.query(req).q || '') } } catch (error) { return { ok: false, message: error.message, list: [] } }
    })
    api.route('/song/account', async () => song.account())
    // 导入音色：面板把文件原样传上来（.zip / .pth / .index），文件名放在 ?name= 里
    api.route('/song/import', async (req) => {
      const name = http.query(req).name || ''
      try {
        const buf = await http.raw(req, 1024 * 1024 * 1024)
        if (!buf.length) return { ok: false, message: '文件是空的' }
        const r = song.importModels(name, buf)
        if (r.ok) api.log.info('导入音色：' + r.message)
        return r
      } catch (error) {
        return { ok: false, message: '导入失败：' + error.message }
      }
    })
    api.route('/song/voice/delete', async (req) => song.deleteVoice(String((await http.body(req)).id || '')))
    api.route('/song/voice/profile', async (req) => { const b = await http.body(req); return song.buildProfile(String(b.id || ''), String(b.folder || '')) })
    // 面板里试唱：发到主人私聊
    api.route('/song/request', async (req) => {
      const b = await http.body(req)
      return requestTask({ song: b.song, songId: b.songId, pitch: b.pitch, voice: b.voice, chatId: b.chatId || `private:${api.config().ownerQQ}` }, [String(api.config().ownerQQ)])
    })
    return { ...song, requestTask }
  },
}

// 翻唱失败时给她看的事：歌名 + 真实原因（标明是内部信息），要她自己说一句。
// 原因写进来是让她知道「为什么没成」，不是让她复述——所以明说不许念技术细节。
export function failFacts(title, why) {
  return [
    `有人点了一首《${title}》，但这次没唱成。`,
    `内部原因（只给你看，不要念出来，也不要提技术细节、额度、报错原文）：${why || '没说清'}`,
    '口语一句就好，别用客服腔；可以说得含糊、撒个娇、说回头再试，别编具体的技术理由，不要出现路径、英文报错、错误码、额度数字。',
  ].join('\n')
}

const SILENT = /^[\[【(（]\s*沉默\s*[\]】)）]$/
// 模型万一把内部信息念出来了（报错原文、路径、额度），这句就不能发，交给兜底
const LEAK = /error|enoent|traceback|http:\/\/|https:\/\/|api[ _-]?key|token|额度|字节|\d+\s*(?:mb|gb)\b/i

/** 把她那一轮说的话洗成一句能直接发出去的：去引号/前缀/多余行，[沉默] 或念了内部信息就当没说话。 */
export function cleanFailLine(text) {
  const first = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s>*#-]+/, '').trim())
    .find(Boolean) || ''
  if (!first || SILENT.test(first)) return ''
  const line = first
    .replace(/^[^\s：:，,。]{1,6}\s*[：:]\s*/, '') // 「名字：」这种前缀
    .replace(/^[「"'“”『』]+|[」"'“”『』]+$/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!line || SILENT.test(line) || LEAK.test(line)) return ''
  if (line.length <= 60) return line
  // 太长就截到第一个句末；实在没有句末就硬截
  const cut = line.search(/[。！？!?~～]/)
  return cut >= 4 ? line.slice(0, cut + 1) : line.slice(0, 60)
}
