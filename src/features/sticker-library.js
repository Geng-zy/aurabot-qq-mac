// 表情库的纯逻辑：标签、匹配、挑一张、淘汰谁。不碰网络、不碰 DSH、可纯测。
// 从 features/stickers.js 拆出来：这层是「给一串表情条目算出用哪张 / 删哪张」，
// 采集与收藏（createStickerStore，374 行）才需要网络、限额与串行写。
// 库文件路径与读写仍在这里（loadLibrary/stickerPath），四个消费者直接从这里取。

import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import {join} from 'node:path'
import { dataDir, readJson, writeJson } from '../core/store.js'
import { stickerFileIn } from '../core/sticker-path.js'

/** 表情库目录（采集侧也要用，作为路径的唯一来源）。 */
export const stickerDir = () => dataDir('stickers')
const dir = () => stickerDir()
const indexFile = () => join(dir(), 'index.json')

export const DEFAULT_TAGS = ['开心', '卖萌', '生气', '委屈', '无语', '嘲讽', '疑惑', '早晚安']

export function loadLibrary() {
  return readJson(indexFile(), () => ({ items: [] }))
}

export function saveLibrary(lib) {
  writeJson(indexFile(), lib)
}

export function stickerPath(item) {
  return stickerFileIn(dir(), item)
}

/** 模糊匹配：备注 / 标签里包含关键词得分高；完全找不到返回 null。 */
export function matchSticker(items, query) {
  const q = String(query || '').trim()
  if (!q || !items.length) return null
  // 同名变体有主图时优先用主图；没有主图再在变体里随机。
  const named = items.filter((it) => it.name === q)
  if (named.length) return named.find((it) => it.primary) || named[Math.floor(Math.random() * named.length)]
  let best = null
  let bestScore = 0
  for (const it of items) {
    const hay = [it.name || '', ...(it.tags || [])]
    let s = 0
    for (const h of hay) {
      if (!h) continue
      if (h === q) s = Math.max(s, 10)
      else if (h.includes(q) || q.includes(h)) s = Math.max(s, 6)
      else {
        const common = [...q].filter((c) => h.includes(c)).length
        if (common >= 2) s = Math.max(s, common / Math.max(q.length, 1) * 4)
      }
    }
    if (s > bestScore || (s === bestScore && s > 0 && Math.random() < 0.5)) {
      best = it
      bestScore = s
    }
  }
  return bestScore >= 1.5 ? best : null
}

/** 打了这个标签的表情不参与自动配（太吓人、容易误会的梗图靠手动发）。 */
export const NEVER_RANDOM = '不随机'

/** 自动配表情：先按回复里的词匹配，匹配不到随机挑一张；带「不随机」标签的不参与。 */
export function pickForReply(items, replyText) {
  if (!items.length) return null
  const pool = items.filter((i) => !(i.tags || []).includes(NEVER_RANDOM))
  if (!pool.length) return null // 全被打上标签时，这一轮就不自动配
  const words = DEFAULT_TAGS.concat(pool.flatMap((i) => i.tags || []))
  for (const w of words) {
    if (w && String(replyText).includes(w)) {
      const m = matchSticker(pool, w)
      if (m) return m
    }
  }
  return pool[Math.floor(Math.random() * pool.length)]
}

/** 超过上限时该清掉哪张：只看偷来的，最少被发过的里最老的那张。 */
export function pickEvict(items) {
  // 管理员加的、从 QQ 收藏导进来的不清（那些本来就在机器人号的收藏里）
  const pool = items.filter((i) => !['manual', 'panel', 'qq', 'tool'].includes(i.from))
  if (!pool.length) return null
  return pool.slice().sort((a, b) => (a.uses || 0) - (b.uses || 0) || (a.lastUsed || a.at || 0) - (b.lastUsed || b.at || 0))[0]
}
