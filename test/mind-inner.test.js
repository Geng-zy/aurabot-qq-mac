// 第四阶段：本地小模型、内心活动（念头、感受和打算、重复就放空、越想越难受交给深想）、
// 动机（基本需要、具体想要、时间动机理论、犯懒、从结果里学）、主动找人、申请权限。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { createMind } from '../src/mind/index.js'
import { createMindAdapter } from '../src/mind-adapter/index.js'
import { createLocalModel } from '../src/mind/local/runner.js'
import { parseThought, overlap } from '../src/mind/inner/index.js'

const H = 3600000
const T0 = Date.UTC(2026, 10, 10, 6, 0) // 上海 14:00

// ---------- 本地小模型 ----------

test('本地小模型：没设或文件不对就说清楚原因；设好了要用时才启动，回答去掉思考过程，闲置太久自动停', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'local-'))
  try {
    let py = ''
    let model = ''
    const spawned = []
    let up = false
    const fakeSpawn = (cmd, args) => {
      const p = new EventEmitter()
      p.stderr = new EventEmitter()
      p.kill = () => { up = false; p.emit('exit', 0) }
      spawned.push([cmd, args])
      setTimeout(() => { up = true }, 5)
      return p
    }
    const fetch = async (url, init) => {
      if (!up) throw new Error('连不上')
      if (url.endsWith('/v1/models')) return { ok: true, json: async () => ({}) }
      const body = JSON.parse(init.body)
      assert.equal(body.messages[0].content, '你好')
      return { ok: true, json: async () => ({ choices: [{ message: { content: '<think>想一想</think>今天有点无聊' } }] }) }
    }
    let t = T0
    const m = createLocalModel({ python: () => py, modelDir: () => model, spawn: fakeSpawn, fetch, now: () => t, idleMinutes: 30 })
    assert.match(m.status().reason, /没设/)
    assert.equal(await m.chat([{ role: 'user', content: '你好' }]), null)
    py = join(dir, 'python'); writeFileSync(py, '')
    model = join(dir, 'model'); mkdirSync(model)
    assert.match(m.check().reason, /config\.json/)
    writeFileSync(join(model, 'config.json'), '{}')
    assert.equal(m.status().configured, true)
    assert.equal(spawned.length, 0, '没用之前不启动')
    assert.equal(await m.chat([{ role: 'user', content: '你好' }]), '今天有点无聊')
    assert.equal(spawned.length, 1)
    assert.deepEqual(spawned[0][1].slice(0, 3), ['-m', 'mlx_lm', 'server'])
    assert.ok(spawned[0][1].includes('{"enable_thinking":false}'), '关掉思考模式')
    t += 31 * 60000
    m.idleCheck()
    assert.equal(m.status().running, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('解析一步念头：四行格式；没写格式也取第一句；认不出的情绪不要', () => {
  const p = parseThought('念头：刚才群里在聊抽卡，好想也抽一发\n感受：期待 0.6\n打算：刷 B 站看看抽卡视频\n深想：否')
  assert.deepEqual(p, { thought: '刚才群里在聊抽卡，好想也抽一发', feel: { name: '期待', intensity: 0.6 }, plan: '刷 B 站看看抽卡视频', deep: false })
  assert.equal(parseThought('就是有点困').thought, '就是有点困')
  assert.equal(parseThought('念头：嗯\n感受：叽里咕噜 0.5').feel, null)
  assert.equal(parseThought('念头：嗯\n打算：无').plan, '')
  assert.ok(overlap('今天好无聊啊', '今天好无聊呀') > 0.7)
})

// ---------- 动机 ----------

function mind(at = T0, random = () => 0.5) {
  let t = at
  const m = createMind({ memoryDb: true, now: () => t, ownerId: 'qq:1', random })
  return { m, set: (v) => { t = v }, get: () => t }
}

test('基本需要：没人理的时候陪伴的需要慢慢涨，一整天就满了；聊天满足它', () => {
  const { m, set } = mind()
  const c0 = m.motivation.state().needs.find((n) => n.id === 'companion').deficit
  set(T0 + 24 * H)
  assert.equal(m.motivation.state().needs.find((n) => n.id === 'companion').deficit, 1)
  m.motivation.satisfy('companion', 0.6)
  assert.ok(Math.abs(m.motivation.state().needs.find((n) => n.id === 'companion').deficit - 0.4) < 1e-9)
  assert.ok(c0 < 0.5)
})

test('做还是不做：无聊了就去刷；累坏了就犯懒；做过了冷却一会儿；几件事里动力大的赢', async () => {
  const { m, set } = mind()
  const ran = []
  m.motivation.offer({ id: 'browse', label: '刷 B 站', needs: { fun: 1 }, effort: 0.15, delayHours: 0.05, cooldownMinutes: 60, run: async () => { ran.push('browse'); return { ok: true, outcome: 0.9 } } })
  m.motivation.offer({ id: 'write', label: '写日记', needs: { recognition: 1 }, effort: 0.6, delayHours: 2, run: async () => { ran.push('write'); return { ok: true } } })
  m.motivation.offer({ id: 'off', label: '做不了的', needs: { fun: 2 }, available: () => '没打开', run: async () => ({ ok: true }) })
  set(T0 + 8 * H) // 闲了八个小时，新鲜和乐趣缺得厉害
  const fresh = { body: { energy: 0.9, sleepiness: 0.3, hunger: 0 }, mood: { v: 0.1 } }
  assert.equal(m.motivation.choose(fresh).id, 'browse', '动力最大、能做的那件')
  assert.equal(m.motivation.motives(fresh).find((x) => x.id === 'off').why, '没打开')
  assert.equal(m.motivation.choose({ body: { energy: 0.02, sleepiness: 0.3, hunger: 0 }, mood: { v: -0.5 } }), null, '累坏了心情又差：犯懒')
  await m.motivation.act('browse')
  assert.deepEqual(ran, ['browse'])
  assert.notEqual(m.motivation.choose(fresh)?.id, 'browse', '刚做过，冷却中')
})

test('从结果里学：比预想的开心下次更想做，没做成就没那么想了；过后才知道的结果也能学', async () => {
  const { m } = mind()
  let outcome = { ok: true, outcome: 1 }
  m.motivation.offer({ id: 'x', label: 'x', needs: { fun: 1 }, payoff: 0.5, cooldownMinutes: 0, run: async () => outcome })
  await m.motivation.act('x')
  const after = m.motivation.state().learned.x.expect
  assert.ok(Math.abs(after - 0.6) < 1e-9, '0.5 + 0.2 ×（1 − 0.5）')
  outcome = { ok: false }
  await m.motivation.act('x')
  assert.ok(m.motivation.state().learned.x.expect < after)
  assert.ok(m.motivation.state().learned.x.success < 0.8)
  m.motivation.feedback('x', 1)
  assert.ok(m.motivation.state().learned.x.expect > 0.5)
})

test('具体想要：很像的不重复记，会加强；对上某件事就算它的动力；做到了就消失；一周没动静就淡了', async () => {
  const { m, set } = mind()
  m.motivation.offer({ id: 'browse', label: '刷 B 站', needs: { fun: 0.1 }, keywords: ['B站'], cooldownMinutes: 0, run: async () => ({ ok: true }) })
  const w = m.motivation.want('想去B站看抽卡视频')
  assert.equal(m.motivation.want('想去B站看抽卡视频').id, w.id)
  const st = { body: { energy: 1, sleepiness: 0.2, hunger: 0 }, mood: { v: 0 } }
  assert.deepEqual(m.motivation.motives(st)[0].wants, ['想去B站看抽卡视频'])
  await m.motivation.act('browse')
  assert.equal(m.motivation.state().wants.length, 0, '做到了')
  m.motivation.want('想把那首歌唱好', { strength: 0.3 })
  set(T0 + 30 * 24 * H)
  assert.equal(m.motivation.state().wants.length, 0, '一个月没动静，淡了')
})

// ---------- 内心活动 ----------

function innerMind({ reply, ask, random = () => 0.5 } = {}) {
  const { m, set, get } = mind(T0, random)
  const calls = []
  m.inner.connect({
    local: { chat: async (msgs) => { calls.push(msgs); return typeof reply === 'function' ? reply(calls.length) : reply } },
    ask: ask || null,
  })
  return { m, set, get, calls }
}

test('想一步：材料里有身体、心情和刚才的事（标明是谁说的）；念头只进内心日记，不进记忆；感受和打算留下', async () => {
  const { m, calls } = innerMind({ reply: '念头：主人刚才说要加班，他会不会很累\n感受：心疼 0.6\n打算：想找主人说话，问问他吃饭没\n深想：否' })
  m.perceive({ window: 'qq:private:1', who: 'qq:1', name: '主人', text: '今天要加班到很晚', at: T0 - 600000 })
  const before = m.memory.list().length
  const st = await m.inner.step()
  assert.equal(st.thought, '主人刚才说要加班，他会不会很累')
  const prompt = calls[0][1].content
  assert.match(prompt, /【身体】/)
  assert.match(prompt, /私聊里 主人说：今天要加班到很晚/)
  assert.equal(m.memory.list().length, before, '小模型的念头不进记忆')
  assert.ok(m.emotion.state().active.some((e) => e.name === '心疼'))
  const w = m.motivation.state().wants[0]
  assert.equal(w.action, 'reach_owner', '想找主人 → 对上「找主人说话」')
  assert.equal(m.inner.diary()[0].thought, st.thought)
})

test('想不出新东西：连着重复就放空，无聊感上升，不再产生感受', async () => {
  const { m } = innerMind({ reply: '念头：好无聊啊什么都不想干\n感受：无聊 0.5' })
  await m.inner.step()
  const b1 = m.inner.boredom()
  const st = await m.inner.step()
  assert.equal(st.repeated, true)
  assert.ok(m.inner.boredom() > b1)
})

test('越想越难受：交给 DeepSeek 深想一次；想明白的「我觉得」记成看法，别的不记', async () => {
  const lines = ['念头：大家好像都不太理我\n感受：失落 0.4', '念头：可能我太烦了\n感受：难过 0.5', '念头：我是不是做错了什么\n感受：自责 0.7']
  const asked = []
  const { m } = innerMind({
    reply: (n) => lines[n - 1],
    ask: async (o) => { asked.push(o.scene); return '{"thought":"他只是在加班，不是不理我","feel":{"n":"安心","i":0.5,"reg":"reappraise"},"belief":"我觉得他忙的时候不回消息不代表不在乎","want":""}' },
  })
  await m.inner.step()
  await m.inner.step()
  const st = await m.inner.step()
  assert.deepEqual(asked, ['deep'])
  assert.equal(st.deep.reason, '越想越难受')
  assert.ok(m.memory.list({ kind: 'belief' }).some((x) => x.gist.startsWith('我觉得他忙的时候')))
  assert.ok(m.emotion.state().active.some((e) => e.name === '安心'))
})

test('没装本地小模型：用 DeepSeek 想（受预算限制）；关掉这个选项就不想', async () => {
  const { m } = innerMind({ reply: null, ask: async (o) => (o.scene === 'think' ? '念头：下午好安静' : '') })
  assert.equal((await m.inner.step()).by, 'deepseek')
  m.updateSettings({ 'attention.thinkWithoutLocal': false })
  assert.equal(await m.inner.step(), null)
})

// ---------- 对接层：想、做、发呆；主动找你；权限 ----------

function adapter({ random = () => 0.1, reply = '念头：有点想他\n感受：思念 0.5\n打算：想找主人说话\n深想：否' } = {}) {
  let t = T0
  const sent = []
  const a = createMindAdapter({
    memoryDb: true, getConfig: () => ({ ownerQQ: '1', freedom: false }), now: () => t, random,
    localModel: { chat: async () => reply, status: () => ({ configured: true }), idleCheck() {}, stop() {}, check: () => ({ ok: true }) },
    reachOut: async (o) => { sent.push(o) },
    ask: async () => '{}',
  })
  return { a, sent, set: (v) => { t = v }, get: () => t }
}

test('闲着时：按走神比例想一步，想找主人的念头够强就去找；找了你没回之前不再追着发', async () => {
  const { a, sent, set } = adapter()
  set(T0 + 20 * H) // 一整天没人理
  const r = await a.innerTick()
  assert.ok(r.thought, '想了一步')
  await new Promise((x) => setTimeout(x, 10))
  assert.equal(sent.length, 1)
  assert.equal(sent[0].chatId, 'private:1')
  assert.match(sent[0].note, /你想主动找主人说话/)
  assert.match(sent[0].note, /不要编/)
  assert.equal(a.mind._store.get('outreach').pending !== null, true)
  set(T0 + 20.5 * H)
  a.mind._store.set('inner.clock', { nextAt: 0, lastAt: 0 })
  await a.innerTick()
  await new Promise((x) => setTimeout(x, 10))
  assert.equal(sent.length, 1, '上次的还没回，不追着发')
})

test('你回了她开心、下次更愿意找你；一直不回她有点失落', async () => {
  const { a, set } = adapter()
  await a.reachOwner('想他了')
  a.perceive({ chatId: 'private:1', kind: 'private', userId: '1', nickname: '主人', text: '在呢', messageId: 'r1' })
  assert.equal(a.mind._store.get('outreach').pending, null)
  assert.ok(a.mind.emotion.state().active.some((e) => e.name === '快乐' && e.why === '找他，他回了'))
  set(T0 + 3 * H)
  await a.reachOwner('又想他了')
  set(T0 + 6 * H)
  await a.innerTick()
  assert.ok(a.mind.emotion.state().active.some((e) => e.name === '失落' && e.why === '找他，他没回'))
})

test('勿扰时段和每天上限是你的要求，她遵守', async () => {
  const { a, set } = adapter()
  a.mind.updateSettings({ 'motivation.quietHours': '13:00-15:00' })
  assert.equal((await a.reachOwner('想他')).summary, '勿扰时段')
  a.mind.updateSettings({ 'motivation.quietHours': '', 'motivation.dailyOutreachCap': 1 })
  assert.equal((await a.reachOwner('想他')).ok, true)
  a.perceive({ chatId: 'private:1', kind: 'private', userId: '1', text: '嗯', messageId: 'r2' })
  set(T0 + 2 * H)
  assert.equal((await a.reachOwner('想他')).summary, '今天找够了')
})

test('申请权限：私聊问你，带编号；只有你本人在私聊里说「同意 #N」才算，群里替你说、别人说都不算；能收回', async () => {
  const { a, sent } = adapter()
  const r = await a.requestPermission('qqSignature', '自己改 QQ 签名', '想写点心情')
  assert.match(r.message, /#1/)
  assert.match(sent[0].note, /同意 #1/)
  assert.equal(a.granted('qqSignature'), false)
  a.perceive({ chatId: 'group:9', kind: 'group', userId: '1', text: '同意 #1', messageId: 'g1' })
  a.perceive({ chatId: 'private:2', kind: 'private', userId: '2', text: '同意 #1', messageId: 'p2' })
  assert.equal(a.granted('qqSignature'), false)
  assert.match((await a.requestPermission('qqSignature', '自己改 QQ 签名', '想写点心情')).message, /已经问过了/)
  a.perceive({ chatId: 'private:1', kind: 'private', userId: '1', text: '好，同意 #1', messageId: 'p1' })
  assert.equal(a.granted('qqSignature'), true)
  assert.equal(a.moduleApi('profile').granted('qqSignature'), true)
  a.revoke('qqSignature')
  assert.equal(a.granted('qqSignature'), false)
  await a.requestPermission('x', '用某个工具', '想试试')
  assert.equal(a.decide(2, false).granted, false, '面板里不批')
})

test('睡着、刚聊完、正在做事时不走神；内心活动可以关掉', async () => {
  const { a, set } = adapter()
  a.mind.body.sleepNow()
  assert.equal(await a.innerTick(), null)
  a.wakeUp('1')
  a.noteTurn('private:1', ['1'])
  assert.equal(await a.innerTick(), null, '刚聊完')
  set(T0 + 10 * 60000)
  a.mind.updateSettings({ 'attention.inner': false })
  assert.equal(await a.innerTick(), null)
})

test('模块交给她的事：按动力去做；模块停了就撤掉', async () => {
  const { a, set } = adapter({ reply: '念头：好无聊\n打算：无' })
  let n = 0
  const off = a.moduleApi('bili').offer({ id: 'browse', label: '刷 B 站', needs: { fun: 1 }, effort: 0.1, run: async () => { n++; return { ok: true, outcome: 0.8 } } })
  a.mind.updateSettings({ 'motivation.dailyOutreachCap': 0, 'motivation.quietHours': '00:00-23:59' }) // 不让「找主人」抢
  set(T0 + 10 * H)
  await a.innerTick()
  await new Promise((x) => setTimeout(x, 10))
  assert.equal(n, 1)
  assert.ok(a.mind.motivation.state().actions.some((x) => x.id === 'bili:browse'))
  off()
  assert.ok(!a.mind.motivation.state().actions.some((x) => x.id === 'bili:browse'))
})
