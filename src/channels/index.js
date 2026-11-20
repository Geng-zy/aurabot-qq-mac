// 聊天平台的连接层：壳通过这里收发消息，不直接碰任何平台的接口。QQ 是第一个（./qq/），以后的飞书、企业微信照同一个接口写。
// 接口说明见 docs/DESIGN.md「聊天平台的连接层」。

import { PLATFORM_RE, parseChat, parsePerson } from './ids.js'

export * from './ids.js'

/**
 * 一个平台的连接。所有聊天 id 都带平台（qq:private:123），人是「平台:账号」，消息段统一用 OneBot v11 的段格式
 * （text / at / reply / image / record / file / face / mface / json …），平台不支持的段由连接自己换成文字或丢掉。
 * 下面带 ? 的方法按 caps 可以没有：壳和工具先看 caps，没有就不用这个功能（比如不戳一戳、不出现「发名片」工具）。
 *
 * @typedef {object} Channel
 * @property {string} platform           平台 id，写进聊天 id 的那一段（'qq'）
 * @property {string} label              给人看的名字（'QQ'）
 * @property {Record<string, boolean>} caps 能做什么，见 CAPS
 * @property {() => string} selfId       她在这个平台上的号
 * @property {() => boolean} ready        连上并核对过账号，可以收发
 * @property {() => string} state        connecting / connected / stopped …
 * @property {() => void} start
 * @property {() => void} stop
 * @property {() => void} restart
 * @property {() => Promise<object>} status  面板「连接」用：{ state, login, endpoint, problem }
 * @property {(fn: (e: ChannelEvent) => void) => () => void} on  订阅事件，返回取消订阅
 * @property {(chatId: string, segments: object[], opts?: object) => Promise<{messageId?: string, queued?: boolean}>} send
 * @property {(chatId: string, userId: string, opts?: object) => Promise<object|null>} [member]  群成员（昵称 card / nickname、role、title …）
 * @property {(chatId: string) => Promise<object[]>} [members]
 * @property {(userId: string) => Promise<object|null>} [user]
 * @property {(chatId: string) => Promise<{name: string}|null>} [group]
 * @property {(chatId: string, count: number) => Promise<object[]>} [history]   最近的消息（已经拆成通用形状）
 * @property {(chatId: string, messageId: string) => Promise<object|null>} [getMessage]
 * @property {(chatId: string, messageId: string, emoji: string) => Promise<void>} [react]
 * @property {(chatId: string, userId: string) => Promise<void>} [poke]
 * @property {(chatId: string) => Promise<void>} [typing]
 * @property {(messageId: string) => Promise<void>} [recall]
 * @property {(action: string, params?: object, opts?: object) => Promise<any>} [call]  平台自己的接口（只给声明了需要这个平台的模块用）
 */

/**
 * 连接发出来的事件。message 里的 msg 是通用形状（见 qq/convert.js 的 parseMessageEvent）：
 *   { platform, kind, chatId, userId, groupId, nickname, text, mentioned, messageId, replyId, images, stickers, records, files, segments, raw … }
 * @typedef {{ type: 'message', msg: object } | { type: 'poke', poke: object } | { type: 'notice', notice: object } | { type: 'raw', event: object } | { type: 'state', state: string } | { type: 'delivered', chatId: string, message: object[], note?: string, messageId?: string, system?: boolean }} ChannelEvent
 */

/** 能力标记。连接里没写的一律当 false。 */
export const CAPS = {
  faces: '平台自带的小表情（文字里的 <face:名字>）',
  stickers: '发表情包',
  voice: '发语音条',
  files: '发文件、收文件',
  recall: '撤回',
  poke: '戳一戳',
  react: '给消息贴表情回应',
  typing: '「对方正在输入」',
  history: '拉聊天记录',
  forward: '合并转发',
  card: '发名片',
  friendRequests: '处理好友申请',
  groupRequests: '处理加群申请',
  profile: '改自己的昵称 / 签名 / 头像',
  groupAdmin: '群管（禁言、踢人、改名片……）',
}

export const REQUIRED_CHANNEL_METHODS = Object.freeze(['platform', 'start', 'stop', 'send', 'on', 'ready'])
export const OPTIONAL_CHANNEL_METHODS = Object.freeze([
  'restart', 'status', 'selfId', 'state', 'member', 'members', 'user', 'group', 'history', 'getMessage',
  'react', 'poke', 'typing', 'recall', 'call', 'isDefiniteFailure', 'textSegments', 'meta', 'convert',
])

/**
 * 检查一个平台连接是否符合最小契约。平台适配器可以在自己的目录里做更强的检查；
 * 这里只保证壳不会把“少了 send/on”的实现注册进来，导致运行时才炸。
 * @param {Partial<Channel>} channel
 * @returns {Channel}
 */
export function validateChannel(channel) {
  if (!channel || typeof channel !== 'object') throw new Error('平台连接必须是一个对象')
  for (const k of REQUIRED_CHANNEL_METHODS) {
    if (channel[k] === undefined || channel[k] === null) throw new Error(`连接少了 ${k}`)
    if (k !== 'platform' && typeof channel[k] !== 'function') throw new Error(`连接的 ${k} 必须是函数`)
  }
  if (!PLATFORM_RE.test(String(channel.platform))) throw new Error(`平台 id 不合法：${channel.platform}`)
  if (channel.caps !== undefined && (!channel.caps || typeof channel.caps !== 'object' || Array.isArray(channel.caps))) {
    throw new Error('连接的 caps 必须是对象')
  }
  for (const k of OPTIONAL_CHANNEL_METHODS) {
    if (channel[k] !== undefined && channel[k] !== null && typeof channel[k] !== 'function') throw new Error(`连接的 ${k} 必须是函数`)
  }
  return channel
}

/** 所有平台的连接。 */
export function createChannels() {
  const map = new Map()
  return {
    /** 加一个连接；同一个平台只能有一个。 */
    add(channel) {
      validateChannel(channel)
      if (map.has(channel.platform)) throw new Error(`已经有 ${channel.platform} 的连接了`)
      if (!channel.caps) channel.caps = {}
      map.set(channel.platform, channel)
      return channel
    },
    get: (platform) => map.get(String(platform || '')) || null,
    /** 这个聊天（或人）走哪个连接；旧写法算 QQ。 */
    of(ref) {
      const p = parseChat(ref)?.platform || parsePerson(ref)?.platform
      return (p && map.get(p)) || null
    },
    list: () => [...map.values()],
    platforms: () => [...map.keys()],
    /** 这个聊天所在的平台能不能做某件事。 */
    can(ref, cap) {
      const ch = this.of(ref)
      return Boolean(ch && ch.caps && ch.caps[cap])
    },
    /** 启动所有已注册连接；单个平台失败不阻止其他平台。 */
    startAll() {
      for (const ch of map.values()) {
        try { Promise.resolve(ch.start()).catch(() => { /* 由适配器自己的 status 报告 */ }) } catch (error) { /* 同步抛错同样不阻断其他平台 */ }
      }
    },
    /** 订阅所有连接的事件。 */
    on(fn) {
      const offs = [...map.values()].map((ch) => ch.on((e) => fn({ ...e, platform: ch.platform })))
      return () => offs.forEach((off) => { try { off() } catch {} })
    },
    /** 面板和健康检查用的平台状态；不触发异步网络调用。 */
    status() {
      return [...map.values()].map((ch) => ({
        platform: ch.platform,
        label: ch.label || ch.platform,
        state: typeof ch.state === 'function' ? ch.state() : '',
        ready: typeof ch.ready === 'function' ? Boolean(ch.ready()) : false,
        caps: { ...(ch.caps || {}) },
        outbox: ch.outbox?.status ? ch.outbox.status() : null,
      }))
    },
    stopAll() { for (const ch of map.values()) { try { ch.stop() } catch {} } },
  }
}
