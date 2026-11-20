// Telegram 也使用同一个 PlatformAdapter 外形；长轮询和 Bot API 细节留在 transport。
import { createTelegramChannel } from './index.js'
import { createPlatformAdapter } from '../adapter-facade.js'

export function createTelegramAdapter(ctx = {}) {
  const transport = ctx.createTransport ? ctx.createTransport(ctx) : createTelegramChannel(ctx)
  return createPlatformAdapter({ platform: 'telegram', label: 'Telegram', transport })
}
