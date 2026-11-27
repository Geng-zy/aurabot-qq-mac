// 宿主接触面的取证接口：只读，给面板和实机验收看「rc.3 上到底走通了哪条路」。
//
// 起因（B17）：维护工具的发现有四条路径，全都只有单测。真机上究竟命中哪一条、
// 认出了哪些 purge_* 工具，一直没有人能在运行时回答。这个接口把答案摆出来：
//   · last  —— 最近一次会话挂载实际用的来源与结果（挂载时记录，含 chatId/sessionId）
//   · probe —— 当场对宿主全局视图再问一次（不依赖会话，随时可查）
// 两个都是只读：不注册工具、不改配置、不触发任何宿主状态变更。

import { HOST_MAINTENANCE_PREFIX, lastDetection, probeGlobalTools } from '../integration/host-tools.js'
import { planMount } from '../chat/mount-plan.js'
import { levelFor } from '../chat/access.js'

/** 读 ctx.tools：宿主没注入时会抛（cordis: cannot get property … without inject），这里统一吞掉。 */
function probeTools(ctx) {
  try { return ctx?.tools ?? null } catch { return null }
}

export function registerHostRoutes({ route, ctx, getConfig, presetFor = () => '', lastPreset = () => null }) {
  // 只读：给一个假设的聊天与级别，算出「这套挂载会不会收窄维护工具、指纹是什么」。
  // 用途是实机验收——不用真的发一条 QQ 消息，也能看到群聊/私聊两条路径的收窄结果。
  route('/host/mount-plan', async (req) => {
    const q = new URL(String(req?.url || '/'), 'http://127.0.0.1').searchParams
    const chatId = String(q.get('chat') || '')
    const level = String(q.get('level') || 'chat')
    if (!chatId) return { ok: false, message: '给一个 chat，例如 ?chat=qq:group:123&level=chat' }
    const kind = chatId.includes(':group:') ? 'group' : chatId.includes(':private:') ? 'private' : 'system'
    const tail = chatId.split(':').pop() || ''
    // levelFor 会按 userId / groupId 查白名单，字段必须从 chatId 里还原出来，否则一律判成「无权限」
    const chat = { kind, chatId, userId: kind === 'private' ? tail : '', groupId: kind === 'group' ? tail : '', nickname: '' }
    const config = getConfig ? getConfig() : {}
    // 刚启动还没挂载过时 lastDetection() 是 null：这时用全局探测兜底，否则读出来的永远是「不收窄」，
    // 反而会让人以为收窄没生效。
    const probed = probeGlobalTools(probeTools(ctx))
    const probedNames = probed.restrictableNames || probed.knownNames || []
    const detected = (lastDetection()?.names || probedNames)
      .filter((n) => String(n).startsWith(HOST_MAINTENANCE_PREFIX)).sort()
    const plan = planMount({
      chatKind: kind, level, groupLevel: levelFor(config, chat),
      botQQ: config.botQQ, ownerRevision: '',
      detected, toolNames: [], generation: 0,
    })
    return { ok: true, chat: { chatId, kind, level }, groupLevel: levelFor(config, chat), detected, plan }
  })

  // 只读：某条会话的「当前预设」是怎么记下来的（建会话时 / 会话中切换），最近一次登记是什么。
  // 用途：验证 notePreset 在正确时机生效 —— 切换后这里应当立刻反映新预设、source=event。
  route('/host/preset', async (req) => {
    const q = new URL(String(req?.url || '/'), 'http://127.0.0.1').searchParams
    const session = String(q.get('session') || '')
    return {
      ok: true,
      session: session || null,
      presetFor: session ? presetFor(session) : null,
      last: lastPreset(),
    }
  })

  route('/host/tools', async () => {
    // 宿主没注入 tools 时，读属性本身就会抛（cordis: cannot get property … without inject）。
    // 这是**能力缺失**，不是错误：如实报 view: 'none' 并带上原因，别让面板拿到一个 500。
    let tools = null
    let missing = ''
    try { tools = ctx?.tools ?? null } catch (error) { missing = String((error && error.message) || error).slice(0, 160) }
    const probe = probeGlobalTools(tools)
    if (missing && !probe.error) probe.error = missing
    const names = probe.restrictableNames || probe.knownNames || []
    return {
      ok: true,
      prefix: HOST_MAINTENANCE_PREFIX,
      probe,
      probeMaintenance: names.filter((n) => n.startsWith(HOST_MAINTENANCE_PREFIX)).sort(),
      last: lastDetection(),
    }
  })
}
