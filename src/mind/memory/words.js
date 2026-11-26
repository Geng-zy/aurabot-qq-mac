// 兼容出口：实现在 src/core/keywords.js。
// 中文关键词抽取——纯文本处理，和记忆没有关系；
// 放在 core 是因为 mind-adapter 也要用它们；留在 mind 里会让适配层绕过门面直连内部文件。
export * from '../../core/keywords.js'
