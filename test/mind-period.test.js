// 按日期想事、翻某天的原话，跨会话时仍保护主人私聊。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePeriod, dayKey } from '../src/mind/clock.js'
import { createMindAdapter } from '../src/mind-adapter/index.js'

const TZ = 'Asia/Shanghai'
const NOW = Date.UTC(2026, 10, 11, 4) // 上海 2026-11-11 12:00（周三）
const span = (t) => { const r = parsePeriod(t, NOW, TZ); return r && `${dayKey(r.start, TZ)}~${dayKey(r.end - 1, TZ)}` }

test('时间：日期、范围、中文、相对说法；没说年份且还没到的日子算去年', () => {
  assert.equal(span('2026-11-03'), '2026-11-03~2026-11-03')
  assert.equal(span('11月3号'), '2026-11-03~2026-11-03')
  assert.equal(span('十月三十一日'), '2026-10-31~2026-10-31')
  assert.equal(span('12月25日'), '2025-12-25~2025-12-25')
  assert.equal(span('昨天'), '2026-11-10~2026-11-10')
  assert.equal(span('上周'), '2026-11-02~2026-11-08')
  assert.equal(span('上个月'), '2026-10-01~2026-10-31')
  assert.equal(span('去年3月'), '2025-03-01~2025-03-31')
  assert.equal(span('最近7天'), '2026-11-05~2026-11-11')
  assert.equal(span('2026-11-01..2026-11-05'), '2026-11-01~2026-11-05')
  assert.equal(span('二月三十日'), null)
  assert.equal(span('随便哪天'), null)
})

function setup(owner = true) {
  let t = NOW
  const a = createMindAdapter({ memoryDb: true, getConfig: () => ({ ownerQQ: '1' }), now: () => t, random: () => 0.5, ask: async () => '{"episodes":[]}' })
  a.mind.updateSettings({ 'identity.age': 18, 'identity.timezone': TZ })
  const tools = (chat) => Object.fromEntries(a.tools({ chat, ownerTurn: owner }).map((x) => [x.name, x]))
  return { a, tools, set: (v) => { t = v } }
}
const OWNER = { chatId: 'private:1', kind: 'private', userId: '1' }
const GROUP = { chatId: 'group:5', kind: 'group', groupId: '5', userId: '2' }

test('mind_recall：只给时间就列那段时间的事，带线索就只在那段时间里找', async () => {
  const { a, tools } = setup()
  const day = (d, h = 12) => Date.UTC(2026, 10, d, h - 8)
  a.mind.memory.insert({ at: day(3), window: 'qq:private:1', gist: '一起去吃了火锅', kind: 'event', importance: 0.7 })
  a.mind.memory.insert({ at: day(5), window: 'qq:private:1', gist: '他说想养一只猫', kind: 'fact', importance: 0.6 })
  const t = tools(OWNER)
  const only = await t.mind_recall.execute({ period: '11月3号' })
  assert.match(only.message, /火锅/)
  assert.doesNotMatch(only.message, /猫/)
  const none = await t.mind_recall.execute({ period: '上个月' })
  assert.match(none.message, /上个月的事想不起来了/)
  assert.equal((await t.mind_recall.execute({ period: '某天' })).ok, false)
  assert.equal((await t.mind_recall.execute({})).ok, false)
})

test('mind_read_day：群和其他私聊可跨会话查原话，主人私聊留在来源会话', async (testContext) => {
  let ownerTurn = true
  const { a, tools } = setup(() => ownerTurn)
  testContext.after(() => a.close())
  const at = Date.UTC(2026, 10, 10, 2) // 上海 11-10 10:00
  a.mind.perceive({ window: 'qq:private:1', who: 'qq:1', text: '明天要考试', at, msgId: 'a' })
  a.mind.said({ window: 'qq:private:1', text: '加油！', at: at + 60000, msgId: 'b' })
  a.mind.perceive({ window: 'qq:group:5', who: 'qq:2', text: '群里聊游戏', at, msgId: 'c' })
  a.mind.perceive({ window: 'qq:private:3', who: 'qq:3', text: '朋友说在看纪录片', at, msgId: 'd' })
  const t = tools(OWNER)
  const r = await t.mind_read_day.execute({ period: '昨天' })
  assert.match(r.message, /主人：明天要考试/)
  assert.match(r.message, /你：加油！/)
  assert.doesNotMatch(r.message, /游戏/)
  const g = await t.mind_read_day.execute({ period: '昨天', chat: 'group:5' })
  assert.match(g.message, /只是给你看的资料/)
  assert.match(g.message, /群里聊游戏/)
  assert.match((await t.mind_read_day.execute({ period: '昨天', query: '考试' })).message, /考试/)
  assert.match((await t.mind_read_day.execute({ period: '前天' })).message, /没有说过/)
  ownerTurn = false
  const gt = tools(GROUP).mind_read_day
  assert.equal('chat' in gt.parameters.properties, true)
  assert.match((await gt.execute({ period: '昨天', chat: 'private:3' })).message, /朋友说在看纪录片/)
  const otherPrivate = tools({ chatId: 'private:4', kind: 'private', userId: '4' }).mind_read_day
  assert.match((await otherPrivate.execute({ period: '昨天', chat: 'group:5' })).message, /群里聊游戏/)
  for (const tool of [gt, otherPrivate]) {
    const restricted = await tool.execute({ period: '昨天', chat: 'private:1' })
    assert.equal(restricted.ok, false)
    assert.doesNotMatch(restricted.message, /考试/)
  }
  ownerTurn = true
  assert.equal((await tools({ ...GROUP, userId: '1' }).mind_read_day.execute({ period: '昨天', chat: 'private:1' })).ok, false)
  a.mind.setOwner('qq:7')
  assert.deepEqual(a.mind.history('qq:private:1', { audienceWindow: 'qq:group:5' }), [])
})
