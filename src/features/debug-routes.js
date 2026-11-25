// 群头衔过滤源和面板调试对话。

export function registerDebugRoutes({ route, readBody, getConfig, hub }) {
  // 按群头衔不理：白名单群 + 现有头衔，面板点一个设成过滤那类。
  route('/groups/titles', async () => {
    const gids = (getConfig().allow.groups || []).map(String)
    const groups = await Promise.all(gids.map(async (gid) => ({ groupId: gid, name: await hub.groupName(gid) })))
    if (!gids.length) return { ok: true, groups, titles: [], failed: [] }
    const { titles, failed } = await hub.titleFilter.titlesIn(gids)
    hub.titleFilter.clear()
    return { ok: true, groups, titles, failed, message: failed.length ? `有 ${failed.length} 个群的成员没拉到（她在群里吗？）` : '' }
  })

  // 面板调试对话：走管理员私聊正常链路，但不发 QQ、不写进心智。
  route('/debug/say', async (req) => {
    const b = await readBody(req)
    try { return await hub.debugSay(String(b.text || '')) } catch (error) { return { ok: false, message: error.message } }
  })
}
