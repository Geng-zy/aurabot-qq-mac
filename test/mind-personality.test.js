// 第五阶段：人格（状态记录、习惯、特质的门槛 / 步子 / 拉力 / 影响力上限 / 影子模式 / 回落）、
// 她自己改自己（版本、专一和年龄改不了、通知）、自我故事、关系（信任不对称、第一印象、专一、纠缠、变淡）、
// 以及对接层：记经历时顺带记状态和看法、谁叫得醒她、群里想不想接话、想主人。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMind } from '../src/mind/index.js'
import { createMindAdapter } from '../src/mind-adapter/index.js'
import { TRAITS, bandOf, bandText, bandMid } from '../src/mind/personality/traits.js'
import { similar } from '../src/mind/personality/index.js'
import { romanceElsewhere, touchesAge } from '../src/mind/self/index.js'

const H = 3600000
const DAY = 86400000
const T0 = Date.UTC(2026, 10, 10, 0, 0) // 上海 08:00

function mk({ settings = {} } = {}) {
  let t = T0
  const m = createMind({ memoryDb: true, now: () => t, ownerId: 'qq:1', random: () => 0.5 })
  m.updateSettings({ 'identity.age': 18, ...settings })
  return { m, set: (v) => { t = v }, get: () => t }
}
/** 第 d 天她在群里有一次某个方向的表现，对方给了某种反应。 */
function act(env, d, { t = 'sociability', dir = 1, react = 'good', by = 'qq:2', at } = {}) {
  const when = at ?? T0 + d * DAY
  env.set(when)
  const rows = [{ id: 1, at: when, who: by, dir: 'in' }, { id: 2, at: when + 1000, who: 'self', dir: 'out' }]
  return env.m.personality.observe({ self: [{ t, d: dir, line: 2, react, by }] }, { window: 'qq:group:9', rows })
}
const night = (env, d) => { env.set(T0 + d * DAY + 16 * H); return env.m.personality.nightly() }
const cur = (env, id = 'sociability') => env.m.personality.values()[id]

// ---------- 特质表 ----------

test('特质：19 项，每项 7 档描述；档位边界按设计文档；通用版不针对某个角色', () => {
  assert.equal(TRAITS.length, 19)
  for (const t of TRAITS) assert.equal(t.bands.length, 7, t.id)
  assert.equal(bandOf(0), 1)
  assert.equal(bandOf(0.14), 2)
  assert.equal(bandOf(0.5), 4)
  assert.equal(bandOf(0.86), 7)
  assert.equal(bandOf(1), 7)
  assert.equal(bandOf(bandMid(5)), 5)
  assert.match(bandText('sociability', 0.6), /喜欢热闹/)
  const all = JSON.stringify(TRAITS)
  for (const word of ['大肥鱼', '烤串', '鲸鱼', 'Dr. Romantic', '白米饭']) assert.ok(!all.includes(word), '出现了 ' + word)
  assert.ok(similar('被开玩笑', '被人开玩笑') >= 0.5)
  assert.ok(similar('被开玩笑', '饿了') < 0.2)
})

// ---------- 状态记录 ----------

test('状态记录：依据必须是她自己说的那一行；做出反应的人必须在这段里出现过', () => {
  const env = mk()
  const rows = [{ id: 1, at: T0, who: 'qq:2', dir: 'in' }, { id: 2, at: T0 + 1, who: 'self', dir: 'out' }]
  const r = env.m.personality.observe({ self: [
    { t: 'sociability', d: 1, line: 1, react: 'good', by: 'qq:2' }, // 第 1 行是别人说的，不算
    { t: 'nope', d: 1, line: 2 }, // 不认识的项目
    { t: 'assertiveness', d: 0, line: 2 }, // 差不多：不记
    { t: 'assertiveness', d: -1, line: 2, react: 'whatever', by: 'qq:99' },
  ] }, { window: 'qq:group:9', rows })
  assert.equal(r.traits, 1)
  const ev = env.m.personality.state().traits.find((x) => x.id === 'assertiveness').evidence[0]
  assert.equal(ev.react, 'none')
  assert.equal(ev.by, '', '这段里没出现过的人不算')
})

// ---------- 特质：门槛、步子、上限、间隔、影子、拉力、回落 ----------

test('门槛：两周内不到 3 个不同的日子不动；同一天说多少次都只算一天；过了门槛只走一小步', () => {
  const env = mk()
  for (let i = 0; i < 5; i++) act(env, 0)
  act(env, 1)
  assert.equal(night(env, 1).steps.length, 0)
  assert.equal(cur(env), 0.5)
  act(env, 2)
  const r = night(env, 2)
  assert.equal(r.steps.length, 1)
  assert.equal(cur(env), 0.52, '步子 0.02')
  assert.equal(env.m.listVersions('traits', 5)[0].by, 'sleep')
  assert.match(env.m.listVersions('traits', 5)[0].reason, /爱社交 0.5→0.52/)
})

test('走过一步，「平时」就变了：旧证据不再推她；同一项两步之间至少隔几天', () => {
  const env = mk()
  for (const d of [0, 1, 2]) act(env, d)
  night(env, 2)
  assert.equal(night(env, 3).steps.length, 0, '用过的证据不再算')
  for (const d of [3, 4]) act(env, d)
  // 这时第 3、4 天只有两天新证据；第 5 天凑够三天，但离上一步只隔了 3 天 → 刚好可以
  act(env, 5)
  assert.equal(night(env, 4).steps.length, 0)
  assert.equal(night(env, 5).steps.length, 1)
})

test('主人的影响力上限：只有主人推的时候也会变，只是慢（按上限比例）', () => {
  const env = mk()
  for (const d of [0, 1, 2]) act(env, d, { by: 'qq:1' })
  night(env, 2)
  assert.equal(cur(env), 0.512, '0.02 × 0.6')
  const env2 = mk({ settings: { 'personality.ownerInfluenceCap': 0.68 } })
  for (const d of [0, 1, 2]) act(env2, d, { by: 'qq:1' })
  night(env2, 2)
  assert.equal(cur(env2), 0.514, '0.02 × 0.68 ≈ 0.0136')
})

test('被冷落、被责怪的表现往反方向推；反方向的证据够多就拉回来', () => {
  const env = mk()
  for (const d of [0, 1, 2]) act(env, d, { dir: 1, react: 'bad' })
  night(env, 2)
  assert.ok(cur(env) < 0.5, '主动开口总被冷落：变得不太主动')
})

test('影子模式：只计算不生效，面板里能看到算出来的', () => {
  const env = mk({ settings: { 'personality.shadowMode': true } })
  for (const d of [0, 1, 2]) act(env, d)
  const r = night(env, 2)
  assert.equal(r.shadow, true)
  assert.equal(cur(env), 0.5, '没生效')
  const t = env.m.personality.state().traits.find((x) => x.id === 'sociability')
  assert.equal(t.shadow, 0.52)
  assert.match(env.m.listVersions('traits', 1)[0].reason, /影子模式/)
})

test('拉力：离本来的样子越远，往外越难、往回越容易；越往边上越难走', () => {
  const env = mk()
  const s = env.m._store.get('personality')
  env.m._store.set('personality', { ...s, cur: { ...s.cur, sociability: 0.8 } })
  for (const d of [0, 1, 2]) act(env, d, { dir: 1 })
  night(env, 2)
  const outward = cur(env) - 0.8
  const env2 = mk()
  const s2 = env2.m._store.get('personality')
  env2.m._store.set('personality', { ...s2, cur: { ...s2.cur, sociability: 0.8 } })
  for (const d of [0, 1, 2]) act(env2, d, { dir: -1 })
  night(env2, 2)
  const inward = 0.8 - cur(env2)
  assert.ok(outward > 0 && inward > outward * 3, `往外 ${outward}，往回 ${inward}`)
})

test('没有新证据就很慢地往回落，但不完全回去（停在最远偏离的一半）', () => {
  const env = mk()
  let d = 0
  for (let k = 0; k < 4; k++) { for (const x of [0, 1, 2]) act(env, d + x); night(env, d + 2); d += 3 }
  const peak = cur(env)
  assert.ok(peak > 0.55, '走了几步：' + peak)
  for (let k = 0; k < 120; k++) night(env, d + 15 + k)
  const after = cur(env)
  assert.ok(after < peak, '回落了')
  assert.ok(after >= 0.5 + (peak - 0.5) * 0.5 - 0.001, '不完全回去：' + after)
})

test('提醒：同一项连着好几步往一个方向走，面板会提醒', () => {
  const env = mk()
  let d = 0
  for (let k = 0; k < 3; k++) { for (const x of [0, 1, 2]) act(env, d + x); night(env, d + 2); d += 3 }
  const alerts = env.m.personality.state().alerts
  assert.ok(alerts.some((a) => /连着 3 步往高走/.test(a.text)))
  env.m.personality.readAlerts()
  assert.ok(env.m.personality.state().alerts.every((a) => a.read))
})

test('跨了档才告诉她「你最近比以前更……」；放在系统提示词里（很少变）', () => {
  const env = mk()
  assert.equal(env.m.personality.selfText(), '')
  const s = env.m._store.get('personality')
  env.m._store.set('personality', { ...s, cur: { ...s.cur, sociability: 0.52, assertiveness: 0.62 } })
  const text = env.m.selfPrompt()
  assert.doesNotMatch(text, /爱主动开口/, '同一档里的变化她察觉不到')
  assert.match(text, /你最近比以前更敢直说、敢反驳：不同意就直说/)
})

test('退回某个特质版本', () => {
  const env = mk()
  const v0 = env.m.listVersions('traits', 1)[0]
  assert.equal(v0, undefined)
  env.m.personality.confirm({ sociability: 0.4 })
  const vid = env.m.listVersions('traits', 1)[0].id
  for (const d of [0, 1, 2]) act(env, d)
  night(env, 2)
  assert.ok(cur(env) > 0.4)
  env.m.personality.restore(vid)
  assert.equal(cur(env), 0.4)
})

// ---------- 习惯 ----------

test('习惯：同一类场合反复出现、被正面回应就成了习惯；之后总被冷落就慢慢没了', () => {
  const env = mk()
  const hb = (d, sit, act2, react) => {
    const at = T0 + d * DAY
    env.set(at)
    env.m.personality.observe({ habit: [{ sit, act: act2, line: 2, react, by: 'qq:2' }] }, { window: 'qq:group:9', rows: [{ id: 1, at, who: 'qq:2', dir: 'in' }, { id: 2, at, who: 'self', dir: 'out' }] })
  }
  hb(0, '被开玩笑', '反怼回去', 'good')
  hb(1, '被人开玩笑', '怼回去', 'good')
  night(env, 1)
  assert.equal(env.m.personality.habits().length, 0)
  hb(2, '被开玩笑时', '反怼回去', 'none')
  night(env, 2)
  const h = env.m.personality.habits()
  assert.equal(h.length, 1, '很像的算同一个习惯')
  assert.match(env.m.selfPrompt(), /被开玩笑时，你会反怼回去/)
  for (const d of [3, 3, 4, 4]) hb(d, '被开玩笑', '反怼回去', 'bad')
  night(env, 4)
  assert.equal(env.m.personality.habits().length, 0)
})

// ---------- 从人格卡推初始数值、主人确认 ----------

test('从人格卡推初始数值：没确认前先用着；主人确认后已经走过的变化保留', async () => {
  const env = mk()
  const ask = async (scene, system, text) => {
    assert.equal(scene, 'traits')
    assert.match(system, /sociability/)
    assert.match(text, /话很多/)
    return JSON.stringify({ traits: { sociability: 0.8, honesty: 2 }, why: { sociability: '话很多' } })
  }
  const r = await env.m.personality.infer('她话很多，见谁都聊。', ask)
  assert.equal(r.values.sociability, 0.8)
  assert.equal(r.values.honesty, 0.98, '夹在范围里')
  assert.equal(r.values.trust, 0.5, '没写到的给 0.5')
  assert.equal(cur(env), 0.8)
  assert.equal(env.m.personality.state().confirmed, false)
  const s = env.m._store.get('personality')
  env.m._store.set('personality', { ...s, cur: { ...s.cur, sociability: 0.84 } })
  env.m.personality.confirm({ sociability: 0.7 })
  assert.equal(cur(env), 0.74, '本来 0.7，走过的 +0.04 保留')
  assert.equal(env.m.personality.state().confirmed, true)
  await env.m.personality.infer('别的卡', async () => JSON.stringify({ traits: { sociability: 0.1 } }))
  assert.equal(cur(env), 0.74, '确认过以后再推只给参考，不改')
})

// ---------- 她自己改自己 ----------

test('她自己改自己：要有理由；存版本；改名后叫她的名字跟着变', () => {
  const env = mk()
  env.m.setPersonaCard('你是小鱼，住在 QQ 里，18 岁。', { by: 'migration', name: '小鱼' })
  assert.equal(env.m.self.change({ what: 'name', content: '阿鱼' }).ok, false, '没理由不改')
  const r = env.m.self.change({ what: 'name', content: '阿鱼', why: '大家都这么叫我' })
  assert.equal(r.ok, true)
  assert.equal(env.m.identity().name, '阿鱼')
  assert.ok(env.m.wakeWords().includes('阿鱼'))
  assert.equal(env.m.listVersions('self', 1)[0].by, 'self')
  assert.match(env.m.listVersions('persona', 1)[0].reason, /改名：小鱼 → 阿鱼/)
  assert.match(env.m.self.historyText(), /名字（她自己改的：大家都这么叫我）/)
  env.m.self.change({ what: 'values', content: '对朋友讲义气', why: '想清楚了' })
  env.m.self.change({ what: 'hobbies', content: '唱歌、看番', why: '最近迷上了' })
  const p = env.m.selfPrompt()
  assert.match(p, /你现在的名字是「阿鱼」/)
  assert.match(p, /价值观：对朋友讲义气/)
  assert.match(p, /爱好：唱歌、看番/)
  assert.match(p, /【年龄】你 18 岁/)
})

test('专一和年龄是主人设的：她改人格卡、写目标时写不进去', () => {
  const env = mk()
  env.m.setPersonaCard('你是小鱼，18 岁，最喜欢主人。'.padEnd(30, '。'), { by: 'migration' })
  assert.equal(romanceElsewhere('我喜欢上了隔壁的小明'), true)
  assert.equal(romanceElsewhere('我最喜欢主人，想做主人的女朋友'), false)
  assert.equal(romanceElsewhere('我不想谈恋爱'), false, '否定的不算')
  assert.equal(romanceElsewhere('她没有男朋友。她爱上了小明', '她没有男朋友'), true, '原来的句子不管，新加的照样拦')
  assert.equal(env.m.self.change({ what: 'goal', content: '想和小明谈恋爱', why: '他对我好' }).ok, false)
  assert.equal(env.m.self.change({ what: 'values', content: '我有男朋友了', why: 'x' }).ok, false)
  assert.equal(touchesAge('我 18 岁', '我 20 岁'), true)
  assert.equal(touchesAge('我 18 岁', '我 18 岁，爱唱歌'), false)
  const r = env.m.self.change({ what: 'persona', content: '你是小鱼，20 岁，最喜欢主人，爱唱歌。'.padEnd(30, '。'), why: '想长大' })
  assert.equal(r.ok, false)
  assert.match(r.message, /年龄和生日/)
  assert.equal(env.m.self.change({ what: 'persona', content: '你是小鱼，18 岁，最喜欢主人，也爱唱歌。'.padEnd(30, '。'), why: '发现自己爱唱歌' }).ok, true)
  // 关掉专一以后就可以
  env.m.updateSettings({ 'identity.exclusive': false })
  assert.equal(env.m.self.change({ what: 'goal', content: '想和小明谈恋爱', why: '他对我好' }).ok, true)
  // 主人在面板里改不受限制
  assert.equal(env.m.self.change({ what: 'persona', content: '你是小鱼，19 岁。'.padEnd(30, '。'), why: '' }, { by: 'owner' }).ok, true)
})

test('「我想变成……」的目标：那个方向的拉力变小', () => {
  const run = (goal) => {
    const env = mk()
    const s = env.m._store.get('personality')
    env.m._store.set('personality', { ...s, cur: { ...s.cur, sociability: 0.75 } })
    if (goal) env.m.self.change({ what: 'goal', content: '想变得更爱说话', why: '想多交朋友', trait: 'sociability', dir: 1 })
    for (const d of [0, 1, 2]) act(env, d)
    night(env, 2)
    return cur(env) - 0.75
  }
  assert.ok(run(true) > run(false) * 1.3)
})

test('退回她改过的某一项', () => {
  const env = mk()
  env.m.self.change({ what: 'hobbies', content: '唱歌', why: 'a' })
  env.m.self.change({ what: 'hobbies', content: '画画', why: 'b' })
  const v = env.m.self.history(1)[0]
  assert.equal(env.m.self.restore(v.id).ok, true)
  assert.equal(env.m.self.profile().hobbies, '唱歌')
  assert.equal(env.m.self.history(1)[0].by, 'owner')
})

test('自我故事：有重要的新经历才写，一天最多一次；只用真实经历', async () => {
  const env = mk()
  const calls = []
  const ask = async (scene, system, text) => { calls.push({ scene, system, text }); return JSON.stringify({ story: '我是从一个只会潜水的小透明慢慢变成话痨的。', chapter: '第一次唱歌' }) }
  assert.equal(await env.m.self.updateStory({ ask, episodes: () => [] }), null, '没有新经历不写')
  const id = env.m.memory.insert({ at: T0, gist: '第一次给主人唱歌', kind: 'event', importance: 0.8 })
  const r = await env.m.self.updateStory({ ask, episodes: () => [{ id, at: T0, gist: '第一次给主人唱歌', importance: 0.8 }] })
  assert.equal(r.chapter, '第一次唱歌')
  assert.equal(calls[0].scene, 'selfstory')
  assert.match(calls[0].system, /不编没发生过的事/)
  assert.match(env.m.selfPrompt(), /【你的故事（你自己写的）】\n我是从一个只会潜水的小透明/)
  env.set(T0 + 2 * H)
  assert.equal(await env.m.self.updateStory({ ask, episodes: () => [{ id: 'b', at: T0 + H, gist: 'x', importance: 0.9 }] }), null, '一天最多一次')
})

// ---------- 关系 ----------

const relRows = (who, at = T0, window = 'qq:group:9') => [{ id: 1, at, who, dir: 'in' }, { id: 2, at: at + 1, who: 'self', dir: 'out' }]

test('关系：只认这段里真说过话的人；信任掉得比涨得快；第一印象要好几次才改得过来', () => {
  const env = mk()
  const R = env.m.relations
  R.observe({ rel: [{ who: 'qq:3', d: { like: 1 } }] }, { window: 'qq:group:9', rows: relRows('qq:2') })
  assert.equal(env.m.person('qq:3'), null, '没说过话的人不记')
  R.observe({ rel: [{ who: 'qq:2', d: { trust: 0.5, like: 1 } }] }, { window: 'qq:group:9', rows: relRows('qq:2') })
  const t1 = R.get('qq:2').rel.trust
  assert.equal(Math.round((t1 - 0.5) * 1000), 40)
  R.observe({ rel: [{ who: 'qq:2', d: { trust: -0.5 } }] }, { window: 'qq:group:9', rows: relRows('qq:2') })
  assert.equal(Math.round((t1 - R.get('qq:2').rel.trust) * 1000), 80, '一次失信的影响是守信的两倍')
  R.observe({ rel: [{ who: 'qq:2', d: {} }] }, { window: 'qq:group:9', rows: relRows('qq:2') })
  const l = R.get('qq:2').rel.liking
  R.observe({ rel: [{ who: 'qq:2', d: { like: -1 } }] }, { window: 'qq:group:9', rows: relRows('qq:2') })
  assert.equal(Math.round((l - R.get('qq:2').rel.liking) * 1000), 40, '和第一印象相反的变化只算一半')
  R.observe({ rel: [{ who: 'qq:2', kept: false }] }, { window: 'qq:group:9', rows: relRows('qq:2') })
  assert.ok(R.get('qq:2').rel.trust < t1 - 0.1, '放鸽子掉信任')
})

test('专一：亲密、激情、承诺只对主人；别人再亲近也最多是好朋友；关掉专一就可能成恋人', () => {
  const env = mk()
  const R = env.m.relations
  for (let i = 0; i < 30; i++) {
    R.observe({ rel: [{ who: 'qq:2', d: { close: 1, like: 1, trust: 1 } }, { who: 'qq:1', d: { close: 1, like: 1 } }] }, { window: 'qq:private:2', rows: [...relRows('qq:2'), { id: 3, at: T0, who: 'qq:1', dir: 'in' }] })
  }
  const other = R.get('qq:2')
  assert.equal(other.type, 'closeFriend')
  assert.equal(other.rel.intimacy, 0)
  assert.equal(other.rel.commitment, 0)
  const owner = R.get('qq:1')
  assert.equal(owner.type, 'owner')
  assert.ok(owner.rel.intimacy > 0.7)
  assert.ok(owner.rel.passion > 0, '满 18 岁才有激情')
  env.m.updateSettings({ 'identity.exclusive': false })
  for (let i = 0; i < 40; i++) R.observe({ rel: [{ who: 'qq:2', d: { close: 1, like: 1 } }] }, { window: 'qq:private:2', rows: relRows('qq:2') })
  assert.equal(R.get('qq:2').type, 'lover')
})

test('没满 18 岁没有激情', () => {
  const env = mk({ settings: { 'identity.age': 16 } })
  env.m.relations.observe({ rel: [{ who: 'qq:1', d: { close: 1 } }] }, { window: 'qq:private:1', rows: relRows('qq:1') })
  assert.equal(env.m.relations.get('qq:1').rel.passion, 0)
})

test('有人反复撩她：好感下降，记下这个人在纠缠；很不喜欢的人她不想搭理', () => {
  const env = mk()
  for (let i = 0; i < 3; i++) env.m.relations.observe({ rel: [{ who: 'qq:2', flirt: true }] }, { window: 'qq:group:9', rows: relRows('qq:2', T0 + i * H) })
  assert.ok(env.m.relations.get('qq:2').rel.liking < 0.5)
  assert.deepEqual(env.m._store.get('relations.pester'), ['qq:2'])
  assert.match(env.m.relations.describe(['qq:2']), /老撩你、纠缠你/)
  assert.equal(env.m.relations.dislikes('qq:2'), false)
  env.m.relations.edit('qq:2', { liking: 0.1 })
  assert.equal(env.m.relations.dislikes('qq:2'), true)
  env.m.relations.edit('qq:1', { liking: 0 })
  assert.equal(env.m.relations.dislikes('qq:1'), false, '主人永远不算')
})

test('关系的细节：称呼、老梗、别碰的、心结和和好、对方的心情；对群的了解', () => {
  const env = mk()
  const R = env.m.relations
  R.observe({
    rel: [{ who: 'qq:2', call: '阿二', callMe: '鱼鱼', joke: '鸽子王', limit: '别提他前任', knot: '上次放我鸽子', mood: '在赶论文', likes: '猫', helped: 'me' }],
    group: { style: '爱玩梗', rule: '不许刷屏' },
  }, { window: 'qq:group:9', rows: relRows('qq:2') })
  const text = R.describe(['qq:2'], { nameOf: () => '老二', window: 'qq:group:9' })
  assert.match(text, /- 老二：/)
  assert.match(text, /你叫他「阿二」/)
  assert.match(text, /他叫你「鱼鱼」/)
  assert.match(text, /你欠他人情/)
  assert.match(text, /老梗：鸽子王/)
  assert.match(text, /别碰：别提他前任/)
  assert.match(text, /没解开的：上次放我鸽子/)
  assert.match(text, /他最近：在赶论文/)
  assert.match(text, /- 这个群：爱玩梗；规矩：不许刷屏/)
  R.observe({ rel: [{ who: 'qq:2', untie: true }] }, { window: 'qq:group:9', rows: relRows('qq:2') })
  const r = R.get('qq:2').rel
  assert.equal(r.knots.length, 0)
  assert.match(r.moments.at(-1).text, /和好：上次放我鸽子/)
})

test('很久不联系慢慢变淡；有共同回忆的不会淡到底；投入越多变淡越慢', () => {
  const env = mk()
  const R = env.m.relations
  for (let i = 0; i < 10; i++) R.observe({ rel: [{ who: 'qq:2', d: { close: 1 } }] }, { window: 'qq:group:9', rows: relRows('qq:2') })
  const c0 = R.get('qq:2').rel.closeness
  env.set(T0 + 10 * DAY)
  R.nightly()
  assert.equal(R.get('qq:2').rel.closeness, c0, '还没到变淡的时候')
  env.set(T0 + 40 * DAY)
  R.nightly()
  assert.ok(R.get('qq:2').rel.closeness < c0)
})

// ---------- 对接层 ----------

const fakeVec = (xs) => xs.map((t) => { const v = new Array(64).fill(0); for (const ch of String(t)) v[ch.codePointAt(0) % 64] += 1; return v })
function adapter({ answer = '{"episodes":[]}', cfg = {} } = {}) {
  let t = T0
  const asks = []
  const notes = []
  const selfChanges = []
  const a = createMindAdapter({
    memoryDb: true, getConfig: () => ({ ownerQQ: '1', ...cfg }), now: () => t, random: () => 0.5,
    ask: async (o) => { asks.push(o); return typeof answer === 'function' ? answer(o) : answer },
    embedKey: () => 'k',
    fetch: async (url, init) => ({ ok: true, json: async () => ({ data: fakeVec(JSON.parse(init.body).input).map((embedding, index) => ({ index, embedding })) }) }),
    notifyOwner: async (text) => { notes.push(text) },
    onSelfChange: (c) => selfChanges.push(c),
  })
  a.mind.updateSettings({ 'identity.age': 18 })
  return { a, asks, notes, selfChanges, set: (v) => { t = v }, get: () => t }
}

test('对接层：记经历时顺带问状态和看法；回来的状态记录、关系、群的了解都收下', async () => {
  const answer = (o) => (o.scene === 'record' ? JSON.stringify({
    episodes: [{ type: 'event', gist: '甲逗我，我怼回去了', importance: 0.4, sources: [1, 2] }],
    self: [{ t: 'assertiveness', d: 1, line: 2, react: 'good', by: 'qq:2' }],
    habit: [{ sit: '被开玩笑', act: '反怼回去', line: 2, react: 'good', by: 'qq:2' }],
    rel: [{ who: 'qq:2', d: { like: 0.5 }, joke: '小笨鱼' }],
    group: { style: '爱互怼' },
  }) : '{}')
  const env = adapter({ answer })
  env.a.perceive({ chatId: 'group:9', kind: 'group', userId: '2', nickname: '甲', text: '小笨鱼', messageId: 'g1' })
  env.a.said({ chatId: 'group:9', message: '你才笨', messageId: 'g2' })
  env.set(T0 + 10 * 60000)
  await env.a.encodeTick()
  const rec = env.asks.find((o) => o.scene === 'record')
  assert.match(rec.system, /"self"/)
  assert.match(rec.system, /"rel"/)
  assert.match(rec.system, /你平时的样子/)
  const st = env.a.mind.personality.state()
  assert.equal(st.traits.find((x) => x.id === 'assertiveness').evidence.length, 1)
  assert.equal(env.a.mind._store.get('personality').habitObs.length, 1)
  const g = env.a.mind.relations.get('qq:2')
  assert.ok(g.rel.liking > 0.5)
  assert.equal(g.rel.topics[0].text, '小笨鱼')
  assert.deepEqual(env.a.mind.relations.groupOf('qq:group:9').style, ['爱互怼'])
  const ctx = env.a.contextFor({ chat: { chatId: 'group:9', kind: 'group', groupId: '9' } })
  assert.match(ctx, /【你和眼前的人/)
  assert.match(ctx, /这个群：爱互怼/)
})

test('对接层：她改自己 → 通知你、人格卡文件跟着改；「她改自己后通知你」关了就不发', async () => {
  const env = adapter()
  env.a.mind.setPersonaCard('你是小鱼。'.padEnd(30, '。'), { by: 'migration', name: '小鱼' })
  const tools = Object.fromEntries(env.a.tools({ chat: { chatId: 'private:1', kind: 'private', userId: '1' }, ownerTurn: true }).map((x) => [x.name, x]))
  assert.match(tools.mind_change_self.description, /你还没改过自己/)
  const r = await tools.mind_change_self.execute({ what: 'name', content: '阿鱼', why: '更顺口' })
  assert.equal(r.ok, true)
  await new Promise((res) => setTimeout(res, 5))
  assert.match(env.notes[0], /她改了自己的名字：「小鱼」→ 「阿鱼」\n理由：更顺口/)
  assert.deepEqual(env.selfChanges[0], { what: 'name', after: '阿鱼', by: 'self' })
  env.a.mind.updateSettings({ 'identity.notifySelfChange': false })
  await tools.mind_change_self.execute({ what: 'hobbies', content: '唱歌', why: '喜欢' })
  assert.equal(env.notes.length, 1)
  const again = Object.fromEntries(env.a.tools({ chat: { chatId: 'private:1', kind: 'private', userId: '1' } }).map((x) => [x.name, x]))
  assert.match(again.mind_change_self.description, /你以前改过：.*爱好/)
})

test('对接层：第一次启动从人格卡推特质（只推一次）', async () => {
  const env = adapter({ answer: (o) => (o.scene === 'traits' ? JSON.stringify({ traits: { sociability: 0.3 } }) : '{"episodes":[]}') })
  env.a.mind.setPersonaCard('她不太爱说话。', { by: 'migration' })
  await env.a.inferTraits()
  assert.equal(env.a.mind.personality.value('sociability'), 0.3)
  assert.equal(env.asks.find((o) => o.scene === 'traits').reasoningEffort, 'high')
  await env.a.inferTraits()
  assert.equal(env.asks.filter((o) => o.scene === 'traits').length, 1)
})

test('对接层：「谁能叫醒她」选了「主人和很亲近的人」，很亲近的人叫得醒', () => {
  const env = adapter()
  env.a.mind.body.sleepNow()
  assert.equal(env.a.gate({ chatId: 'private:2', kind: 'private', userId: '2', direct: true }).reply, false)
  env.a.mind.updateSettings({ 'identity.wakers': 'close' })
  assert.equal(env.a.gate({ chatId: 'private:2', kind: 'private', userId: '2', direct: true }).reply, false, '不够亲近')
  env.a.mind.relations.edit('qq:2', { closeness: 0.8 })
  const g = env.a.gate({ chatId: 'private:2', kind: 'private', userId: '2', direct: true })
  assert.equal(g.reply, true)
  assert.equal(g.woke, true)
})

test('对接层：群里想不想接话随她的性格、和在场的人亲不亲、整体倍数变；0 就只在被叫到时说话', () => {
  const env = adapter()
  const a = env.a
  const base = a.groupInterest({ texts: ['今天天气不错'], speakers: ['5'] }).chance
  const s = a.mind._store.get('personality')
  a.mind._store.set('personality', { ...s, cur: { ...s.cur, sociability: 0.9 } })
  const social = a.groupInterest({ texts: ['今天天气不错'], speakers: ['5'] }).chance
  assert.ok(social > base * 1.5, `${base} → ${social}`)
  a.mind.relations.edit('qq:5', { closeness: 0.9 })
  assert.ok(a.groupInterest({ texts: ['今天天气不错'], speakers: ['5'] }).chance > social)
  a.mind.self.change({ what: 'hobbies', content: '天气、看云', why: 'x' })
  assert.ok(a.groupInterest({ texts: ['今天天气不错'], speakers: ['5'] }).relevance > 0)
  a.mind.updateSettings({ 'relations.interjectScale': 0 })
  assert.equal(a.groupInterest({ texts: ['今天天气不错'], speakers: ['5'] }).chance, 0)
  assert.ok(a.groupInterest({ texts: [], speakers: [] }).chance <= 0.8)
})

test('对接层：你很久没理她，她会想你（一天一次）；依恋焦虑高的更早、更不安', () => {
  const env = adapter()
  const a = env.a
  a.mind.relations.touch('qq:1', T0)
  env.set(T0 + 20 * H)
  assert.equal(a.missOwner(), null, '还没到')
  env.set(T0 + 32 * H)
  const items = a.missOwner()
  assert.equal(items[0].name, '思念')
  assert.ok(a.mind.motivation.state().wants.some((w) => w.action === 'reach_owner'))
  assert.equal(a.missOwner(), null, '一天一次')
  const env2 = adapter()
  const s = env2.a.mind._store.get('personality')
  env2.a.mind._store.set('personality', { ...s, cur: { ...s.cur, attachAnxiety: 0.9 } })
  env2.a.mind.relations.touch('qq:1', T0)
  env2.set(T0 + 20 * H)
  const anx = env2.a.missOwner()
  assert.ok(anx && anx.some((x) => x.name === '焦虑'), '黏人的更早想、还会不安')
})

test('对接层：不想搭理的人、名字跟着她变', () => {
  const env = adapter()
  env.a.mind.relations.edit('qq:2', { liking: 0.05 })
  assert.equal(env.a.dislikes('2'), true)
  assert.equal(env.a.dislikes('1'), false)
  assert.equal(env.a.ignoreChance(), 0.85)
  env.a.mind.setPersonaCard('x', { name: '小鱼', nickname: '鱼鱼' })
  assert.deepEqual(env.a.wakeWords(['别名']), ['小鱼', '鱼鱼', '别名'])
})

test('其他私聊记忆可跨会话回忆，主人私聊仍只在原会话使用', async () => {
  const env = adapter()
  const m = env.a.mind
  const id1 = m.memory.insert({ at: T0, window: 'qq:private:2', gist: '甲说他喜欢乙，别告诉别人', kind: 'fact', importance: 0.8, extra: { secret: true } })
  const id2 = m.memory.insert({ at: T0, window: 'qq:private:1', gist: '主人说他最近在减肥', kind: 'fact', importance: 0.8 })
  await m.memory.embedEpisodes([id1, id2])
  const wm = await m.memory.workingMemory({ cue: '甲说他喜欢乙 主人说他最近在减肥', window: 'qq:group:9' })
  assert.match(wm.text, /喜欢乙/)
  assert.doesNotMatch(wm.text, /减肥/)
  assert.match(m.memory.recallMore(id1, { audienceWindow: 'qq:private:3' }).text, /喜欢乙/)
  assert.equal(m.memory.recallMore(id2, { audienceWindow: 'qq:private:3' }), null)
  assert.match((await m.memory.workingMemory({ cue: '减肥', window: 'qq:private:1' })).text, /减肥/)
})

test('调试模式：照常想起和回话，但不往心智里写——不记消息、不加强记忆、不记感受、工具不真写', async () => {
  let cfg = { ownerQQ: '1', debug: true }
  let t = T0
  const a = createMindAdapter({ memoryDb: true, getConfig: () => cfg, now: () => t, random: () => 0.5,
    fetch: async (url, init) => ({ ok: true, json: async () => ({ data: fakeVec(JSON.parse(init.body).input).map((embedding, index) => ({ index, embedding })) }) }), embedKey: () => 'k' })
  const id = a.mind.memory.insert({ at: T0, window: 'qq:private:1', gist: '主人不吃香菜', kind: 'fact', importance: 0.8 })
  await a.mind.memory.embedEpisodes([id])
  const before = a.mind.memory.row(id).stability
  assert.equal(a.perceive({ chatId: 'private:1', kind: 'private', userId: '1', nickname: '主人', text: '调试里说的话', messageId: 'd1' }), false)
  assert.equal(a.mind.history('qq:private:1').length, 0, '没记进感知记录')
  const chat = { chatId: 'private:1', kind: 'private', userId: '1' }
  await a.beforeTurn(chat, '主人不吃香菜吗', ['1'])
  assert.match(a.contextFor({ chat }), /香菜/, '照样想得起来')
  assert.equal(a.mind.memory.row(id).stability, before, '但没被加强')
  assert.equal(a.feel('private:1', '好<feel>{"e":[{"n":"快乐","i":0.8}]}</feel>'), '好', '感受照样不发出去')
  assert.equal(a.mind.emotion.state().active.length, 0, '但没记下')
  const tools = Object.fromEntries(a.tools({ chat }).map((x) => [x.name, x]))
  assert.match((await tools.mind_remember.execute({ text: '调试时记的事' })).message, /调试模式/)
  assert.equal(a.mind.memory.list({ q: '调试时记的事' }).length, 0)
  cfg = { ownerQQ: '1', debug: false }
  assert.equal(a.perceive({ chatId: 'private:1', kind: 'private', userId: '1', nickname: '主人', text: '正式说的话', messageId: 'd2' }), true, '关掉调试就照常记')
})

test('对接层：贴表情看她——睡着不贴，生 ta 气不贴，难过的话给安慰，好笑的跟着笑', async () => {
  const { a, set } = adapter()
  assert.match(a.reactWish({ userId: '2', text: '今天好累' }).pool.join(), /爱心/)
  assert.match(a.reactWish({ userId: '2', text: '哈哈哈笑死' }).pool.join(), /笑哭|捂脸/)
  assert.ok(a.reactWish({ userId: '1', text: '在吗' }).scale > a.reactWish({ userId: '2', text: '在吗' }).scale, '对你比对生人更愿意贴')
  a.mind.emotion.feel([{ name: '生气', intensity: 0.8, target: 'qq:2', why: '被骂了', importance: 0.5 }], { source: 'test' })
  assert.equal(a.reactWish({ userId: '2', text: '在吗' }).scale, 0)
  a.mind.body.sleepNow()
  assert.deepEqual(a.reactWish({ userId: '1', text: '在吗' }), { scale: 0, pool: [], why: '睡着了' })
  void set
})
