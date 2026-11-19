// 平台适配器注册表：借鉴 AstrBot 的 PlatformAdapter / PlatformManager 分层，
// 宿主只按注册表创建连接，不再把 QQ、Telegram 写死在 host 里。
import { createQqChannel } from './qq/index.js'
import { createTelegramChannel } from './telegram/index.js'

/** 每个平台只声明：id、给人看的名字、怎么创建。 */
export const BUILTIN_ADAPTERS = Object.freeze([
  {
    id: 'qq',
    label: 'QQ',
    create: ({ getConfig, log, canReplayDelivery }) => createQqChannel({
      getConfig, log: log.child('onebot'), canReplayDelivery,
    }),
  },
  {
    id: 'telegram',
    label: 'Telegram',
    create: ({ getConfig, log }) => createTelegramChannel({ getConfig, log: log.child('telegram') }),
  },
])

/**
 * 按注册表创建所有平台连接。
 * ctx.log 需要是带 child() 的 logger；后续新增平台只改这张表。
 */
export function createPlatformChannels(ctx) {
  return BUILTIN_ADAPTERS.map((adapter) => {
    try {
      return adapter.create(ctx)
    } catch (error) {
      ctx.log?.warn?.(`创建平台 ${adapter.id} 失败：`, error.message)
      return null
    }
  }).filter(Boolean)
}
