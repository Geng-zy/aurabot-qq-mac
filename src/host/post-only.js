// 需要请求包体的面板接口：一律只接受 POST。
//
// 为什么单独列一张表：route() 的写操作闸原来只看路径里的动词（save/delete/…）。
// 但有一类接口路径看着是查询、其实要读包体，GET 没有 body，handler 会拿到空对象继续跑：
//   GET /aurabot/api/notice/toggle  → b = {} → 把「审批通知」直接打开并写盘；
//   GET /aurabot/api/debug/say      → 空文本直接进调试回合。
// 这类接口必须显式登记，不能靠路径词根猜。
//
// 维护规则：新接口只要读了 readBody / readRaw，就登记进来；
// test/panel-post-only.test.js 会扫源码核对，漏登记或僵尸条目都会失败。

export const POST_ONLY = new Set([
  // 备份：包里带路径/字节流
  '/backup/remote/list',
  '/backup/verify',
  '/backup/open',
  '/backup/restore-path',
  '/backup/cancel',
  '/backup/sessions/retry',
  '/backup/sessions/cancel',
  // 调试与人格
  '/debug/say',
  '/persona/polish',
  '/bridge/examples',
  // 知识库
  '/knowledge/rename',
  // 本地接口（试跑脚本 / 生成模板）
  '/local/template',
  '/local/test',
  // 心智
  '/mind/permission/decide',
  // 模型（拿草稿配置试连通性）
  '/model/ping',
  '/provider-models',
  // 模块（试跑 / 复制 / 工具试调用）
  '/modules/fork',
  '/modules/simulate',
  '/modules/tool',
  // 通知开关
  '/notice/toggle',
])
