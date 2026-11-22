// 平台运行时：注册表 + 生命周期 + 统一事件。宿主只面对这个对象，不再自己给每个平台接事件。
import { createChannels } from './index.js'

export function createChannelManager({ log } = {}) {
  const registry = createChannels()
  const handlers = new Set()
  const offs = new Map()

  function emit(event) {
    for (const fn of [...handlers]) {
      try { fn(event) } catch (error) { log?.warn?.('平台事件处理失败：', error.message) }
    }
  }

  function add(channel) {
    registry.add(channel)
    if (typeof channel.on === 'function') {
      const off = channel.on((event) => emit({ ...event, platform: channel.platform }))
      offs.set(channel, off)
    }
    return channel
  }

  return {
    add,
    get: registry.get,
    list: registry.list,
    platforms: registry.platforms,
    of: registry.of,
    can: registry.can,
    status: registry.status,
    startAll() {
      for (const ch of registry.list()) {
        try { Promise.resolve(ch.start()).catch((error) => log?.warn?.(`平台 ${ch.platform} 启动失败：`, error.message)) } catch (error) { log?.warn?.(`平台 ${ch.platform} 启动失败：`, error.message) }
      }
    },
    stopAll() { for (const ch of registry.list()) { try { ch.stop() } catch (error) { log?.warn?.(`平台 ${ch.platform} 停止失败：`, error.message) } } },
    /** 订阅所有平台事件；返回取消订阅。 */
    on(fn) {
      handlers.add(fn)
      return () => handlers.delete(fn)
    },
    dispose() {
      for (const off of offs.values()) { try { off() } catch {} }
      offs.clear()
      handlers.clear()
      for (const ch of registry.list()) { try { ch.dispose ? ch.dispose() : ch.stop() } catch (error) { log?.warn?.(`平台 ${ch.platform} 关闭失败：`, error.message) } }
    },
  }
}
