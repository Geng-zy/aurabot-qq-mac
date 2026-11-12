// 把一条 OneBot v11 消息事件拆成壳要的通用形状。纯函数。

/** 消息段数组（兼容字符串 CQ 码：只取纯文字）。 */
export function segmentsOf(event) {
  const m = event && event.message
  if (Array.isArray(m)) return m.filter((s) => s && typeof s === 'object')
  if (typeof m === 'string') return [{ type: 'text', data: { text: m.replace(/\[CQ:[^\]]*\]/g, '') } }]
  return []
}

/** 这个段是不是「表情包」（不是普通照片）。判定必须严格。 */
export function isStickerSegment(seg) {
  if (!seg || !seg.data) return false
  if (seg.type === 'mface') return true
  if (seg.type !== 'image') return false
  const d = seg.data
  const sub = String(d.sub_type ?? d.subType ?? '')
  if (sub === '1') return true
  // 带文字说明的表情（比如「[啊？]」）是 sub_type 7；只认有说明的，普通图片的说明是「[图片]」
  if (sub === '7' && d.summary && d.summary !== '[图片]') return true
  if (d.emoji_id || d.emojiId) return true
  return false
}

/**
 * @param {object} event OneBot 消息事件
 * @param {string|number} selfId 机器人 QQ
 * @returns {{
 *   kind: 'private'|'group', chatId: string, userId: string, groupId: string, sourceGroupId: string,
 *   nickname: string, role: string, messageId: string, text: string,
 *   mentioned: boolean, wakeText: string, replyId: string, images: object[], stickers: object[], records: object[], files: object[],
 * }}
 */
export function parseMessageEvent(event, selfId, { faceName } = {}) {
  const self = String(selfId || event.self_id || '')
  const kind = event.message_type === 'group' ? 'group' : 'private'
  const userId = String(event.user_id ?? event.sender?.user_id ?? '')
  const groupId = kind === 'group' ? String(event.group_id ?? '') : ''
  const sender = event.sender || {}
  const sourceGroupId = kind === 'private' && event.sub_type === 'group' && /^\d+$/.test(String(sender.group_id ?? '')) && Number(sender.group_id) > 0 ? String(sender.group_id) : ''
  let mentioned = false
  let atOthers = false // 这一条 @ 了别人（既不是她，也不是全体）
  let replyId = ''
  const texts = []
  const atAllIndexes = new Set()
  const images = []
  const stickers = []
  const records = []
  const forwards = [] // 合并转发的 id
  const files = []
  for (const seg of segmentsOf(event)) {
    const d = seg.data || {}
    switch (seg.type) {
      case 'text':
        texts.push(String(d.text ?? ''))
        break
      case 'at':
        if (String(d.qq) === 'all') { atAllIndexes.add(texts.length); texts.push('@全体成员 ') }
        else if (self && String(d.qq) === self) mentioned = true
        else {
          atOthers = true
          texts.push(`@${d.name || d.qq} `)
        }
        break
      case 'reply':
        replyId = String(d.id ?? '')
        break
      case 'face': {
        // QQ 系统表情按名字给她看（「[捂脸]」），认不出才写「[表情]」
        const name = faceName?.(d.id)
        const label = String(d.id) === '358' ? '骰子' : String(d.id) === '359' ? '猜拳' : name || String(d.raw?.faceText || '').replace(/^\[|\]$/g, '') || '表情'
        texts.push(d.resultId !== undefined && d.resultId !== null && String(d.resultId) !== '' ? `[${label}：${String(d.resultId)}]` : name ? `[${name}]` : d.raw?.faceText || '[表情]')
        break
      }
      case 'image':
      case 'mface':
        if (isStickerSegment(seg)) {
          stickers.push(seg)
          texts.push(d.summary ? `${d.summary}` : '[表情包]')
        } else {
          images.push(seg)
          texts.push('[图片]')
        }
        break
      case 'record':
        records.push(seg)
        break
      case 'video':
        texts.push('[视频]')
        break
      case 'file':
        texts.push(`[文件 ${d.name || d.file || ''}]`)
        files.push({ name: String(d.name || d.file || ''), size: Number(d.size ?? d.file_size) || 0, id: String(d.id ?? d.file_id ?? ''), url: String(d.url || ''), hash: String(d.file_hash || ''), busid: Number(d.busid) || 0 })
        break
      case 'flash_file':
        texts.push(d.title ? `[闪传文件：${String(d.title)}]` : '[闪传文件]')
        break
      case 'json':
        texts.push(cardText(d.data))
        break
      case 'xml':
        texts.push('[卡片消息]')
        break
      case 'poke':
        texts.push('[戳一戳]')
        break
      case 'forward': {
        // 合并转发：先放个占位，收到后再去拉里面的聊天记录展开
        const id = String(d.id ?? d.res_id ?? d.forward_id ?? '')
        if (id) forwards.push(id)
        texts.push('[合并转发]')
        break
      }
      default:
        break
    }
  }
  const text = texts.join('').replace(/\s+\n/g, '\n').trim()
  const wakeText = atAllIndexes.size ? texts.filter((_t, i) => !atAllIndexes.has(i)).join('').replace(/\s+\n/g, '\n').trim() : text
  return {
    platform: 'qq',
    kind,
    chatId: kind === 'group' ? `group:${groupId}` : `private:${userId}`,
    userId,
    groupId,
    sourceGroupId,
    nickname: String(sender.card || sender.nickname || userId),
    role: String(sender.role || ''),
    messageId: String(event.message_id ?? ''),
    text,
    wakeText,
    mentioned,
    atOthers,
    replyId,
    images,
    stickers,
    records,
    forwards,
    files,
    subType: String(event.sub_type || ''),
    selfId: self,
    segments: segmentsOf(event),
    raw: event,
  }
}

/** QQ 链接分享卡片里认出标题和链接；认不出就是「[卡片消息]」。 */
export function cardText(raw) {
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw
    const meta = j?.meta || {}
    if (j?.app === 'com.tencent.map' && meta.Location) {
      const parts = [meta.Location.title, meta.Location.address].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
      return `[位置${parts.length ? '：' + parts.join(' ') : ''}]`
    }
    if (j?.app === 'com.tencent.contact.lua' && meta.contact) {
      const id = meta.contact.id
      return `[联系人${id !== undefined && id !== null && String(id).trim() ? '：' + String(id).trim() : ''}]`
    }
    const m = meta.detail_1 || meta.news || meta.music || Object.values(meta)[0] || {}
    const title = String(m.desc || m.title || j.prompt || '').trim()
    const url = String(m.qqdocurl || m.jumpUrl || m.url || '').split('?')[0]
    const from = String(m.title && m.desc ? m.title : m.tag || '').trim()
    if (!title && !url) return '[卡片消息]'
    return `[分享卡片${from ? '（' + from + '）' : ''}：${title}${url ? ' ' + url : ''}]`
  } catch (error) {
    return '[卡片消息]'
  }
}
