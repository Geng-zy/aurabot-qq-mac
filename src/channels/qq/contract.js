// QQ 平台契约：平台 id、能力、chatId 解析。不包含连接或业务。
import { chatIdOf, parseChat } from '../ids.js'

export const PLATFORM = 'qq'

export const QQ_CAPS = Object.freeze({
  faces: true, stickers: true, voice: true, files: true, recall: true, poke: true, react: true, typing: true,
  history: true, forward: true, card: true, friendRequests: true, groupRequests: true, profile: true, groupAdmin: true,
})

/** 'qq:group:456' → { kind:'group', id:'456' }；别的平台、认不出返回 null。 */
export function qqTarget(chatId) {
  const p = parseChat(chatId)
  return p && p.platform === PLATFORM ? { kind: p.kind, id: p.id } : null
}

export const qqChat = (kind, id) => chatIdOf(PLATFORM, kind, String(id))
