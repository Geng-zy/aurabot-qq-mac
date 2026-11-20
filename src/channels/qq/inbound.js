// 兼容入口：QQ 事件转换已经迁到 convert.js。
// 旧调用方继续从这里 import；新代码请直接用 convert.js。
export {
  segmentsOf,
  isLegacyDirectRecord,
  isStickerSegment,
  cardText,
  convertMessageEvent,
  convertMessageEvent as parseMessageEvent,
} from './convert.js'
