// 兼容入口：OneBot 传输已迁到 transport.js。
// 新代码请直接从 transport.js 取；旧测试和模块可以继续从 client.js import。
export { OneBotError, isDefiniteFailure, createOneBotClient } from './transport.js'
