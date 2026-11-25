// 聊天流水：近几天的工作文件（完整经历在心智核心）。
// 按天 JSONL 落盘；超过「聊天流水留多久」的按天移到废纸篓，不直接删。
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '../core/store.js'
import { redact } from '../core/redact.js'
import { normChat, parseChat } from '../channels/index.js'
import { isOwner } from './access.js'
import { cleanOutboundText } from './reply.js'

const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/

/**
 * @param {{
 *   getConfig: () => object,
 *   log: object,
 *   trashDir?: string,
 *   mind?: object|null,
 *   hooks?: object,
 *   cleaningFor: (chatId: string) => object,
 * }} deps
 */
export function createChatLog({ getConfig, log, trashDir, mind, hooks, cleaningFor }) {
  let prunedDay = ''

  /** 有聊天流水的日期（升序）。 */
  function chatLogDays() {
    try {
      return readdirSync(dataDir('chatlog')).filter((name) => DAY_FILE.test(name)).map((name) => name.slice(0, 10)).sort()
    } catch (error) {
      return []
    }
  }

  /** 一天的全部流水行。 */
  function chatLogOf(day) {
    try {
      const file = join(dataDir('chatlog'), `${day}.jsonl`)
      if (!existsSync(file)) return []
      return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    } catch (error) {
      return []
    }
  }

  /**
   * 聊天流水只是近几天的工作文件：超过「聊天流水留多久」的按天移到废纸篓，不直接删。
   * -1 = 一直留；0 = 只留今天。一天最多整理一次。
   */
  function prune(today) {
    if (prunedDay === today) return 0
    prunedDay = today
    const keep = Number(getConfig().memory?.keepChatlogDays ?? 7)
    if (!trashDir || !Number.isFinite(keep) || keep < 0) return 0
    const cut = new Date(today + 'T00:00:00')
    cut.setDate(cut.getDate() - keep)
    const limit = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, '0')}-${String(cut.getDate()).padStart(2, '0')}`
    let moved = 0
    for (const day of chatLogDays()) {
      if (day >= limit || day === today) continue
      try {
        const trash = join(trashDir, 'aurabot-chatlog')
        mkdirSync(trash, { recursive: true })
        renameSync(join(dataDir('chatlog'), `${day}.jsonl`), join(trash, `${day}-${Date.now()}.jsonl`))
        moved += 1
      } catch (error) { log.debug('移走旧聊天流水失败：', error.message) }
    }
    return moved
  }

  /** 写一行流水。返回是否写入成功。 */
  function logChat(chatId, who, text, uid = '', { via, at, originId } = {}) {
    // 调试模式：不写聊天流水，只进插件日志（来自原项目 48b36fc）
    if (getConfig().debug) {
      log.info(`[调试] ${who}${uid ? '（' + uid + '）' : ''} → ${chatId}：${String(text || '').slice(0, 300)}`)
      return
    }
    try {
      // noteVia 直接写入其他平台的流水；QQ 回复已在投递路径清洗。
      if (who === 'bot' && via) {
        text = cleanOutboundText(text, cleaningFor(chatId))
        if (!text.trim()) return false
      }
      const timestamp = Number(at) > 0 && Number.isFinite(Number(at)) && Number.isFinite(new Date(Number(at)).getTime()) ? Number(at) : Date.now()
      const d = new Date(timestamp)
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const dir = dataDir('chatlog')
      mkdirSync(dir, { recursive: true })
      const target = parseChat(chatId)
      const ownerPrivate = target?.kind === 'private' && isOwner(getConfig(), target.id, chatId)
      const audienceShares = who === 'bot' ? mind?.shareIdsForChat?.(chatId) || [] : []
      const row = {
        t: timestamp,
        chatId,
        who,
        ...(uid ? { uid: String(uid) } : {}),
        text: redact(String(text).slice(0, 500)),
        ...(via ? { via } : {}),
        ...(ownerPrivate ? { ownerPrivate: true } : {}),
        ...(audienceShares.length ? { audienceShares } : {}),
      }
      appendFileSync(join(dir, `${day}.jsonl`), JSON.stringify(row) + '\n', 'utf8')
      // 模块的 chat/log 通知：落盘成功后的只读快照（移植自原项目 5cdbcd4）
      try { hooks?.journal?.({ ...row, ...(originId ? { originId } : {}) }) } catch (error) { log.warn('流水通知失败：', error.message) }
      const now = new Date()
      prune(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)
      return true
    } catch { return false }
  }

  /** 这条流水能不能给当前会话看。 */
  function canReadChatLog(row, audience) {
    const source = parseChat(row.chatId)
    if (!source) return false
    if (normChat(row.chatId) !== normChat(audience) && (row.ownerPrivate || mind?.isPrivateHistoryWindow?.(row.chatId)
      || (source.kind === 'private' && isOwner(getConfig(), source.id, row.chatId)))) return false
    if (row.audienceShares?.length && !mind?.canReadShares?.(row.audienceShares, audience)) return false
    return !cleaningFor(audience).protectedText?.(row.text)
  }

  return {
    logChat, chatLogDays, chatLogOf, canReadChatLog,
    // 测试用：让下一次写流水时重新整理一遍
    resetPruneForTest() { prunedDay = '' },
  }
}
