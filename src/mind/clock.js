// 兼容出口：实现在 src/core/clock.js。
// 时钟与本地时间（时区、作息区间、日期键、年龄）——纯函数，不碰任何状态；
// 放在 core 是因为 mind-adapter 也要用它们；留在 mind 里会让适配层绕过门面直连内部文件。
export * from '../core/clock.js'
