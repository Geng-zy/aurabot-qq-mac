// 会话挂载的决策：这套挂载该不该收窄维护工具、指纹是什么。
//
// 从 chat/mount.js 里抠出来的纯函数。之前这段混在 40 多行的 mount() 中间，要验证它必须造一个
// 真 agent、真宿主工具服务、真配置；现在它只收事实、只返回结果，调用方（mount）负责副作用。
//
// 为什么值得单独一层（codebase-design 的删除测试）：删掉它，这些判断会重新散回 mount 的调用点，
// 而「管理员私聊豁免收窄」是一条会被误改的安全规则——收窄错了就是陌生人拿到 purge_apply。
//
// 约定：
//   · 只有「管理员私聊 + 完整权限 + 配置里的级别也是 full」才豁免收窄，三者缺一不可；
//   · 指纹（key）必须把工具名、被禁工具、收窄结果和模块代际都算进去，任何一个变了就整套重挂；
//   · 纯函数：不读配置、不碰文件、不看时间。时间/代际由调用方给。

/**
 * @param {object} input
 * @param {string} input.chatKind       'private' | 'group' | …
 * @param {string} input.level          这一轮要给的权限级别（mount 的入参）
 * @param {string} input.groupLevel     配置里对这个聊天的级别（levelFor 的结果）
 * @param {string} [input.botQQ]        管理员会话指纹里要带机器人号
 * @param {string} [input.ownerRevision] 管理员授权版本号（换管理员后必须重挂）
 * @param {string[]} [input.detected]   宿主上探测到的维护工具名（purge_*）
 * @param {string[]} [input.denied]     会话级被禁的工具名
 * @param {string[]} [input.toolNames]  这次要挂的工具名
 * @param {number} [input.generation]   模块（重）启动代际
 * @returns {{ownerMaintenance: boolean, denyMaintenance: string[], maintenanceKey: string, key: string}}
 */
export function planMount({
  chatKind, level, groupLevel,
  botQQ = '', ownerRevision = '',
  detected = [], denied = [], toolNames = [], generation = 0,
} = {}) {
  const ownerMaintenance = chatKind === 'private' && level === 'full' && groupLevel === 'full'
  // 豁免时不做收窄；其余情况把探测到的维护工具全部禁掉（探测失败时 detected 为空 = 不收窄，见 host-tools 的说明）
  const denyMaintenance = ownerMaintenance ? [] : [...detected]
  const maintenanceKey = ownerMaintenance ? `owner:${botQQ}:${ownerRevision}` : denyMaintenance.join(',')
  const key = [...toolNames].sort().join(',')
    + '|' + [...denied].join(',')
    + '|' + maintenanceKey
    + '|gen:' + generation
  return { ownerMaintenance, denyMaintenance, maintenanceKey, key }
}
