// 平台适配器注册表：借鉴 AstrBot 的 PlatformAdapter / PlatformManager 分层。
// 平台只负责：创建连接、把原始事件转成统一消息、把统一消息发回平台。
import { createQqAdapter } from './qq/adapter.js'
import { createTelegramAdapter } from './telegram/index.js'

const adapters = [
  {
    id: 'qq',
    label: 'QQ',
    create: ({ getConfig, log, canReplayDelivery }) => createQqAdapter({
      getConfig, log: log.child('onebot'), canReplayDelivery,
    }),
  },
  {
    id: 'telegram',
    label: 'Telegram',
    create: ({ getConfig, log }) => createTelegramAdapter({ getConfig, log: log.child('telegram') }),
  },
]

/** AstrBot 风格的注册入口：后续平台或扩展模块可以注册自己的适配器。 */
export function registerPlatformAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new Error('平台适配器必须是对象')
  const id = String(adapter.id || '').trim()
  if (!/^[a-z][a-z0-9_-]{1,31}$/u.test(id)) throw new Error(`平台适配器 id 不合法：${id}`)
  if (typeof adapter.create !== 'function') throw new Error(`平台适配器 ${id} 缺少 create()`)
  if (adapters.some((a) => a.id === id)) throw new Error(`平台适配器已经注册：${id}`)
  adapters.push({ ...adapter, id })
  return adapter
}

export function listPlatformAdapters() {
  return adapters.map(({ id, label }) => ({ id, label: label || id }))
}

/**
 * 按注册表创建所有平台连接。
 * ctx.log 需要是带 child() 的 logger；新增平台只改注册表或调用 registerPlatformAdapter。
 */
export function createPlatformChannels(ctx) {
  return adapters.map((adapter) => {
    try {
      return adapter.create(ctx)
    } catch (error) {
      ctx.log?.warn?.(`创建平台 ${adapter.id} 失败：`, error.message)
      return null
    }
  }).filter(Boolean)
}
