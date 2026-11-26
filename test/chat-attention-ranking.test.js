// 单一注意力的排序与放行：管理员优先、私聊次之、其次先来先服务。
// 这段逻辑原来埋在 hub.js 里（40 多个共享状态中间），现在搬进 attention.js，直接测。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAttentionRanking } from '../src/chat/attention.js'

function setup({ single = true, ownerCuts = false, busyKeys = [] } = {}) {
  const attentionQueue = new Map()
  const busy = new Map(busyKeys.map((k) => [k, 1]))
  const pending = new Map()
  const flushed = []
  const ranking = createAttentionRanking({
    ownerIn: (p) => Boolean(p?.owner),
    getConfig: () => ({}),
    getMind: () => ({ attention: () => ({ single, ownerCuts }) }),
    attentionQueue, busy, pending,
    flush: (id) => flushed.push(id),
    isBusy: (k) => busy.has(k),
    isDisposed: () => false,
  })
  return { ranking, attentionQueue, busy, pending, flushed }
}

test('优先级：管理员 3 > 私聊 2 > 必须回 1 > 普通 0', () => {
  const { ranking } = setup()
  assert.equal(ranking.priority('g1', { owner: true, chat: { kind: 'group' } }), 3)
  assert.equal(ranking.priority('p1', { chat: { kind: 'private' } }), 2)
  assert.equal(ranking.priority('g2', { chat: { kind: 'group' }, mustReply: true }), 1)
  assert.equal(ranking.priority('g3', { chat: { kind: 'group' } }), 0)
})

test('单一注意力关着时不压任何聊天', () => {
  const { ranking, pending, busy } = setup({ single: false })
  pending.set('other', {})
  busy.set('other', 1)
  assert.equal(ranking.blocked('g1', { chat: { kind: 'group' } }), false)
})

test('开着时别的聊天正在回就压住；system:* 不算占用', () => {
  const { ranking, busy } = setup({ single: true })
  busy.set('other', 1)
  assert.equal(ranking.blocked('g1', { chat: { kind: 'group' } }), true)
  const s = setup({ single: true })
  s.busy.set('system:watchdog', 1)
  assert.equal(s.ranking.blocked('g1', { chat: { kind: 'group' } }), false)
})

test('管理员来消息（ownerCuts）不受单一注意力限制', () => {
  const { ranking, busy } = setup({ single: true, ownerCuts: true })
  busy.set('other', 1)
  assert.equal(ranking.blocked('g1', { owner: true, chat: { kind: 'group' } }), false)
})

test('放行顺序：管理员优先，其次按到达时间', () => {
  const { ranking, attentionQueue, pending, flushed } = setup({ single: true })
  pending.set('gA', { waiting: true })
  pending.set('gB', { waiting: true })
  pending.set('pC', { waiting: true })
  attentionQueue.set('gA', { at: 1, priority: 1 })
  attentionQueue.set('gB', { at: 2, priority: 1 })
  attentionQueue.set('pC', { at: 3, priority: 2 })
  ranking.drain()
  assert.deepEqual(flushed, ['pC'], '私聊优先级最高，先放它')
  assert.equal(pending.get('pC').waiting, false, '放行后要清掉等待标记')
  assert.deepEqual([...attentionQueue.keys()].sort(), ['gA', 'gB'], '没轮到的继续排队')
})

test('还有聊天在回复时不放行', () => {
  const { ranking, attentionQueue, pending, flushed, busy } = setup({ single: false })
  pending.set('gA', { waiting: true })
  attentionQueue.set('gA', { at: 1, priority: 0 })
  busy.set('other', 1)
  ranking.drain()
  assert.deepEqual(flushed, [])
})
