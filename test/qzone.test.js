import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.AURABOT_DATA_DIR = mkdtempSync(join(tmpdir(), 'aurabot-qzone-'))

const { createQzone } = await import('../src/channels/qq/features/diary/qzone.js')
const { dataDir, readJson, writeJson } = await import('../src/core/store.js')
const { default: qzoneSocial } = await import('../src/channels/qq/features/qzone-social/index.js')
const { default: diary } = await import('../src/channels/qq/features/diary/index.js')

const noopLog = { info() {}, warn() {} }
const hub = { chatLogOf: () => [] }
const config = { enabled: true, dryRun: false, diary: { visibility: 'all', minChars: 60, maxChars: 140 } }

/** 一个记录调用的假 OneBot：responses 按顺序回给每次 call。 */
function mockOnebot(responses = [], { fail = null } = {}) {
  const calls = []
  return {
    calls,
    async call(action, params, opts) {
      calls.push({ action, params, opts })
      if (fail) throw fail
      const next = responses.shift()
      if (next instanceof Error) throw next
      return next
    },
  }
}

function seed(history) {
  writeJson(dataDir('diary.json'), { plan: { day: '', times: [], done: [] }, history })
}

function qzoneWith(onebot) {
  return createQzone({ getConfig: () => config, onebot, hub, log: noopLog })
}

function entry(tid, extra = {}) {
  return { at: Date.now() - 60_000, text: '写了一条', ok: true, tid, dryRun: false, visibility: 'all', error: '', ...extra }
}

test('试运行时发说说工具如实报告模拟，网关无作品 ID 时不会造一个', async () => {
  const onebot = mockOnebot([{}])
  let register
  diary.setup({
    config: () => ({ ...config, dryRun: true }), core: { hub, onebot }, log: noopLog, dataDir,
    onDispose() {}, every() {}, rule() {}, route() {}, tool(fn) { register = fn },
  })
  const tool = register({ chat: { kind: 'private' }, level: 'full' })
  const simulated = await tool.execute({ content: '今天去看了晚霞' })
  assert.equal(simulated.sent, false)
  assert.match(simulated.message, /未发布/)
  assert.equal(onebot.calls.length, 0)
  const posted = await qzoneWith(onebot).post('今天去看了晚霞')
  assert.equal(posted.ok, true)
  assert.equal(posted.tid, '')
})

test('空间日记配图发布结果不确定时，不再以纯文字重发', async () => {
  seed([])
  const onebot = mockOnebot([Object.assign(new Error('超时'), { uncertain: true }), { tid: 'duplicate' }])
  const picture = dataDir('diary-test.jpg')
  writeFileSync(picture, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  const qzone = createQzone({
    getConfig: () => ({ ...config, diary: { ...config.diary, visibility: 'self', attachImage: true } }),
    onebot, hub: { runSystemTurn: async () => '今晚喝了一杯热茶。' }, log: noopLog,
    pickImage: async () => picture,
  })
  const result = await qzone.writeDiary()
  assert.equal(result.uncertain, true)
  assert.match(result.message, /未确认/)
  assert.equal(onebot.calls.length, 1)
  assert.equal(onebot.calls[0].params.images?.length, 1)
})

test('remove：删除成功后把本地记录标记为已删除', async () => {
  seed([entry('t1'), entry('t2')])
  const onebot = mockOnebot([{ tid: 't1' }])
  const qzone = qzoneWith(onebot)

  await qzone.remove('t1')

  assert.equal(onebot.calls[0].action, 'delete_qzone_msg')
  assert.equal(onebot.calls[0].params.tid, 't1', 'tid 以字符串形式交给 OneBot')
  const saved = readJson(dataDir('diary.json'), () => ({}))
  assert.ok(saved.history[0].deletedAt, '被删的那条有 deletedAt')
  assert.equal(saved.history[1].deletedAt, undefined, '别的不动')
})

test('remove：缺 tid 直接报错，不调用 OneBot', async () => {
  seed([])
  const onebot = mockOnebot([])
  const qzone = qzoneWith(onebot)
  await assert.rejects(() => qzone.remove('  '), /缺少说说 ID/)
  assert.equal(onebot.calls.length, 0)
})

test('syncHistory：完整读到列表时，把空间里没有的记录判为已删除', async () => {
  seed([entry('keep'), entry('gone')])
  const onebot = mockOnebot([{ total: 2, msglist: [{ tid: 'keep' }, { tid: 'other' }] }])
  const qzone = qzoneWith(onebot)

  const result = await qzone.syncHistory()

  assert.equal(result.ok, true)
  assert.equal(result.warning, undefined)
  const saved = readJson(dataDir('diary.json'), () => ({}))
  const byTid = Object.fromEntries(saved.history.map((d) => [d.tid, d]))
  assert.ok(byTid.keep.remoteCheckedAt, '还在的记录写入核对时间')
  assert.equal(byTid.keep.deletedAt, undefined)
  assert.ok(byTid.gone.deletedAt, '空间里没有的记录标记为已删除')
  assert.equal(byTid.gone.deletedSource, 'space-list')
})

test('syncHistory：按 30 一页翻到完整（46 = 30+16），不假设网关按请求页大小给', async () => {
  seed([entry('keep'), entry('gone')])
  const onebot = mockOnebot([
    { total: 46, msglist: Array.from({ length: 30 }, (_, i) => ({ tid: 'a' + i })) },
    { total: 46, msglist: Array.from({ length: 16 }, (_, i) => ({ tid: 'b' + i })) },
  ])
  const qzone = qzoneWith(onebot)

  const result = await qzone.syncHistory()

  assert.equal(result.ok, true)
  assert.equal(result.warning, undefined, '翻到总数后不应再报未完整读取')
  assert.deepEqual(onebot.calls.map((c) => [c.params.pos, c.params.num]), [[0, 30], [30, 30]], '请求页大小 30、按实际返回条数推进')
  const saved = readJson(dataDir('diary.json'), () => ({}))
  const byTid = Object.fromEntries(saved.history.map((d) => [d.tid, d]))
  assert.ok(byTid.gone.deletedAt, '完整读取后，空间里没有的记录判为已删除')
})

test('syncHistory：网关把页截得更短（每页只有 10 条）也能翻全', async () => {
  seed([entry('keep')])
  const pages = [10, 10, 10, 6].map((n, p) => ({ total: 36, msglist: Array.from({ length: n }, (_, i) => ({ tid: 'p' + p + '-' + i })) }))
  const onebot = mockOnebot(pages)
  const qzone = qzoneWith(onebot)

  const result = await qzone.syncHistory()

  assert.equal(result.ok, true)
  assert.equal(result.warning, undefined)
  assert.equal(onebot.calls.length, 4, '按实际返回条数推进 pos，不会因为页短就提前停')
})

test('syncHistory：网关反复返回同一页（没有新 id）时停止，只提示、不改记录', async () => {
  seed([entry('keep'), entry('maybe')])
  // 网关忽略 pos、永远返回同样的 30 条（total 说 250）→ 不能判定缺失
  const same = { total: 250, msglist: Array.from({ length: 30 }, (_, i) => ({ tid: 'a' + i })) }
  const onebot = mockOnebot(Array.from({ length: 10 }, () => same))
  const qzone = qzoneWith(onebot)

  const result = await qzone.syncHistory()

  assert.equal(result.ok, true)
  assert.match(result.warning, /未完整读取/)
  assert.equal(onebot.calls.length, 2, '第二页没有新 id 就停，不会无限翻')
  const saved = readJson(dataDir('diary.json'), () => ({}))
  assert.equal(saved.history[1].deletedAt, undefined, '读不全时绝不标记删除')
})

test('syncHistory：分页期间 total 变化时放弃判定', async () => {
  seed([entry('maybe')])
  const onebot = mockOnebot([
    { total: 150, msglist: Array.from({ length: 30 }, (_, i) => ({ tid: 'a' + i })) },
    { total: 160, msglist: Array.from({ length: 30 }, (_, i) => ({ tid: 'b' + i })) },
  ])
  const qzone = qzoneWith(onebot)

  const result = await qzone.syncHistory()

  assert.equal(result.ok, false)
  assert.match(result.warning, /正在变化/)
  const saved = readJson(dataDir('diary.json'), () => ({}))
  assert.equal(saved.history[0].deletedAt, undefined)
})

test('syncHistory：接口报错时保留记录并给出原因', async () => {
  seed([entry('keep')])
  const onebot = mockOnebot([], { fail: new Error('连接断开') })
  const qzone = qzoneWith(onebot)

  const result = await qzone.syncHistory()

  assert.equal(result.ok, false)
  assert.match(result.warning, /连接断开/)
  assert.match(result.warning, /保留原有记录/)
})

test('syncHistory：没有可对账的记录时直接返回，不发请求', async () => {
  seed([entry('dry', { dryRun: true }), entry('', { ok: false }), entry('del', { deletedAt: 1 })])
  const onebot = mockOnebot([])
  const qzone = qzoneWith(onebot)

  const result = await qzone.syncHistory()

  assert.equal(result.ok, true)
  assert.equal(onebot.calls.length, 0)
})

test('syncHistory：并发调用共用同一次对账', async () => {
  seed([entry('keep')])
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const calls = []
  const onebot = {
    async call(action, params) {
      calls.push(action)
      await gate
      return { total: 1, msglist: [{ tid: 'keep' }] }
    },
  }
  const qzone = qzoneWith(onebot)

  const a = qzone.syncHistory()
  const b = qzone.syncHistory()
  assert.equal(a, b, '第二次调用复用第一次的 Promise')
  release()
  await Promise.all([a, b])
  assert.equal(calls.length, 1)
})

test('主动发布按心智时区、上限和间隔判断，旧随机排期不参与', () => {
  const cfg = { ...config, diary: { ...config.diary, enabled: true, timesPerDay: 2, windowStart: '10:00', windowEnd: '23:30', minGapMinutes: 180 } }
  const at = Date.parse('2026-11-14T11:55:00+08:00')
  const qzone = createQzone({ getConfig: () => cfg, hub, log: noopLog, timezone: () => 'Asia/Shanghai' })
  seed([entry('sent', { at: at - 3600000 }), entry('', { at, ok: false }), entry('', { at, dryRun: true })])
  assert.match(qzone.automaticStatus(at - 2 * 3600000).reason, /等待发布时段/)
  assert.match(qzone.automaticStatus(at).reason, /还差 120 分钟/)
  assert.deepEqual(qzone.automaticStatus(at + 2 * 3600000), { available: true, reason: '', count: 1, limit: 2 })
  cfg.diary.timesPerDay = 1
  assert.match(qzone.automaticStatus(at).reason, /发布上限/)
  cfg.diary.timesPerDay = 0
  assert.match(qzone.automaticStatus(at).reason, /设为 0/)
  assert.equal(qzone.nextTime(), '')
})

test('主动日记在发布前复查设置，成功时才留下实际发布记录', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-14T11:55:00+08:00'))
  const cfg = { ...config, diary: { ...config.diary, enabled: true, timesPerDay: 2, windowStart: '10:00', windowEnd: '23:30', minGapMinutes: 180 } }
  const onebot = mockOnebot([{ tid: 'mock-post' }])
  const qzone = createQzone({ getConfig: () => cfg, onebot, hub: { runSystemTurn: async () => '今天想留一点空白给自己。' }, log: noopLog, timezone: () => 'Asia/Shanghai' })
  seed([])
  const blocked = await qzone.writeDiary({ automatic: true, checkpoint: () => { cfg.diary.timesPerDay = 0 } })
  assert.match(blocked.message, /设为 0/)
  assert.equal(onebot.calls.length, 0)
  cfg.diary.timesPerDay = 2
  assert.equal((await qzone.writeDiary({ automatic: true })).tid, 'mock-post')
  assert.deepEqual(onebot.calls.map((x) => x.action), ['send_qzone_msg'])
  assert.equal(qzone.automaticStatus().count, 1)
  assert.match(qzone.automaticStatus().reason, /距离上次发布/)
})

test('空闲检查空间新评论无需逛好友空间，预算中断后继续未处理的评论', async (t) => {
  let at = Date.parse('2026-11-14T11:55:00+08:00')
  t.mock.method(Date, 'now', () => at)
  const ids = ['c1', 'c2']
  const calls = []
  const comments = ids.map((comment_id, i) => ({ comment_id, name: '访客' + i, uin: 10001 + i, content: '你好', time: at / 1000 - 3, replies: [] }))
  const cfg = { enabled: true, dryRun: false, qzoneSocial: { enabled: true, replyOwn: true, commentFriends: true, maxPerDay: 8 } }
  const onebot = { async call(action, data) {
    calls.push({ action, data })
    if (action === 'get_qzone_msg_list') return { msglist: [{ tid: 'mine', comment_num: 2, time: at / 1000 }] }
    if (action === 'get_qzone_msg_detail') return { comments }
    if (action !== 'comment_qzone') assert.fail(action)
  } }
  let allowed = false
  let rounds = 0
  const hub = { selfId: '10000', async runSystemTurn() {
    if (++rounds === 2) throw Object.assign(new Error('预算不足'), { code: 'BUDGET' })
    return '你好呀'
  } }
  let scheduled
  let action
  const social = qzoneSocial.setup({
    config: () => cfg, core: { hub, onebot }, log: noopLog, route() {},
    every: (_ms, run) => { scheduled = run },
    mind: { offer: (def) => { action = def }, checkSpaceReplies: async (run) => { if (allowed) await run({ checkpoint: async () => {} }) } },
  })
  assert.equal(action.id, 'social')
  await scheduled()
  assert.equal(calls.length, 0)
  allowed = true
  await scheduled()
  assert.equal(social.state().count, 1)
  assert.equal(social.state().lastRun, 0)
  assert.equal(social.state().lastReplyCheck, at)
  await scheduled()
  assert.equal(rounds, 2)
  at += 5 * 60000
  await scheduled()
  assert.equal(social.state().count, 2)
  assert.deepEqual(calls.filter((call) => call.action === 'comment_qzone').map((call) => call.data.content), ['回复 访客0：你好呀', '回复 访客1：你好呀'])
})
