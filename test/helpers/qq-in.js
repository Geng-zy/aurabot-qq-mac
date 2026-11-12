// 测试用：把一条 OneBot 原始事件经过 QQ 连接拆成通用形状，再交给聊天中枢（和真跑时一样）。
export function qqIn(hub, event) {
  return hub.onMessage(hub.channels.get('qq').parse(event))
}
