// 只有「这一轮说话的人全是管理员」时才能用的 QQ 工具。
//
// 这些工具会改资料、发文件、动群管理或改她自己的设定；群里别人说话的那一轮
// 即使工具已经挂在 agent 上，执行入口也要再查一次发言人。
export const PRIVILEGED_QQ_TOOLS = new Set([
  'qq_set_nickname', 'qq_set_signature', 'qq_set_avatar', 'qq_whitelist',
  'qq_handle_friend_request', 'qq_handle_group_request', 'qq_list_group_requests',
  'qq_send_file', 'qq_send_message', 'qq_edit_sticker', 'qq_import_qq_stickers',
  'qq_read_file', 'qq_send_qzone', 'qq_group_admin', 'mind_change_self',
])

export function isPrivilegedQqTool(name) {
  return PRIVILEGED_QQ_TOOLS.has(String(name || ''))
}
