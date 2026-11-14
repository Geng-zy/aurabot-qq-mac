import { ownerAuthorizationRevision } from '../../core/config.js'
import { dataDir, readJson, writeJson } from '../../core/store.js'
import { isPrivateDrawMessage } from './inbound.js'

const RESTART_WINDOW_MS = 30_000
const RECONNECT_WINDOW_MS = 120_000
const HISTORY_LIMIT = 20
const SEEN_LIMIT = 1024
const HISTORY_WORKERS = 4
const validId = (id) => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))
const chatKey = (kind, id) => `${kind}:${id}`

function identify(event, bot) {
  const kind = event?.message_type
  const author = String(event?.user_id ?? '')
  if (!validId(author) || author === bot) return null
  if (event.sender?.user_id != null && String(event.sender.user_id) !== author) return null
  if (event.self_id != null && String(event.self_id) !== bot) return null
  const id = String(event.message_id ?? '')
  if (!/^-?[1-9]\d{0,19}$/.test(id)) return null
  if (kind === 'private' && event.sub_type === 'friend' && !Number(event.group_id || event.sender?.group_id || 0)) {
    if (event.target_id != null && String(event.target_id) !== bot) return null
    return { kind, peer: author, id }
  }
  const group = String(event.group_id ?? '')
  if (kind === 'group' && event.sub_type === 'normal' && !event.anonymous && validId(group)) return { kind, peer: group, id }
  return null
}

function isChatText(event) {
  const message = event.message
  if (!Array.isArray(message)) return false
  const group = event.message_type === 'group'
  let text = ''
  let mention = false
  for (const segment of message) {
    if (segment?.type === 'text' && typeof segment.data?.text === 'string') text += segment.data.text
    else if (group && segment?.type === 'at' && (validId(String(segment.data?.qq)) || segment.data?.qq === 'all')) mention = true
    else if (!group || !['reply', 'face'].includes(segment?.type)) return false
  }
  return Boolean(text.trim() || mention) && !/^\s*[/／]/u.test(text) && !isPrivateDrawMessage(message)
}

function targetsFor(cfg) {
  const peers = new Set([cfg.ownerQQ, ...(cfg.allow?.private || [])].map(String).filter((id) => validId(id) && id !== cfg.botQQ))
  const groups = new Set((cfg.allow?.groups || []).map(String).filter(validId))
  return [
    ...[...peers].map((id) => ({ id, kind: 'private' })),
    ...[...groups].map((id) => ({ id, kind: 'group' })),
  ]
}

function allowed(cfg, kind, id) {
  return kind === 'private' ? cfg.ownerQQ === id || cfg.allow?.private?.includes(id) : cfg.allow?.groups?.includes(id)
}

/** 通过核对账号的 WS 补收白名单会话的近期文字，去重记录只保存消息编号和时间。 */
export function createQqInbox({ getConfig, log }) {
  const file = dataDir('qq-inbox.json')
  let startedAt = Date.now()
  let saved = readJson(file, () => readJson(dataDir('qq-owner-inbox.json'), null))
  let bindingKey = ''
  let bindingStartedAt = startedAt
  let expandedAt = startedAt
  let seen = new Map()
  let disconnectedAt = null
  let epoch = 0
  let saveTimer = null

  function binding() {
    const cfg = getConfig()
    if (!cfg.enabled || cfg.debug || cfg.dryRun) return null
    const bot = String(cfg.botQQ || '')
    const owner = String(cfg.ownerQQ || '')
    const revision = ownerAuthorizationRevision(cfg)
    if (!validId(bot)) return null
    return { bot, owner, key: `${bot}:${owner}:${revision}` }
  }

  function loadFor({ key, owner }) {
    if (bindingKey === key) return
    flush()
    bindingKey = key
    bindingStartedAt = saved?.key === key && Number.isFinite(saved.startedAt) ? saved.startedAt : startedAt
    expandedAt = saved?.key === key && Number.isFinite(saved.expandedAt) ? saved.expandedAt : startedAt
    const entries = saved?.key === key && Array.isArray(saved.seen) ? saved.seen : []
    seen = new Map(entries.slice(-SEEN_LIMIT)
      .filter((entry) => Array.isArray(entry) && typeof entry[0] === 'string' && Number.isFinite(entry[1]))
      .map(([id, at]) => [id.includes(':') ? id : `${chatKey('private', owner)}:${id}`, at]))
  }

  function persist() {
    saved = { key: bindingKey, startedAt: bindingStartedAt, expandedAt, seen: [...seen] }
    try { writeJson(file, saved) }
    catch { log.warn('无法保存 QQ 收件去重记录') }
  }

  function flush() {
    if (!saveTimer) return
    clearTimeout(saveTimer)
    saveTimer = null
    persist()
  }

  function scheduleSave() {
    if (saveTimer) return
    saveTimer = setTimeout(flush, 200)
    saveTimer.unref?.()
  }

  function accept(event, current = binding()) {
    if (!current) return true
    const chat = identify(event, current.bot)
    if (!chat || !allowed(getConfig(), chat.kind, chat.peer) || !isChatText(event)) return true
    loadFor(current)
    const now = Date.now()
    for (const [oldId, at] of seen) {
      if (at >= now - RECONNECT_WINDOW_MS && at <= now) continue
      seen.delete(oldId)
    }
    const idKey = `${chatKey(chat.kind, chat.peer)}:${chat.id}`
    if (seen.has(idKey)) return false
    seen.set(idKey, now)
    if (seen.size > SEEN_LIMIT) seen.delete(seen.keys().next().value)
    scheduleSave()
    return true
  }

  function disconnect() {
    const current = binding()
    if (current) disconnectedAt ??= { key: current.key, time: Date.now() }
  }

  function suspend() {
    flush()
    epoch++
    startedAt = Date.now()
    bindingStartedAt = startedAt
    expandedAt = startedAt
    disconnectedAt = null
    saved = null
    bindingKey = ''
    seen.clear()
    persist()
  }

  function prepare(connectedAt) {
    const current = binding()
    if (!current) return null
    loadFor(current)
    const gapStart = disconnectedAt?.key === current.key ? disconnectedAt.time : null
    const after = gapStart === null
      ? Math.max(bindingStartedAt, connectedAt - RESTART_WINDOW_MS)
      : Math.max(bindingStartedAt, gapStart - 2_000, connectedAt - RECONNECT_WINDOW_MS)
    return { current, epoch, after, before: Math.floor(connectedAt / 1000), targets: targetsFor(getConfig()) }
  }

  async function recover(plan, { call, isCurrent, onMessage }) {
    if (!plan) return
    const { current, after, before, targets } = plan
    const stillCurrent = () => plan.epoch === epoch && isCurrent() && binding()?.key === current.key
    if (!stillCurrent()) return
    let next = 0
    let count = 0
    let failed = 0
    async function readNext() {
      while (stillCurrent() && next < targets.length) {
        const target = targets[next++]
        if (!allowed(getConfig(), target.kind, target.id)) continue
        const privateChat = target.kind === 'private'
        const action = privateChat ? 'get_friend_msg_history' : 'get_group_msg_history'
        const field = privateChat ? 'user_id' : 'group_id'
        const since = Math.floor((privateChat && target.id === current.owner ? after : Math.max(after, expandedAt)) / 1000)
        try {
          const result = await call(action, { [field]: Number(target.id), count: HISTORY_LIMIT }, { wsOnly: true, timeoutMs: 2500 })
          const history = Array.isArray(result) ? result : result?.messages
          if (!Array.isArray(history)) { failed++; continue }
          const candidates = history.slice(0, HISTORY_LIMIT).filter((event) => {
            const time = Number(event?.time)
            const chat = identify(event, current.bot)
            return Number.isSafeInteger(time) && time >= since && time <= before
              && chat?.kind === target.kind && chat.peer === target.id && isChatText(event)
          }).sort((a, b) => Number(a.time) - Number(b.time) || Number(a.message_seq || 0) - Number(b.message_seq || 0))
          for (const event of candidates) {
            if (!stillCurrent() || !allowed(getConfig(), target.kind, target.id)) break
            if (!accept(event, current)) continue
            onMessage(event)
            count++
          }
        } catch {
          failed++
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(HISTORY_WORKERS, targets.length) }, readNext))
    if (!stillCurrent()) return
    if (failed < targets.length) disconnectedAt = null
    if (saved?.key !== current.key || !Number.isFinite(saved?.expandedAt)) scheduleSave()
    if (count) log.info(`QQ 重连后补收聊天消息 ${count} 条`)
    if (failed) log.debug(`QQ 历史补收有 ${failed} 个会话查询失败，实时收消息仍可用`)
  }

  return { accept, disconnect, suspend, prepare, recover, flush }
}
