// 平台消息里的格式标签：QQ 小黄脸、表情包、戳一戳。收发核心只处理标签语义，
// 具体怎么渲染成某个平台的段由适配器决定。
const FACE_TAG = /<face:\s*([^>]{1,12}?)\s*>(?:\s*<\/face>)?|[\[［【]表情[ \t]*[:：][ \t]*([^\]］】\r\n]{1,12}?)[ \t]*[\]］】]/g
export const faceTagName = (match) => (match[1] ?? match[2]).trim()

/** 去掉系统表情标签（平台关闭小黄脸时用）。 */
export const stripFaceTags = (text) => String(text ?? '').replace(FACE_TAG, '').replace(/[ \t]{2,}/g, ' ').trim()

const tidySpeech = (s) => String(s).replace(/<\/?voice>/g, '').replace(/[ \t]{2,}/g, ' ').trim()

/** 把一条语音拆成「要念的」和「只剩表情/符号的」两半。 */
export function splitSpeakable (text) {
  const raw = String(text ?? '')
  const others = /<sticker:[^>]*>(?:\s*<\/sticker>)?|<poke\s*\/?>|[#*0-9]\uFE0F?\u20E3|[\p{Extended_Pictographic}\p{Regional_Indicator}\u200D\uFE0F\u20E3\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u
  const re = new RegExp(`${FACE_TAG.source}|${others.source}`, 'gu')
  let spoken = ''
  let extras = ''
  let last = 0
  for (const m of raw.matchAll(re)) {
    spoken += raw.slice(last, m.index)
    if (m[1] !== undefined || m[2] !== undefined) extras += `<face:${faceTagName(m)}>`
    else if (!m[0].startsWith('<')) extras += m[0]
    last = m.index + m[0].length
  }
  spoken += raw.slice(last)
  return { spoken: tidySpeech(spoken), extras: tidySpeech(extras) }
}

export function speakableText (text) {
  return splitSpeakable(text).spoken
}

export { FACE_TAG }
