// hub 里那些「不依赖任何会话状态」的小工具。
//
// 从 chat/hub.js 搬出来的第一块：它们只做数据整形，不碰 Map、不碰网络、不读配置，
// 所以可以单独测。hub 仍然是 1400 多行的组合根，后续切片会继续往这里搬纯函数。

/** 图片块前那条「下一张图的来源」标记的前缀（群聊里用来标明图是谁发的）。 */
export const IMAGE_SOURCE_PREFIX = '【下一张图的来源】'

/**
 * 去掉内容里的图片块，只留下 `keep` 那一张。
 * 只保留「属于这张图」的来源标记：标记后面跟着的不是这张图，就一起删掉，
 * 否则模型会以为自己手里有张图。
 */
export function withoutImageBlocks(content, keep) {
  return content.filter((part, i) => {
    if (part.type === 'image') return part === keep
    if (part.type !== 'text' || !part.text.startsWith(IMAGE_SOURCE_PREFIX)) return true
    const next = content[i + 1]
    return next?.type !== 'image' || next === keep
  })
}

/** 模型身份键：provider/model/推理档位，用来判断「换模型了没有」。 */
export const keyOf = (t) => (t ? `${t.provider}::${t.model}::${t.reasoningEffort || ''}` : '')

/**
 * 把网关的历史消息压成「谁：说了什么」。
 * 单条截断 120 字并合并空白——历史只用来接上下文，不需要原文。
 */
export function flatHistory(list, allowSender) {
  const out = []
  for (const m of Array.isArray(list) ? list : []) {
    const senderId = String(m?.sender?.user_id ?? m?.user_id ?? '')
    if (!allowSender(senderId)) continue
    const who = m?.sender?.card || m?.sender?.nickname || m?.nickname || senderId
    let text = ''
    const seg = m?.message ?? m?.raw_message ?? ''
    if (typeof seg === 'string') text = seg
    else if (Array.isArray(seg)) text = seg.map((s) => (s?.type === 'text' ? (s.data?.text || '') : s?.type === 'image' ? '[图片]' : s?.type === 'face' ? '[表情]' : '')).join('')
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!who && !text) continue
    out.push(`${who}：${text}`)
  }
  return out
}
