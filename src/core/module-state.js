// 模块内核的可变状态容器：只放数据，不放生命周期逻辑。
// 这样 registry / loader / panel 在后续拆分时可以共享同一份状态，而不必互相 import。
export function createModuleState() {
  return {
    live: new Map(), // id → 运行中的模块（见 start）
    errors: new Map(), // id → { message, at }  启动失败 / 加载失败
    routes: new Map(), // 完整路径 → { id, handler }
    listeners: new Map(), // 事件名 → [{ id, fn }]
    revisions: new Map(), // id → 停止次数，取消在途 import
    userSeen: new Map(), // id → { dir, file, stamp }
    generation: 0, // 模块每次（重）启动都递增：hub 用它判断工具闭包是否过期
  }
}
