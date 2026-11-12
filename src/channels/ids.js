// 聊天和人的 id：全程带平台，不同平台的号不会撞。和心智核心（src/mind/place.js）是同一个约定。
//   聊天：「平台:private:对方」「平台:group:群」，例如 qq:private:123、qq:group:456、feishu:group:oc_xx
//   人：  「平台:账号」，例如 qq:123
//   后台：「system:名字」（她自己想事情用的会话，不属于任何平台，发不了消息）
// 旧写法（private:123、group:456、光一个 123）一律当 QQ：老配置、老聊天流水、老模块都还能用。
// 纯函数，不 import 任何东西。

/** 没写平台的旧 id 算哪个平台。 */
export const LEGACY_PLATFORM = 'qq'

const PLATFORM_RE = /^[a-z][a-z0-9_-]{0,31}$/
const KINDS = ['private', 'group']

const clean = (v) => String(v ?? '').trim()

/**
 * 认一个聊天 id。认得出返回 { platform, kind, id }，认不出（system:xx、空、乱写）返回 null。
 * 冒号后带空格也认（面板里手写的「private: 123」）。
 */
export function parseChat(chatId) {
  const s = clean(chatId)
  if (!s) return null
  const parts = s.split(':').map((p) => p.trim())
  if (parts.length >= 3 && PLATFORM_RE.test(parts[0]) && KINDS.includes(parts[1])) {
    const id = parts.slice(2).join(':')
    return id ? { platform: parts[0], kind: parts[1], id } : null
  }
  if (parts.length >= 2 && KINDS.includes(parts[0])) {
    const id = parts.slice(1).join(':')
    return id ? { platform: LEGACY_PLATFORM, kind: parts[0], id } : null
  }
  return null
}

/** 拼一个聊天 id。 */
export const chatIdOf = (platform, kind, id) => `${platform}:${kind}:${id}`

/** 统一成新写法；认不出的（system:xx）原样返回。 */
export function normChat(chatId) {
  const p = parseChat(chatId)
  return p ? chatIdOf(p.platform, p.kind, p.id) : clean(chatId)
}

/** 这个聊天在哪个平台；认不出返回 ''。 */
export const platformOf = (chatId) => parseChat(chatId)?.platform || ''
export const isGroupChat = (chatId) => parseChat(chatId)?.kind === 'group'
export const isPrivateChat = (chatId) => parseChat(chatId)?.kind === 'private'
/** 聊天对面的号（私聊是人，群是群号），不带平台。 */
export const chatTarget = (chatId) => parseChat(chatId)?.id || ''
/** 两个写法是不是同一个聊天。 */
export const sameChat = (a, b) => { const x = normChat(a); return Boolean(x) && x === normChat(b) }

/**
 * 认一个人（或群）的 id：「平台:账号」。光一个账号算旧写法（QQ）。
 * 第二个参数给了平台时，没带平台的账号算那个平台。
 */
export function parsePerson(ref, platform = LEGACY_PLATFORM) {
  const s = clean(ref)
  if (!s) return null
  const i = s.indexOf(':')
  if (i > 0 && PLATFORM_RE.test(s.slice(0, i))) {
    const id = s.slice(i + 1).trim()
    return id ? { platform: s.slice(0, i), id } : null
  }
  return { platform: platform || LEGACY_PLATFORM, id: s }
}

export const personIdOf = (platform, id) => `${platform}:${id}`

/** 统一成「平台:账号」；空的返回 ''。 */
export function normPerson(ref, platform) {
  const p = parsePerson(ref, platform)
  return p ? personIdOf(p.platform, p.id) : ''
}

/** 人 → 和他的私聊。 */
export function privateChatOf(person, platform) {
  const p = parsePerson(person, platform)
  return p ? chatIdOf(p.platform, 'private', p.id) : ''
}

/** 群（「平台:群号」或聊天 id）→ 群聊。 */
export function groupChatOf(group, platform) {
  const c = parseChat(group)
  if (c) return c.kind === 'group' ? chatIdOf(c.platform, 'group', c.id) : ''
  const p = parsePerson(group, platform)
  return p ? chatIdOf(p.platform, 'group', p.id) : ''
}

/** 聊天 → 这个聊天的「对象」：私聊是人（qq:123），群是群（qq:456）。白名单、按聊天的设置都用这个当键。 */
export function refOfChat(chatId) {
  const p = parseChat(chatId)
  return p ? personIdOf(p.platform, p.id) : ''
}

/** 一串 id（数组或用空白 / 逗号隔开的字）统一成「平台:账号」，去重。旧的纯数字算 QQ。 */
export function normRefList(v, platform) {
  const list = Array.isArray(v) ? v : String(v || '').split(/[\s,，;；]+/)
  const out = []
  for (const x of list) {
    const p = parsePerson(x, platform)
    if (!p) continue
    // QQ 号只认数字（和以前一样：手滑带了空格、横线的去掉）
    const id = p.platform === 'qq' ? p.id.replace(/\D/g, '') : p.id
    if (id) out.push(personIdOf(p.platform, id))
  }
  return [...new Set(out)]
}

/** 键是「平台:账号」的对象：旧的纯数字键补上 QQ。键撞了以新写法的为准。 */
export function normRefKeys(obj, platform) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
  const out = {}
  const entries = Object.entries(obj)
  // 先放旧写法，再放新写法：同一个人两种写法都有时，新写法的盖掉旧的
  for (const pass of [false, true]) {
    for (const [k, v] of entries) {
      if (k.includes(':') !== pass) continue
      const n = normRefList([k], platform)[0]
      if (n) out[n] = v
    }
  }
  return out
}

/** 人的 id 去掉平台，只在没有名字时拿来显示。 */
export function shortRef(ref) {
  const s = clean(ref)
  const c = parseChat(s)
  if (c) return c.id
  const i = s.indexOf(':')
  return i > 0 && PLATFORM_RE.test(s.slice(0, i)) ? s.slice(i + 1) : s
}
