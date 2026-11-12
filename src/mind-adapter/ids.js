import { LEGACY_PLATFORM, normChat, parseChat, parsePerson, personIdOf } from '../channels/ids.js'

export { normChat as windowOf, normPerson as personOf } from '../channels/ids.js'

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
