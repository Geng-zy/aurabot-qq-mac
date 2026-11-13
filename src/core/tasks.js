import { randomUUID } from 'node:crypto'
import { dataDir, readJson, writeJson } from './store.js'
import { normChat } from '../channels/ids.js'
import { defineTool, str } from '../tools/tools.js'

const ACTIVE = new Set(['queued', 'running', 'cancelling', 'delivering'])
const labels = {
  queued: '排队', running: '进行中', cancelling: '正在取消', delivering: '正在发送',
  completed: '已发送', simulated: '试运行完成', failed: '未完成', cancelled: '已取消',
  interrupted: '重启前未完成', unconfirmed: '发送结果未确认',
}

export function createTasks({ file = dataDir('creative-tasks.json'), log, now = Date.now } = {}) {
  const saved = readJson(file, [])
  const records = new Map()
  for (const item of Array.isArray(saved) ? saved : []) {
    if (!item?.id || !item.chatId || !Object.hasOwn(labels, item.state)) continue
    const state = item.state === 'delivering' ? 'unconfirmed' : ACTIVE.has(item.state) ? 'interrupted' : item.state
    records.set(item.id, { ...item, requesters: Array.isArray(item.requesters) ? item.requesters : [],
      state, stage: state === item.state ? item.stage : '', updatedAt: state === item.state ? item.updatedAt : now() })
  }
  const waiting = new Map()
  const running = new Map()
  let closed = false

  function persist() {
    const finished = [...records.values()].filter((item) => !ACTIVE.has(item.state)).sort((a, b) => b.updatedAt - a.updatedAt)
    for (const item of finished.slice(100)) records.delete(item.id)
    writeJson(file, [...records.values()])
  }
  if (Array.isArray(saved) && saved.some((item) => ACTIVE.has(item?.state))) persist()

  function update(item, state, stage = '') {
    const previous = { ...item }
    Object.assign(item, { state, stage, updatedAt: now() })
    try { persist() } catch (error) { Object.assign(item, previous); throw error }
  }

  function schedule() {
    if (closed) return
    for (const [id, run] of waiting) {
      const item = records.get(id)
      if (running.has(item.kind)) continue
      waiting.delete(id)
      const controller = new AbortController()
      running.set(item.kind, controller)
      void execute(item, run, controller.signal)
    }
  }

  async function execute(item, run, signal) {
    const isCurrent = () => !closed && (item.state === 'running' || item.state === 'delivering')
    function checkpoint(stage) {
      if (!isCurrent()) throw new Error('任务已取消')
      if (stage && item.state === 'running' && stage !== item.stage) update(item, 'running', stage)
    }
    function beginDelivery() {
      checkpoint()
      if (item.state !== 'running') throw new Error('已开始发送')
      update(item, 'delivering')
    }
    try {
      update(item, 'running')
      const result = await run({ checkpoint, beginDelivery, isCurrent, signal })
      if (closed) return
      if (item.state === 'cancelling') update(item, 'cancelled')
      else if (result?.simulated && item.state === 'running') update(item, 'simulated')
      else if (result?.ok && item.state === 'delivering') update(item, 'completed')
      else update(item, item.state === 'delivering' ? 'unconfirmed' : 'failed')
    } catch (error) {
      if (!closed) {
        try { update(item, item.state === 'cancelling' ? 'cancelled' : item.state === 'delivering' ? 'unconfirmed' : 'failed') }
        catch (storageError) { log?.warn('保存任务状态失败：', storageError.message) }
      }
      if (item.state !== 'cancelled') log?.warn('后台任务未完成：', error.message)
    } finally {
      running.delete(item.kind)
      schedule()
    }
  }

  function start({ kind, chatId, requesters = [], run }) {
    if (closed || waiting.size >= 8) return { ok: false, message: '后台任务暂时排满了' }
    let id
    do { id = randomUUID().slice(0, 8) } while (records.has(id))
    const item = { id, kind, chatId: normChat(chatId), requesters: [...new Set(requesters)], state: 'queued', stage: '', updatedAt: now() }
    records.set(item.id, item)
    try { persist() } catch (error) { records.delete(item.id); throw error }
    waiting.set(item.id, run)
    queueMicrotask(schedule)
    return { ok: true, taskId: item.id, message: `${kind}已安排（编号 ${item.id}），完成后会发到当前会话。` }
  }

  const describe = (item) => `${item.id} ${item.kind} · ${labels[item.state]}${item.stage ? ' · ' + item.stage : ''}`
  function tools({ chat }, requesters) {
    if (!chat || chat.kind === 'system') return []
    const chatId = normChat(chat.chatId)
    const find = (id) => {
      const item = records.get(String(id || '').trim())
      return item?.chatId === chatId ? item : null
    }
    return [
      defineTool({
        name: 'aurabot_task_status', description: '查看当前聊天的后台生图、翻唱任务进度。可填任务编号。',
        properties: { id: str('可选任务编号') }, required: [],
        execute: async ({ id }) => {
          const items = id ? [find(id)].filter(Boolean) : [...records.values()].filter((item) => item.chatId === chatId).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)
          return { ok: true, message: items.map(describe).join('\n') || '这里没有找到该任务' }
        },
      }),
      defineTool({
        name: 'aurabot_task_cancel', description: '当前聊天的请求者明确要求停止生图或翻唱时，按编号取消任务。',
        properties: { id: str('任务编号') }, required: ['id'],
        execute: async ({ id }) => {
          const item = find(id)
          if (!item) return { ok: false, message: '这里没有找到该任务' }
          const speakers = requesters()
          if (!speakers.length || !speakers.every((speaker) => item.requesters.includes(speaker))) return { ok: false, message: '请由发起任务的人确认取消' }
          if (item.state === 'queued') {
            update(item, 'cancelled')
            waiting.delete(item.id)
          } else if (item.state === 'running') {
            update(item, 'cancelling')
            running.get(item.kind)?.abort(new Error('任务已取消'))
          }
          return { ok: item.state === 'cancelling' || item.state === 'cancelled', message: describe(item) }
        },
      }),
    ]
  }

  return { start, tools, dispose() {
    closed = true
    waiting.clear()
    for (const controller of running.values()) controller.abort(new Error('后台任务服务已关闭'))
  } }
}
