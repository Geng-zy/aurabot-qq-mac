// 谁能跟她说话、她在每个会话里有多大权限。纯函数。
import { normPerson, parseChat, parsePerson, refOfChat } from '../channels/ids.js'

/** 权限档位：full = DSH 完整工具；social = 只有 QQ 社交工具；chat = 纯聊天，没有工具。 */
export const LEVELS = ['full', 'social', 'chat']

/**
 * @param {object} cfg 插件配置
 * @param {{kind:'private'|'group', userId:string, groupId:string}} msg
 * @returns {{allowed: boolean, reason: string}}
 */
export function checkAllowed(cfg, msg) {
  const chat = parseChat(msg.chatId)
  const destination = chat?.kind === msg.kind ? refOfChat(msg.chatId) : ''
  if (chat && !destination) return { allowed: false, reason: '会话类型不符' }
  const owner = normPerson(cfg.ownerQQ)
  if (msg.kind === 'private') {
    const who = destination || normPerson(msg.userId, msg.platform)
    if (destination && msg.userId != null && normPerson(msg.userId, chat.platform) !== destination) return { allowed: false, reason: '私聊账号不符' }
    if (who && who === owner) return { allowed: true, reason: '主人' }
    const list = (cfg.allow?.private || []).map((id) => normPerson(id))
    return who && list.includes(who)
      ? { allowed: true, reason: '私聊白名单' }
      : { allowed: false, reason: '不在私聊白名单' }
  }
  const group = destination || normPerson(msg.groupId, msg.platform)
  const groups = (cfg.allow?.groups || []).map((id) => normPerson(id))
  return group && groups.includes(group)
    ? { allowed: true, reason: '群白名单' }
    : { allowed: false, reason: '不在群白名单' }
}

/** 群聊里给不给本机工具：off = 不给；owner = 只有主人说话那一轮给。
 * 没有「谁问都给」这一档——群里任何人都能驱动本机读写，权限面太大，明确不做。 */
export const GROUP_OWNER_TOOLS = ['off', 'owner']

/**
 * 这个群当前该给哪一档。ownerToolsGroups 非空时只在列出的群里生效（留空 = 所有群）。
 * @returns {'off'|'owner'}
 */
export function groupOwnerTools(cfg, chat) {
  if (!chat || chat.kind !== 'group') return 'off'
  const mode = cfg?.group?.ownerTools
  if (mode !== 'owner') return 'off'
  const list = (cfg?.group?.ownerToolsGroups || []).map((id) => normPerson(id)).filter(Boolean)
  if (list.length && !list.includes(refOfChat(chat.chatId) || normPerson(chat.groupId, chat.platform))) return 'off'
  return mode
}

/** 这个会话用哪一档权限。群聊默认不超过 social，除非主人给这个群开了本机工具。 */
export function levelFor(cfg, chat) {
  if (chat.kind === 'private' && isOwner(cfg, chat.userId, chat.chatId)) {
    return LEVELS.includes(cfg.ownerLevel) ? cfg.ownerLevel : 'full'
  }
  // group-full 不叫 full：插件自己的工具还要按 social 语义挂（模块里到处是 level === 'full' 判主人私聊），
  // 真正的开关由 hub 按这一轮说话的人做（tools.restrict 收走核心工具）。
  if (chat.kind === 'group' && groupOwnerTools(cfg, chat) !== 'off') return 'group-full'
  return 'social'
}

/** 档位 → agent preset id。 */
export function presetFor(level, cfg) {
  if (level === 'group-full') return 'aurabot-group-owner'
  if (level !== 'full') return 'aurabot-social'
  return cfg && cfg.longTasks ? 'aurabot-private-long' : 'aurabot-private'
}

/** 只有主人能做的事（群管、点歌、写文件……）。 */
export function isOwner(cfg, userId, chatId) {
  const chat = parseChat(chatId)
  const person = parsePerson(userId, chat?.platform)
  return Boolean(person && (!chat || person.platform === chat.platform) && normPerson(userId, chat?.platform) === normPerson(cfg.ownerQQ))
}

/**
 * 给她自由（默认开）：她自己的事（改资料、发评论、画画唱歌、管表情库、加好友、在群里当管理……）由她自己决定，
 * 不用主人开口；别人让她做只是请求，做不做她自己判断。面板里关掉的功能（off）照样不做。
 * 不受影响的是保护主人的几道闸：别人说话的那一轮不能用本机命令和文件、不能把主人电脑上的文件发出去、
 * 不读别人发来的文件当指令，主人私聊原话只在来源会话可查。
 */
export const freeWill = (cfg) => cfg?.freedom !== false
/** 「只有主人开口才行」的地方：自由开着就由她决定，关着才要主人开口。 */
export const ownerOrFree = (cfg, allOwner) => freeWill(cfg) || Boolean(allOwner)

/** 改资料类操作（改昵称 / 签名 / 头像），以及处理好友申请、改白名单的三档权限。 */
export const PROFILE_PERM_LEVELS = ['off', 'owner', 'all']
export const DOUYIN_PERM_KEYS = ['douyinBrowse', 'douyinLike', 'douyinComment', 'douyinShareOwner', 'douyinDm']
/** 小黑盒：浏览（含热榜/搜索）、点赞、评论、发帖（含删自己的帖）。 */
export const HEYBOX_PERM_KEYS = ['heyboxBrowse', 'heyboxLike', 'heyboxComment', 'heyboxPost']
const OWNER_PROFILE_KEYS = ['qqNickname', 'qqSignature', 'qqAvatar', 'qqFriendRequest', 'whitelist']
export const PROFILE_PERM_KEYS = [...OWNER_PROFILE_KEYS, ...DOUYIN_PERM_KEYS, ...HEYBOX_PERM_KEYS]
/** 没设过的档位：一律默认仅主人（含抖音浏览/互动/改资料项；用户要放开自己在面板开）。 */
export const profilePermDefault = (key) => 'owner'
export const permOf = (cfg, key) => {
  const p = cfg?.profilePerms?.[key]
  return PROFILE_PERM_LEVELS.includes(p) ? p : profilePermDefault(key)
}

/** 这一档在这个会话里要不要挂工具。owner = 只在主人私聊里挂；all = 哪都挂；off = 不挂。 */
export function profileToolVisible(cfg, key, chat) {
  const p = permOf(cfg, key)
  if (OWNER_PROFILE_KEYS.includes(key)) {
    if (p === 'off') return false
    return chat.kind === 'group' ? p === 'all' : chat.kind === 'private' && isOwner(cfg, chat.userId, chat.chatId)
  }
  if (p !== 'off' && freeWill(cfg)) return chat.kind === 'private' || chat.kind === 'group'
  if (p === 'all') return chat.kind === 'private' || chat.kind === 'group'
  if (p === 'owner') return chat.kind === 'private' && isOwner(cfg, chat.userId, chat.chatId)
  return false
}

/** 执行时再查一遍（面板可能刚改过）。allOwner = 这一轮说话的人全是主人。 */
export function profilePermits(cfg, key, chat, allOwner) {
  const p = permOf(cfg, key)
  if (p === 'off') return { ok: false, message: '这个操作在面板里关掉了' }
  if (!profileToolVisible(cfg, key, chat)) return { ok: false, message: '这里不能做这个操作' }
  if (OWNER_PROFILE_KEYS.includes(key)) return allOwner ? { ok: true } : { ok: false, message: '只有主人开口才能做这个操作' }
  if (freeWill(cfg)) return { ok: true }
  if (p === 'owner' && !allOwner) return { ok: false, message: '只有主人私聊让我改才行' }
  return { ok: true }
}
