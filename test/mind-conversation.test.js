import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMind } from '../src/mind/index.js'

const NOW = Date.UTC(2026, 10, 12, 6)
const WINDOW = 'local:private:friend'
const SPEAKER = 'local:friend'

const evaluation = (evidence, fields = {}) => JSON.stringify({
  e: evidence, v: [4, -3, 1, 1, 2, 0], ...fields,
})

test('独立核心：先评价和决定表达意图，再生成草稿，投递后才记为说过', async (t) => {
  const calls = []
  const message = '我可能没法按原计划回来'
  const mind = createMind({
    memoryDb: true, now: () => NOW,
    model: async (request) => {
      calls.push(request)
      if (request.scene === 'appraisal') return evaluation(JSON.parse(request.text).event)
      return '{"text":"还不确定吗？要是计划有变，告诉我一声就好。"}'
    },
  })
  t.after(() => mind.close())
  const result = await mind.conversation.respond({ window: WINDOW, speaker: SPEAKER, text: message, msgId: 'message-1' })
  assert.equal(result.status, 'draft')
  assert.equal(result.plan.intent, 'clarify')
  assert.deepEqual(calls.map((call) => call.scene), ['appraisal', 'speak'])
  assert.match(calls[1].system, /先确认拿不准/)
  assert.equal(mind.emotion.state().active[0].name, '焦虑')
  assert.deepEqual(mind.history(WINDOW).map((entry) => entry.dir), ['in'])
  mind.said({ window: WINDOW, text: result.text, msgId: 'sent-1' })
  assert.deepEqual(mind.history(WINDOW).map((entry) => entry.dir), ['in', 'out'])
  assert.equal((await mind.conversation.respond({ window: WINDOW, speaker: SPEAKER, text: message, msgId: 'message-1' })).status, 'duplicate')
  assert.equal(calls.length, 2)
  await mind.conversation.respond({ window: WINDOW, speaker: SPEAKER, text: '嗯，第二种吧', msgId: 'message-2' })
  assert.ok(calls.at(-1).text.includes(`对方：${message}\n你：${result.text}\n\n【对方刚说】\n嗯，第二种吧`))
})

test('同一人澄清误会后重新评价，别处的情绪不受影响', async (t) => {
  const otherWindow = 'local:group:another'
  const mind = createMind({ memoryDb: true, now: () => NOW, model: async ({ text }) => {
    const { event, earlier } = JSON.parse(text)
    if (event === '我是说改到周六，约定还在') {
      assert.equal(earlier.length, 1)
      return evaluation(event, { v: [4, 3, 4, 3, 2, 0], c: 1 })
    }
    return evaluation(event)
  } })
  t.after(() => mind.close())
  // 在另一会话保留独立情绪，校验重评价只改对应事件。
  mind.emotion.feel([{ name: '焦虑', target: SPEAKER, intensity: 0.9 }], { window: otherWindow, source: 'appraisal', eventId: 'unrelated' })
  const prepare = (text) => mind.conversation.prepare({ window: WINDOW, text, people: [SPEAKER] })
  await prepare('我可能赶不上约定')
  const before = mind.emotion.state().active.find((entry) => entry.window === WINDOW)
  assert.equal(before.name, '焦虑')
  const correction = await prepare('我是说改到周六，约定还在')
  assert.equal(correction.plan.intent, 'acknowledge')
  const active = mind.emotion.state().active
  assert.equal(active.find((entry) => entry.eventId === before.eventId).intensity, before.intensity * 0.25)
  assert.ok(active.some((entry) => entry.name === '松一口气' && entry.window === WINDOW))
  assert.equal(active.find((entry) => entry.eventId === 'unrelated').intensity, 0.9)
})

test('无原话依据的评价不写入情绪，明确无关的群聊允许安静旁听', async (t) => {
  let reply = evaluation('这段文字不在事件里')
  const mind = createMind({ memoryDb: true, now: () => NOW, model: async () => reply })
  t.after(() => mind.close())
  const prepare = (text) => mind.conversation.prepare({ window: 'local:group:room', text, people: [SPEAKER], direct: false })
  assert.equal((await prepare('刚吃过饭')).appraisal, null)
  assert.deepEqual(mind.emotion.state().active, [])
  reply = evaluation('刚吃过饭', { v: [0, 0, 4, 4, 0, 0] })
  assert.equal((await prepare('刚吃过饭')).plan.speak, false)
  assert.deepEqual(mind.emotion.state().active, [])
})

test('疲劳时收窄当前注意的回忆并缩短表达', async (t) => {
  const mind = createMind({ memoryDb: true, now: () => NOW })
  t.after(() => mind.close())
  for (let i = 1; i <= 7; i++) mind.memory.insert({ at: NOW, gist: `整理相册第 ${i} 页`, kind: 'event', importance: 0.8 })
  const prepare = () => mind.conversation.prepare({ window: WINDOW, text: '整理相册', people: [SPEAKER] })
  assert.equal((await prepare()).memory.recalled.length, 4)
  mind.body.spend(0.7)
  const tired = await prepare()
  assert.equal(tired.memory.recalled.length, 2)
  assert.equal(tired.plan.length, '一两句')
})

test('忘掉一个人会清除已有的评价，未完成的评价也不会补写', async (t) => {
  let finish
  const mind = createMind({ memoryDb: true, now: () => NOW, model: ({ text }) => {
    const { event } = JSON.parse(text)
    if (event === '第一句') return Promise.resolve(evaluation(event))
    return new Promise((resolve) => { finish = () => resolve(evaluation(event)) })
  } })
  t.after(() => mind.close())
  mind.perceive({ window: WINDOW, who: SPEAKER, text: '第一句' })
  const prepare = (text) => mind.conversation.prepare({ window: WINDOW, text, people: [SPEAKER] })
  await prepare('第一句')
  assert.equal(mind.emotion.history().length, 1)
  const pending = prepare('第二句')
  mind.forgetPerson(SPEAKER, { keepPerson: true })
  finish()
  assert.equal(await pending, null)
  assert.deepEqual(mind.emotion.state().active, [])
  assert.deepEqual(mind.emotion.history(), [])
})
