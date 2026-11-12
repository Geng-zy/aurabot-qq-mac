// 记忆：遗忘曲线、记住、想起（线索、同场合、心境一致、话到嘴边）、加强和间隔效应、前瞻记忆、
// 特意记下、删除重算、恢复后重放删除、睡觉整理（提炼、改写、变淡、归档、做梦）、预算。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMind } from '../src/mind/index.js'
import { retention, initialStability, afterRecall, levelOf } from '../src/mind/memory/curve.js'
import { createEmbedClient } from '../src/mind/memory/vectors.js'

const DAY = 86400000
const T0 = Date.UTC(2026, 10, 10, 2, 0, 0)

/** 假向量：按字计数，意思相近（字重合多）的余弦高。 */
function fakeEmbed(texts) {
  return texts.map((t) => {
    const v = new Array(256).fill(0)
    for (const ch of String(t)) v[ch.codePointAt(0) % 256] += 1
    return v
  })
}

function setup({ at = T0, think, random = () => 0.99 } = {}) {
  let t = at
  const calls = []
  const m = createMind({ memoryDb: true, now: () => t, ownerId: 'qq:1', random })
  m.memory.connect({
    embed: async (xs) => fakeEmbed(xs),
    think: async (o) => { calls.push(o); return think ? think(o) : '{"episodes":[]}' },
  })
  return { m, mem: m.memory, set: (v) => { t = v }, get: () => t, calls }
}

test('遗忘曲线：幂函数，开始快后来慢；稳定性就是九成把握的天数', () => {
  assert.ok(Math.abs(retention(2, 2 * DAY) - 0.9) < 1e-9)
  const a = retention(1, 1 * DAY) - retention(1, 2 * DAY)
  const b = retention(1, 10 * DAY) - retention(1, 11 * DAY)
  assert.ok(a > b * 3, '前面忘得快')
  assert.ok(retention(1, 1 * DAY, 0.5) < retention(1, 1 * DAY, 1), '记性差的忘得快')
  assert.ok(retention(1, 1 * DAY, 2) > retention(1, 1 * DAY, 1), '调高记性以后记得更久')
})

test('记得多牢：情绪越强、越重要、越专心、精力越好越牢', () => {
  const base = initialStability({ intensity: 0, importance: 0.5 })
  assert.ok(initialStability({ intensity: 1, importance: 0.5 }) > base * 2)
  assert.ok(initialStability({ intensity: 0, importance: 1 }) > base)
  assert.ok(initialStability({ attention: 0.3 }) < base)
  assert.ok(initialStability({ energy: 0.2 }) < base)
  assert.equal(initialStability({ intensity: 1, emotionBoost: 0 }), base, '情绪加成可以关掉')
})

test('间隔效应：隔得越久再想起，加强得越多；连着想几乎不加', () => {
  const soon = afterRecall(2, retention(2, 0.01 * DAY))
  const later = afterRecall(2, retention(2, 6 * DAY))
  assert.ok(soon < 2.2)
  assert.ok(later > soon * 2)
  assert.equal(afterRecall(2, 0.5, 0), 2, '隔开想起的加成可以关掉')
})

test('想起来的样子：清楚、大概、话到嘴边（要强线索）、想不起来', () => {
  assert.equal(levelOf(0.8, 0.5), 'clear')
  assert.equal(levelOf(0.3, 0.5), 'vague')
  assert.equal(levelOf(0.1, 0.5), null)
  assert.equal(levelOf(0.1, 0.9), 'tip')
  assert.equal(levelOf(0.01, 0.99), null)
})

const ENC = JSON.stringify({ episodes: [
  { type: 'fact', gist: '甲说他喜欢吃辣', detail: '火锅要特辣', importance: 0.7, emotion: { name: '开心', intensity: 0.4, valence: 0.6 }, who: ['qq:2'], about: 'qq:2', speaker: 'qq:2', sources: [1] },
  { type: 'fact', gist: '甲说乙要搬家', importance: 0.4, who: ['qq:2', 'qq:3'], about: 'qq:3', speaker: 'qq:2', sources: [2] },
  { type: 'intention', gist: '答应甲今晚八点唱歌', importance: 0.8, who: ['qq:2'], about: 'qq:2', speaker: 'self', due: '2026-11-10 20:00', sources: [3] },
  { type: 'event', gist: '   ' },
] })

function chat(m, at) {
  m.perceive({ window: 'qq:group:9', who: 'qq:2', name: '甲', text: '我超喜欢吃辣，火锅要特辣', msgId: 'a', at })
  m.perceive({ window: 'qq:group:9', who: 'qq:2', name: '甲', text: '对了乙下周要搬家', msgId: 'b', at: at + 1000 })
  m.said({ window: 'qq:group:9', text: '好，今晚八点给你唱歌', msgId: 'c', at: at + 2000 })
}

test('记住：一段聊天停下来才记；别人说别人的事记成听说；要做的事按她的时区记时间', async () => {
  const s = setup({ think: () => ENC })
  chat(s.m, T0)
  assert.equal((await s.mem.encodeWindow('qq:group:9')).waiting, true, '刚聊完还没停')
  s.set(T0 + 6 * 60000)
  const r = await s.mem.encodeWindow('qq:group:9')
  assert.equal(r.encoded, 3)
  assert.match(s.calls[0].text, /\[qq:2\] 甲：我超喜欢吃辣/)
  assert.match(s.calls[0].text, /\[self\] 你：好，今晚八点/)
  const eps = s.mem.list()
  const kinds = Object.fromEntries(eps.map((e) => [e.gist, e.kind]))
  assert.equal(kinds['甲说他喜欢吃辣'], 'fact')
  assert.equal(kinds['甲说乙要搬家'], 'hearsay')
  assert.equal(s.mem.dueIntentions().length, 0, '早上还不用惦记晚上八点的事')
  const todo = s.mem.dueIntentions({ within: 12 * 3600000 })
  assert.equal(todo.length, 1)
  assert.equal(todo[0].data.due, Date.UTC(2026, 10, 10, 12, 0))
  assert.equal((await s.mem.encodeWindow('qq:group:9', { force: true })).encoded, 0, '记过的不再记')
})

test('想起：意思相近的被勾起来，同一个地方更容易；想起来就被加强', async () => {
  const s = setup({ think: () => ENC })
  chat(s.m, T0)
  s.set(T0 + 10 * 60000)
  await s.mem.encodeWindow('qq:group:9')
  const got = await s.mem.recall({ cue: '甲喜欢吃辣吗', window: 'qq:group:9' })
  assert.equal(got[0].text.startsWith('甲说他喜欢吃辣'), true)
  assert.equal(got[0].level, 'clear')
  const before = s.mem.row(got[0].id).stability
  s.set(T0 + 11 * 3600000) // 当晚 9 点：约定刚过点
  const wm = await s.mem.workingMemory({ cue: '甲喜欢吃辣吗', window: 'qq:group:9' })
  assert.match(wm.text, /【你想起来的】/)
  assert.match(wm.text, /【你惦记着要做的事】\n- 答应甲今晚八点唱歌/)
  assert.ok(s.mem.row(got[0].id).stability > before, '想起来被加强')
  assert.equal(s.mem.row(got[0].id).data.hits, 1)
})

test('时间久了只记得大概，再久要很强的线索、只想起一半，最后想不起来', async () => {
  const s = setup()
  const id = s.mem.insert({ at: T0, window: 'w', gist: '我们一起去看了海边的日出', kind: 'event', importance: 0.5 })
  await s.mem.embedEpisodes([id])
  s.set(T0 + 40 * DAY)
  const vague = await s.mem.recall({ cue: '海边日出' })
  assert.equal(vague[0]?.level, 'vague')
  assert.match(vague[0].text, /^好像有这么回事/)
  s.set(T0 + 500 * DAY)
  assert.equal((await s.mem.recall({ cue: '海边' })).length, 0, '弱线索勾不起来')
  const tip = await s.mem.recall({ cue: '我们一起去看了海边的日出' })
  assert.equal(tip[0]?.level, 'tip')
  assert.match(tip[0].text, /一下想不全/)
  s.set(T0 + 3000 * DAY)
  assert.equal((await s.mem.recall({ cue: '我们一起去看了海边的日出' })).length, 0, '最后想不起来了')
})

test('约定：过期很久还没做的不再一直惦记；做完了就放下', async () => {
  const s = setup()
  const id = s.mem.insert({ at: T0, gist: '答应唱歌', kind: 'intention', due: T0 + 3600000 })
  s.set(T0 + 2 * 3600000)
  assert.equal(s.mem.dueIntentions().length, 1, '过了点还惦记')
  s.set(T0 + 5 * DAY)
  assert.equal(s.mem.dueIntentions().length, 0, '过期好几天就淡了')
  s.set(T0 + 2 * 3600000)
  s.mem.completeIntention(id)
  assert.equal(s.mem.dueIntentions().length, 0)
})

test('心境一致：开心时更容易先想起开心的事', async () => {
  const s = setup()
  const happy = s.mem.insert({ at: T0, gist: '和大家一起唱歌很快乐', kind: 'event', emotion: { name: '开心', intensity: 0.5, valence: 0.9 } })
  const sad = s.mem.insert({ at: T0, gist: '和大家一起唱歌很难过', kind: 'event', emotion: { name: '难过', intensity: 0.5, valence: -0.9 } })
  await s.mem.embedEpisodes([happy, sad])
  s.m.memory.connect({ state: () => ({ valence: 0.8, energy: 1 }) })
  assert.equal((await s.mem.recall({ cue: '和大家一起唱歌' }))[0].id, happy)
  s.m.memory.connect({ state: () => ({ valence: -0.8, energy: 1 }) })
  assert.equal((await s.mem.recall({ cue: '和大家一起唱歌' }))[0].id, sad)
})

test('特意记下来：很像的旧记忆被加强而不是重复记一条', async () => {
  const s = setup()
  const a = await s.mem.remember({ text: '主人的生日是三月五号' })
  assert.equal(a.merged, false)
  const b = await s.mem.remember({ text: '主人的生日是三月五号' })
  assert.equal(b.merged, true)
  assert.equal(b.id, a.id)
  assert.equal(s.mem.list().length, 1)
})

test('删除：连同向量和联系一起删；整理出来的知道的事，来源都没了就删，还有来源就重算', async () => {
  const s = setup()
  const a = s.mem.insert({ at: T0, gist: '甲周一喝奶茶', kind: 'event' })
  const b = s.mem.insert({ at: T0 + DAY, gist: '甲周二喝奶茶', kind: 'event' })
  const f1 = s.mem.insert({ at: T0, gist: '甲爱喝奶茶', kind: 'semantic', extra: { derivedFrom: [a, b] } })
  const f2 = s.mem.insert({ at: T0, gist: '甲周一有空', kind: 'semantic', extra: { derivedFrom: [a] } })
  await s.mem.embedEpisodes([a, b, f1, f2])
  s.m._store.prep('INSERT INTO links (a, b, kind, weight) VALUES (?, ?, ?, ?)').run(a, b, 'similar', 0.9)
  s.mem.deleteEpisode(a)
  assert.equal(s.mem.row(a), null)
  assert.equal(s.mem.row(f2), null, '唯一来源没了，一起删')
  assert.deepEqual(s.mem.row(f1).data.derivedFrom, [b])
  assert.equal(s.mem.takeJobs('recompute').length, 1)
  assert.equal(s.mem.vectors.has(a), false)
  assert.equal(s.m._store.prep('SELECT COUNT(*) AS n FROM links').get().n, 0)
  assert.deepEqual(s.m.deletions().map((d) => d.id).sort(), [a, f2].sort())
})

test('从备份恢复后：恢复前删掉的再删一遍，不会复活', () => {
  const s = setup()
  const a = s.mem.insert({ id: 'x1', at: T0, gist: '要删的', kind: 'event' })
  assert.equal(s.mem.applyDeletions([{ id: a, kind: 'episode', at: T0 }]), 1)
  assert.equal(s.mem.row(a), null)
  assert.ok(s.m.deletions().some((d) => d.id === a))
})

test('主人加强一条：归档的也会回来', () => {
  const s = setup()
  const a = s.mem.insert({ at: T0, gist: '很久以前的事', kind: 'event' })
  s.m._store.prep("UPDATE episodes SET status = 'archived' WHERE id = ?").run(a)
  s.mem.boost(a)
  assert.equal(s.mem.row(a).status, 'live')
})

test('睡觉整理：提炼不同日子反复出现的事、建联系、改写想起过的、情绪变淡、归档、做梦', async () => {
  const replies = []
  const s = setup({
    random: () => 0.01,
    think: (o) => {
      replies.push(o.scene)
      if (o.scene === 'consolidate') return JSON.stringify({ facts: [{ text: '甲很爱喝奶茶', about: 'qq:2', sources: ['1', '2'] }, { text: '只有一天的依据', sources: ['1'] }], links: [{ a: '1', b: '2', kind: 'followup' }] })
      if (o.scene === 'reconsolidate') return JSON.stringify({ gist: '甲好像周一喝了奶茶', detail: '' })
      if (o.scene === 'dream') return '我梦见自己在奶茶店里游泳。\n情绪强度=0.9'
      return '{"episodes":[]}'
    },
  })
  s.m._store.set('sleep.lastAt', T0 - DAY)
  const a = s.mem.insert({ at: T0, gist: '甲周一喝奶茶', kind: 'event', emotion: { name: '开心', intensity: 0.5, valence: 0.5 } })
  const b = s.mem.insert({ at: T0 + DAY, gist: '甲周二喝奶茶', kind: 'event' })
  const old = s.mem.insert({ at: T0 - 9000 * DAY, gist: '很久很久以前的小事', kind: 'event' })
  await s.mem.embedEpisodes([a, b, old])
  s.set(T0 + DAY + 3600000)
  s.mem.strengthen([a]) // 想起过 → 排进改写（随机数 0.01 < 15%）
  const report = await s.m.sleep()
  assert.equal(report.replay.facts, 1, '只有一天依据的不提炼')
  const fact = s.mem.list({ kind: 'semantic' })[0]
  assert.equal(fact.gist, '甲很爱喝奶茶')
  assert.ok(report.links >= 1)
  const ra = s.mem.row(a)
  assert.equal(ra.gist, '甲好像周一喝了奶茶')
  assert.equal(ra.data.original.gist, '甲周一喝奶茶', '原始记录留着')
  assert.equal(ra.data.emotion.intensity, 0.45, '情绪淡了一点')
  assert.equal(s.mem.row(old).status, 'archived')
  assert.equal(report.dream.remembered, true)
  assert.equal(s.mem.list({ kind: 'dream' })[0].kind, 'dream')
  assert.ok(replies.includes('dream'))
  assert.ok(s.m.budget.spent().tokens > 0, '花的 token 记账')
})

test('预算用完：后台整理停下，排到第二天；聊天不受影响', async () => {
  const s = setup({ think: () => ENC })
  s.m.updateSettings({ 'models.backgroundTokensDaily': 0 })
  chat(s.m, T0)
  s.set(T0 + 10 * 60000)
  const r = await s.mem.encodeWindow('qq:group:9')
  assert.equal(r.budget, true)
  assert.equal(s.calls.length, 0)
  assert.equal(s.mem.pendingWindows().length, 1, '没记的还在，明天再记')
})

test('向量接口：按顺序取回，数量不对就报错；在线服务没密钥不白发请求，本机服务不要密钥', async () => {
  const seen = []
  const fetch = async (url, init) => {
    seen.push({ url, init })
    const body = JSON.parse(init.body)
    return { ok: true, json: async () => ({ data: body.input.map((_, i) => ({ index: body.input.length - 1 - i, embedding: [i, 1] })).reverse() }) }
  }
  const embed = createEmbedClient({ url: () => 'https://x.test/v1/', model: () => 'm', key: () => 'k', fetch })
  const out = await embed(['a', 'b'])
  assert.deepEqual(out, [[1, 1], [0, 1]])
  assert.equal(seen[0].url, 'https://x.test/v1/embeddings')
  assert.equal(seen[0].init.headers.Authorization, 'Bearer k')
  const bad = createEmbedClient({ url: () => 'https://x.test', model: () => 'm', key: () => 'k', fetch: async () => ({ ok: true, json: async () => ({ data: [] }) }) })
  await assert.rejects(bad(['a']), /数量不对/)
  let called = 0
  const noKey = createEmbedClient({ url: () => 'https://x.test', model: () => 'm', fetch: async () => { called++; return {} } })
  await assert.rejects(noKey(['a']), /没填向量接口的密钥/)
  assert.equal(called, 0, '没密钥不发请求')
  const local = createEmbedClient({ url: () => 'http://127.0.0.1:9/v1', model: () => 'm', fetch: async () => ({ ok: true, json: async () => ({ data: [{ embedding: [1] }] }) }) })
  assert.deepEqual(await local(['a']), [[1]], '本机服务不要密钥')
})
