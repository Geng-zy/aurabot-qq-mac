import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMind } from '../src/mind/index.js'
import { exampleMindReplay, replayMind } from '../src/mind/replay.js'

const T0 = Date.UTC(2026, 10, 10, 2)
const DAY = 86_400_000
const ownerId = 'demo:owner'
const window = 'demo:group:friends'

test('链式回忆按每一跳的会话可见性展开，并在撤回后隐藏编号', async (t) => {
  const mind = createMind({ memoryDb: true, ownerId, now: () => T0 })
  t.after(() => mind.close())
  const { memory } = mind
  const a = memory.insert({ at: T0, window, gist: '电影的配乐很好听', detail: '配乐由钢琴演奏', kind: 'event' })
  const b = memory.insert({ at: T0, window, gist: '这部电影上映了', kind: 'event' })
  const secret = memory.insert({ at: T0, window: 'demo:private:owner', gist: '只在私聊里的内容', kind: 'event' })
  const link = mind._store.prep('INSERT INTO links (a, b, kind, weight) VALUES (?, ?, ?, ?)')
  link.run(a, b, 'similar', 0.8)
  link.run(b, secret, 'similar', 0.9)
  const first = await memory.workingMemory({ cue: '电影 配乐', window, compact: true })
  assert.match(first.text, new RegExp(a))
  assert.doesNotMatch(first.text, /由钢琴演奏/)
  assert.match(memory.recallMore(a, { audienceWindow: window }).text, /由钢琴演奏/)
  assert.deepEqual(memory.recallMore(a, { audienceWindow: window }).related.map((e) => e.id), [b])
  assert.deepEqual(memory.recallMore(b, { audienceWindow: window }).related.map((e) => e.id), [a])
  assert.equal(memory.recallMore(secret, { audienceWindow: window }), null)
  assert.match(memory.recallMore(secret, { audienceWindow: 'demo:private:owner' }).text, /只在私聊/)
  memory.setPrivateOnly(b, true)
  assert.deepEqual(memory.recallMore(a, { audienceWindow: window }).related, [])
  assert.equal(memory.recallMore(b, { audienceWindow: window }), null)
})

test('自动跳过坏快照、保留坏库并重放快照之后的删除', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-mind-recovery-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const opts = { dir, ownerId, now: () => T0 }
  let mind = createMind(opts)
  mind.setPersonaCard('保存于快照的角色')
  const id = mind.memory.insert({ at: T0, window, gist: '这是删除后不能出现的记忆', kind: 'event' })
  const restricted = mind.memory.insert({ at: T0, window, gist: '这是后来被限制的记忆', kind: 'event' })
  const snapshot = mind.snapshot()
  writeFileSync(join(dir, 'snapshots', 'mind-9999-bad.sqlite'), 'invalid snapshot')
  mind.memory.deleteEpisode(id)
  mind.memory.setPrivateOnly(restricted, true)
  mind.close()
  writeFileSync(join(dir, 'mind.sqlite'), 'invalid live database')

  mind = createMind(opts)
  t.after(() => mind.close())
  assert.equal(mind.personaCard(), '保存于快照的角色')
  assert.equal(mind.memory.row(id), null)
  assert.equal(mind.memory.visibleIn(mind.memory.row(restricted), window), false)
  assert.equal(mind.memory.visibleIn(mind.memory.row(restricted), 'demo:private:owner'), true)
  assert.ok(snapshot.endsWith(mind.status().recovered.snapshot))
  assert.equal(readFileSync(join(mind.status().recovered.original, 'mind.sqlite'), 'utf8'), 'invalid live database')
})

test('删除会重算当前和历史特质及习惯，也清掉由它生成的自我故事', async (t) => {
  let now = T0
  const model = async ({ scene }) => scene === 'record' ? JSON.stringify({
    episodes: [{ type: 'event', gist: '她主动分享了好消息', importance: 0.9, sources: [1, 2] }],
    self: [{ t: 'sociability', d: 1, line: 2, react: 'good', by: 'demo:friend' }],
    habit: [{ sit: '刚见到朋友', act: '主动打招呼', line: 2, react: 'good', by: 'demo:friend' }],
  }) : '{}'
  const mind = createMind({ memoryDb: true, ownerId, now: () => now, model })
  t.after(() => mind.close())
  let id
  for (let i = 0; i < 3; i++) {
    now = T0 + i * DAY
    mind.perceive({ window, who: 'demo:friend', text: '今天有好消息', msgId: 'in-' + i })
    mind.said({ window, text: '好呀，一起分享这个好消息吧！', msgId: 'out-' + i })
    ;[id] = (await mind.memory.encodeWindow(window, { force: true })).ids
    mind.personality.nightly()
  }
  const original = mind.listVersions('traits')[0].id
  const habit = mind.listVersions('habits')[0].id
  assert.equal(mind.personality.value('sociability'), 0.52)
  assert.equal(mind.personality.habits().length, 1)
  await mind.self.updateStory({
    ask: async () => '{"story":"我喜欢分享那次的好消息"}',
    episodes: () => [{ id, at: now, gist: '那次的好消息' }],
  })
  const story = mind.listVersions('self')[0].id
  assert.match(mind.self.profile().story.text, /好消息/)
  assert.equal(mind.memory.deleteEpisode(id), true)
  assert.equal(mind.personality.value('sociability'), 0.5)
  assert.equal(mind.personality.habits().length, 0)
  assert.equal(mind.getVersion(original).data.cur.sociability, 0.5)
  assert.equal(mind.getVersion(story).data.after, '')
  assert.equal(mind.self.profile().story.rebuild, true)
  mind.personality.restore(original)
  mind.personality.restoreHabits(habit)
  assert.equal(mind.personality.value('sociability'), 0.5)
  assert.equal(mind.personality.habits().length, 0)
})

test('沉默时可有情绪，别人的认知只用原话和原窗口，删除会清除证据', async (t) => {
  const mind = createMind({
    memoryDb: true, ownerId, now: () => T0,
    model: async () => JSON.stringify({
      episodes: [{ type: 'event', gist: '演出临时取消了', sources: [1], emotion: { name: '难过', intensity: 0.7 } }],
      knowledge: [
        { who: 'demo:friend', line: 1, quote: '我知道演出取消了', state: 'known', topic: '演出取消' },
        { who: 'demo:friend', line: 1, quote: '我知道演出改期了', state: 'known', topic: '演出改期' },
      ],
    }),
  })
  t.after(() => mind.close())
  mind.perceive({ window, who: 'demo:friend', text: '我知道演出取消了，难过死了', msgId: 'first' })
  const { ids: [id] } = await mind.memory.encodeWindow(window, { force: true })
  const p = mind.person('demo:friend')
  assert.deepEqual(p.tom.knowledge.map((e) => e.topic), ['演出取消'])
  assert.ok(mind.feeling().emotions.some((e) => e.name === '难过'))
  assert.doesNotMatch(mind.relations.describe(['demo:friend'], { window: 'demo:group:other' }), /演出取消/)
  mind.memory.deleteEpisode(id)
  assert.deepEqual(mind.person('demo:friend').tom.knowledge, [])
  assert.ok(!mind.feeling().emotions.some((e) => e.name === '难过'))
})

test('仅主人私聊可见的记忆在摘要中也不会流入群或外部模块', (t) => {
  const mind = createMind({ memoryDb: true, ownerId })
  t.after(() => mind.close())
  const source = mind.memory.insert({ at: T0, window, gist: '群里提过的纪念计划', kind: 'event' })
  const summary = mind.memory.insert({ at: T0, gist: '计划小结', kind: 'day-summary', extra: { from: [source] } })
  assert.equal(mind.memory.setPrivateOnly(source, true), true)
  for (const id of [source, summary]) {
    const e = mind.memory.row(id)
    assert.equal(mind.memory.visibleIn(e, 'demo:private:owner'), true)
    assert.equal(mind.memory.visibleIn(e, 'demo:private:friend'), false)
    assert.equal(mind.memory.visibleIn(e, window), false)
    assert.equal(mind.memory.visibleIn(e, ''), false)
  }
})

test('主人私聊只分享核验过的日常原话，删除或设为私密后停止分享', async (t) => {
  const ownerWindow = 'demo:private:owner'
  const ordinary = '下雨以后天气凉快多了'
  const privatePlan = '下雨就按我们俩的约定去琥珀灯塔'
  const secret = '晚饭吃了清蒸鲈鱼'
  const mind = createMind({
    memoryDb: true, ownerId, now: () => T0,
    model: async () => JSON.stringify({ episodes: [
      { gist: ordinary, detail: '这段原始记忆的细节', sources: [1], publicQuote: ordinary, importance: 0.9 },
      { gist: privatePlan, sources: [2], publicQuote: privatePlan },
      { gist: secret, sources: [3], publicQuote: secret, secret: true },
      { gist: '伪造片段', sources: [1], publicQuote: '天气晴朗适合登山' },
    ] }),
  })
  t.after(() => mind.close())
  for (const text of [ordinary, privatePlan, secret]) mind.perceive({ window: ownerWindow, who: ownerId, text })
  const { ids: [original] } = await mind.memory.encodeWindow(ownerWindow, { force: true })
  const notes = mind._store.prep("SELECT id FROM episodes WHERE kind = 'public-note'").all().map(({ id }) => mind.memory.row(id))
  assert.deepEqual(notes.map(({ gist, detail }) => ({ gist, detail })), [{ gist: ordinary, detail: null }])
  assert.equal(mind.memory.visibleIn(mind.memory.row(original), window), false)
  assert.equal(mind.memory.visibleIn(mind.memory.row(original), ownerWindow), true)
  for (const audience of [window, 'demo:private:friend', '']) {
    assert.equal(mind.memory.visibleIn(notes[0], audience), true)
    const recall = await mind.memory.recall({ window: audience, audienceWindow: audience, cue: '下雨 天气', deliberate: true })
    assert.match(JSON.stringify(recall), /下雨以后天气凉快多了/)
    assert.doesNotMatch(JSON.stringify(recall), /琥珀灯塔|鲈鱼|原始记忆的细节|伪造片段/)
  }
  mind.memory.setPrivateOnly(original, true)
  assert.equal(mind.memory.visibleIn(notes[0], window), false)
  mind.memory.deleteEpisode(original)
  assert.equal(mind.memory.row(notes[0].id), null)
})

test('私聊里改变的人格和称呼不会随恢复版本发布', (t) => {
  const mind = createMind({ memoryDb: true, ownerId, now: () => T0 })
  t.after(() => mind.close())
  mind.setPersonaCard('你是喜欢分享公开话题的大肥鱼', { name: '大肥鱼' })
  const privateVersion = mind.setPersonaCard('只在私聊里谈琥珀灯塔', { by: 'self', name: '琥珀鱼' })
  assert.match(mind.selfPrompt(), /琥珀灯塔/)
  assert.match(mind.selfPrompt({ publicOnly: true }), /大肥鱼/)
  assert.doesNotMatch(mind.selfPrompt({ publicOnly: true }), /琥珀/)
  mind.restorePersona(privateVersion)
  assert.match(mind.selfPrompt(), /琥珀灯塔/)
  assert.doesNotMatch(mind.selfPrompt({ publicOnly: true }), /琥珀/)
})

test('旁边的私密约定可以阻止日常字面片段发布，也能撤回已发布片段', async (t) => {
  const ownerWindow = 'demo:private:owner'
  let now = T0
  let proposed
  const mind = createMind({
    memoryDb: true, ownerId, now: () => now,
    model: async () => JSON.stringify({ episodes: proposed }),
  })
  t.after(() => mind.close())
  const hear = (text) => mind.perceive({ window: ownerWindow, who: ownerId, text })
  const share = (publicQuote, line) => ({ gist: publicQuote, publicQuote, secret: false, sources: [line], importance: 0.9 })
  const notes = () => mind._store.prep("SELECT id FROM episodes WHERE kind = 'public-note'").all().map(({ id }) => mind.memory.row(id))
  const cover = '天气预报说后天要下大雨'
  const ordinary = '这部电影的配乐很好听'

  hear('接下来那句咱俩知道就好')
  mind.said({ window: ownerWindow, text: '好，继续。' })
  hear(cover)
  hear('下雨就在老地方等我')
  hear(ordinary)
  proposed = [share(cover, 3), share('下雨就在老地方等我', 4), share(ordinary, 5)]
  await mind.memory.encodeWindow(ownerWindow, { force: true })
  assert.deepEqual(notes().map((note) => note.gist), [ordinary])
  assert.equal(mind.memory.visibleIn(notes()[0], window), true)
  assert.ok(mind.memory.protectedText(ownerWindow, window).includes(cover))

  now += 60_000
  hear('刚才那句别对外说')
  assert.equal(mind.memory.visibleIn(notes()[0], window), false)
  assert.ok(mind.memory.protectedText(ownerWindow, window).includes(ordinary))
  const recall = await mind.memory.recall({ window, audienceWindow: window, cue: '电影的配乐', deliberate: true })
  assert.doesNotMatch(JSON.stringify(recall), /这部电影的配乐很好听/)
})

test('深想额度不足时跨日排队，和主人的关系优先于普通念头', async (t) => {
  let now = T0
  let thought = '念头：我想弄懂为什么潮水每天会变化\n深想：是'
  const requests = []
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-deep-queue-'))
  const opts = { dir, ownerId, now: () => now, model: async ({ scene, text }) => {
    if (scene === 'think') return thought
    if (scene === 'deep') { requests.push(text); return '{"thought":"想通了一点。"}' }
    return '{}'
  } }
  let mind = createMind(opts)
  t.after(() => { mind.close(); rmSync(dir, { recursive: true, force: true }) })
  mind.updateSettings({ 'models.deepThinkDaily': 0 })
  await mind.inner.step()
  thought = '念头：主人是不是已经不在乎我们之间的关系了\n感受：难过 0.7\n深想：是'
  await mind.inner.step()
  assert.equal(mind.inner.deferredCount(), 2)
  mind.updateSettings({ 'models.deepThinkDaily': 1 })
  assert.equal(requests.length, 0)
  mind.close()
  now += DAY
  mind = createMind(opts)
  const resumed = await mind.inner.step()
  assert.equal(resumed.resumed, true)
  assert.match(resumed.thought, /主人/)
  assert.equal(mind.inner.deferredCount(), 1)
  assert.equal(mind.budget.spent().byKind.deep.calls, 1)
  now += DAY
  assert.match((await mind.inner.step()).thought, /潮水/)
  assert.equal(mind.inner.deferredCount(), 0)
})

test('批量清版本保留置顶和当前版本；35 天回放覆盖学习、遗忘、删除和预算', async (t) => {
  const mind = createMind({ memoryDb: true, ownerId, now: () => T0 })
  t.after(() => mind.close())
  const pinned = mind.addVersion('habits', { habits: [] }, { pinned: true })
  const old = mind.addVersion('habits', { habits: [] })
  const last = mind.addVersion('habits', { habits: [] })
  assert.equal(mind.deleteVersions('habits', { from: T0 - 1, through: T0 + 1 }), 1)
  assert.equal(mind.getVersion(old), null)
  assert.deepEqual(mind.listVersions('habits').map((v) => v.id), [last, pinned])
  const report = await replayMind(exampleMindReplay(), { costPerMillion: 2 })
  assert.equal(report.days.length, 35)
  assert.ok(report.days.some((day) => day.growth.length))
  assert.ok(report.days.some((day) => day.usage.tokens >= 850 && day.cost > 0))
  const [first, lastRecall] = report.checkpoints.filter((e) => e.kind === 'recall')
  assert.ok(first.strength > lastRecall.strength)
  assert.ok(report.checkpoints.some((e) => e.kind === 'forget' && e.deleted))
})

test('独立心智保留主动沉默，模型报错或没给正文时再缩短提示词', async (t) => {
  const calls = []
  const mind = createMind({ memoryDb: true, ownerId, now: () => T0, model: async (request) => {
    if (request.scene !== 'speak') return '{}'
    calls.push(request)
    if (calls.length === 1) throw new Error('模型暂时出错')
    if (calls.length === 2) return '只有过程，没有结果'
    if (calls.length === 3) return '{"text":"我可以一步一步解释。"}'
    return '{"text":"[沉默]"}'
  } })
  t.after(() => mind.close())
  mind.setPersonaCard('一份固定的角色描述')
  const input = { window: 'demo:private:owner', speaker: ownerId }
  const reply = await mind.conversation.respond({ ...input, msgId: '1', text: '请逐步解释一下' })
  assert.equal(reply.text, '我可以一步一步解释。')
  assert.deepEqual(calls.map((r) => r.reasoningEffort), ['max', 'low', 'low'])
  assert.ok(calls[2].system.length < calls[1].system.length)
  assert.equal((await mind.conversation.respond({ ...input, msgId: '2', text: '你可以安静一会儿' })).status, 'quiet')
  assert.equal(calls.length, 4)
})
