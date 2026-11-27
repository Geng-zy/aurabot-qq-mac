// 会话与人的身份换算：把来源会话里的裸账号解释成带平台的人，以及 QQ 旧会话 ID 的投递键。
// 从 mind-adapter/index.js 抽出来：那边是心智装配（模型、记忆、工具、内心），
// 这两个函数只跟 channels/ids 的约定有关，单独放着更好读，也能单独测。

import { LEGACY_PLATFORM, normChat, parseChat, parsePerson, personIdOf } from '../channels/ids.js'

/** 用来源会话解释裸账号，带渠道的引用须与来源一致。 */
export function personIn(chatId, userId) {
  const platform = parseChat(chatId)?.platform
  const person = parsePerson(userId, platform)
  if (!person || (platform && person.platform !== platform)) return ''
  return personIdOf(person.platform, person.id)
}

/** QQ 的壳仍有以旧会话 ID 为键的会话、静默和投递状态。 */
export function deliveryChat(chatId) {
  const target = parseChat(chatId)
  return target?.platform === LEGACY_PLATFORM ? `${target.kind}:${target.id}` : normChat(chatId)
}
