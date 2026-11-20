// AstrBot 风格的 QQ 适配器入口。平台只拿到统一 Adapter，OneBot 细节收在 transport。
import { createQqChannel } from './index.js'
import { convertMessageEvent } from './convert.js'
import { createPlatformAdapter } from '../adapter-facade.js'

export function createQqAdapter(ctx = {}) {
  const transport = ctx.createTransport ? ctx.createTransport(ctx) : createQqChannel(ctx)
  const adapter = createPlatformAdapter({ platform: 'qq', label: 'QQ', transport })
  adapter.convert = (raw) => convertMessageEvent(raw, transport.selfId(), { faceName: transport.faces?.nameOf })
  return adapter
}
