import qqTools from './qq-tools/index.js'
import qqApi from './qq-api/index.js'
import qzoneSocial from './qzone-social/index.js'

// 沿用内置功能的生命周期和原有 id，已有配置、面板和自定义替换继续生效。
export const QQ_FEATURES = [qqTools, qqApi, qzoneSocial].map((def) => ({
  ...def,
  sourcePath: `channels/qq/features/${def.id}/index.js`,
}))
