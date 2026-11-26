// 群聊图片入队这条路的直接测试。
// 线上故障：hub 漏传 pending → addGroupImages 第一行 `pending.get(...)` 抛
// `Cannot read properties of undefined (reading 'get')`，整条群消息被丢掉。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGroupContext } from '../src/chat/group-context.js'

function makeCtx({ images = [], animated = false } = {}) {
  const pending = new Map()
  const groupBuf = new Map()
  const ctx = createGroupContext({
    IMAGE_SOURCE_PREFIX: '【下一张图的来源】',
    MAX_MESSAGE_IMAGES: 4,
    animatedNote: () => (animated ? '这是一张动图' : ''),
    canSeeFor: async () => true,
    engagedHint: () => '',
    groupBuf,
    groupEngagedRun: new Map(),
    groupKey: (id) => String(id),
    groupName: () => '',
    groupRefs: () => [],
    imagesOf: async () => images,
    indentBody: (s) => s,
    inlineLabel: (s) => s,
    log: { debug() {}, info() {}, warn() {} },
    pickAutoReply: () => null,
    quoteImages: () => [],
    quoteInline: (s) => s,
    quoteWho: () => '',
    quotedInfo: () => null,
    sameNameNote: () => '',
    senderLabel: () => '管理员本人',
    pending,
  })
  return { ctx, pending }
}

test('addGroupImages：把图放进这个聊天的待发队列，并标记录 mediaPending', async () => {
  const img = { data: Buffer.from('x'), mediaType: 'image/png' }
  const { ctx, pending } = makeCtx({ images: [img] })
  const p = { chat: { chatId: 'group:1', kind: 'group' }, images: [] }
  pending.set('group:1', p)
  const entry = {}
  await ctx.addGroupImages({ chatId: 'group:1', messageId: 'm1' }, entry)
  assert.equal(p.images.length, 1)
  assert.equal(p.images[0].type, 'image')
  assert.equal(entry.mediaPending, true)
})

test('addGroupImages：这个聊天没有待发队列时安静返回（不抛）', async () => {
  const { ctx } = makeCtx({ images: [{ data: Buffer.from('x'), mediaType: 'image/png' }] })
  await assert.doesNotReject(() => ctx.addGroupImages({ chatId: 'group:none', messageId: 'm1' }, null))
})

test('addGroupImages：已经到上限就不再塞图', async () => {
  const img = { data: Buffer.from('x'), mediaType: 'image/png' }
  const { ctx, pending } = makeCtx({ images: [img] })
  const p = { chat: { chatId: 'group:2', kind: 'group' }, images: [{}, {}, {}, {}] }
  pending.set('group:2', p)
  await ctx.addGroupImages({ chatId: 'group:2', messageId: 'm2' }, {})
  assert.equal(p.images.length, 4, '上限 4，不能再加')
})
