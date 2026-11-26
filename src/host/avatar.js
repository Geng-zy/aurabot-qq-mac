// 形象图的位置与状态：自定义头像放在数据目录（重装插件不丢），没有就用插件自带的那张。
// 概览页和头像路由都要读它，所以放在一处，别两边各写一份判断。

import { statSync } from 'node:fs'

export function createAvatarStore({ dataDir }) {
  const file = () => dataDir('avatar.img')
  const info = () => {
    try { return { custom: true, at: statSync(file()).mtimeMs } } catch { return { custom: false, at: 0 } }
  }
  return { file, info }
}
