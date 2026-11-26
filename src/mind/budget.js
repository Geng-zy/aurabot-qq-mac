// 兼容出口：实现在 src/core/tokens.js。
// token 估算与每日预算计数——估算那半是纯函数，预算那边只依赖注入的 store；
// 放在 core 是因为 mind-adapter 也要用它们；留在 mind 里会让适配层绕过门面直连内部文件。
export * from '../core/tokens.js'
