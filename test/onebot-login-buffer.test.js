// 登录核对期间收到的事件不能丢：核对通过后要补处理
// （真实场景：刚连上 QQ 那几百毫秒里，主人发一句话，以前会被直接丢掉）
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMockOneBot } from './helpers/mock-onebot.js'
import { createFakeDsh } from './helpers/fake-dsh.js'

const OWNER = '10000001'
const BOT = '20000002'
const FRIEND = '30000003'
const GROUP = '40000004'
const LOGIN_DELAY = 800 // 核对要慢一点，好让我们插进这个窗口
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 10000) => {
  const t = Date.now()
  while (Date.now() - t < ms) { if (await fn()) return true; await sleep(20) }
  return false
}

let mock
let fake
let dataDir
let host
// before() 里抓现场，test 里断言（避免测试里做时序操作）
const seen = {}

const priv = (text) => ({
  post_type: 'message', message_type: 'private', sub_type: 'friend',
  self_id: Number(BOT), user_id: Number(OWNER), time: Math.floor(Date.now() / 1000),
  message_id: Math.floor(Math.random() * 1e6),
  message: [{ type: 'text', data: { text } }],
  sender: { user_id: Number(OWNER), nickname: '主人' },
})
const sends = () => mock.calls.filter((c) => c.action === 'send_private_msg' && String(c.params.user_id) === String(OWNER))

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'aurabot-login-buffer-'))
  process.env.AURABOT_DATA_DIR = dataDir
  process.env.AURABOT_WORKSPACE = join(dataDir, 'ws')
  mock = await startMockOneBot({ selfId: BOT, loginDelayMs: LOGIN_DELAY })
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
    enabled: true,
    dryRun: false,
    setupDone: true,
    botQQ: BOT,
    ownerQQ: OWNER,
    allow: { private: [OWNER, FRIEND], groups: [GROUP] },
    // 连的是 mock，不是真的 SnowLuma
    snowluma: { autoStart: false, autoAttach: false, httpUrl: mock.httpUrl, wsUrl: mock.wsUrl, httpToken: mock.token, wsToken: mock.token, dir: join(dataDir, 'no-snowluma') },
    voice: { enabled: false },
    stickers: { autoChance: 0, collect: false },
    merge: { enabled: false },
  }))
  fake = createFakeDsh({ brain: async () => '收到啦' })
  host = await import('../src/host.js')
  host.apply(fake.ctx)

  // 全新启动：第一轮连接就在核对。注意 reconnect 要等核对通过才返回，所以先不 await
  const reconnect = fake.call('/onebot/reconnect').catch(() => null)
  const started = await until(() => mock.calls.some((c) => c.action === 'get_login_info'))
  assert.ok(started, '连接后应该发起登录核对')
  seen.loginCall = mock.calls.filter((c) => c.action === 'get_login_info').at(-1)

  // 核对还没通过（get_login_info 要 800ms 才回），这时候塞一条消息进去
  mock.push(priv('刚连上的这句话别丢'))

  await reconnect
  const replied = await until(() => sends().length > 0)
  seen.replied = replied
  seen.sent = sends().at(-1)
})

after(async () => {
  fake?.dispose()
  await mock?.close()
  setTimeout(() => process.exit(0), 200).unref()
})

test('核对期间收到的消息，核对通过后补处理（不丢）', () => {
  assert.ok(seen.replied, '核对期间那条消息应该被补处理，并收到回复')
  assert.match(String(seen.sent.params.message?.[0]?.data?.text || ''), /收到/)
  // 确实是被"补处理"的：回复发生在核对完成之后，而不是当场就处理了
  const gap = seen.sent.t - seen.loginCall.t
  assert.ok(gap >= LOGIN_DELAY - 200, `回复应晚于核对完成（实际 ${gap}ms）`)
})

test('面板读取的是已核对的 WebSocket 账号，刷新不重复请求登录接口', async () => {
  const count = () => mock.calls.filter((call) => call.action === 'get_login_info').length
  const before = count()
  const state = (await fake.call('/state')).json()
  assert.equal(state.onebot.login.uin, BOT)
  assert.equal(state.onebot.problem, '')
  assert.equal(count(), before)
})

test('从网关好友历史补收断线时的私聊，实时重投和重启都不会重复处理', async () => {
  const turnCount = () => fake.turns.filter((turn) => turn.userText.includes('离线时发的文字')).length
  const missed = { ...priv('离线时发的文字'), message_id: 420001 }
  const old = { ...priv('早就说过的文字'), message_id: 420002, time: missed.time - 180 }
  const other = { ...priv('白名单外的私聊'), message_id: 420003, user_id: 30000004, sender: { user_id: 30000004 } }
  const command = { ...priv('/silent'), message_id: 420004 }
  const media = { ...priv('带图片的历史'), message_id: 420005, message: [{ type: 'image', data: { file: 'image' } }] }
  mock.state.history = [other, missed, old, command, media, missed]

  assert.equal((await fake.call('/onebot/reconnect')).json().ok, true)
  assert.ok(await until(() => turnCount() === 1), '断线时只在历史里出现的私聊应进入 DSH')
  assert.ok(await until(() => sends().length >= 2), '补收的私聊应收到回复')
  mock.push(missed)
  mock.push({ ...missed, message_id: 420006 })
  assert.ok(await until(() => turnCount() === 2), '同样文字换了消息编号，视为新的一条')
  assert.equal(fake.turns.length, 3, '历史中的其他人、旧消息、命令和媒体都没有进入 DSH')
  const stored = readFileSync(join(dataDir, 'qq-inbox.json'), 'utf8')
  assert.ok(stored.includes('420001'))
  assert.ok(!stored.includes('离线时发的文字'))

  fake.dispose()
  fake = createFakeDsh({ brain: async () => '重启后也收到啦' })
  host.apply(fake.ctx)
  mock.state.history = [missed, { ...priv('重启间隙的新私聊'), message_id: 420007 }]
  assert.equal((await fake.call('/onebot/reconnect')).json().ok, true)
  assert.ok(await until(() => fake.turns.some((turn) => turn.userText.includes('重启间隙的新私聊'))))
  assert.equal(fake.turns.length, 1, '重启后的短窗口只补收新消息')
})

test('白名单好友和群聊也能补收，群聊仍按原规则决定是否回复', async () => {
  const friend = { ...priv('好友断线消息'), user_id: Number(FRIEND), sender: { user_id: Number(FRIEND) }, message_id: 420008 }
  const group = { ...friend, message_type: 'group', sub_type: 'normal', group_id: Number(GROUP), message: [
    { type: 'at', data: { qq: BOT } }, { type: 'text', data: { text: '群里断线艾特' } },
  ] }
  const outside = { ...group, group_id: 40000005, message_id: 420009 }
  const ambient = { ...group, message_id: 420010, message: [{ type: 'text', data: { text: '群友闲聊' } }] }
  const settings = await fake.call('/save', { allow: { private: [OWNER, FRIEND], groups: [GROUP] }, group: { overrides: { [GROUP]: { interjectChance: 0 } } } })
  assert.equal(settings.json().ok, true)
  mock.state.history = [outside, ambient, group, friend]
  mock.calls.length = 0
  assert.equal((await fake.call('/onebot/reconnect')).json().ok, true)
  assert.ok(await until(() => fake.turns.some((turn) => turn.userText.includes('好友断线消息'))))
  assert.ok(await until(() => fake.turns.some((turn) => turn.userText.includes('群里断线艾特'))))
  assert.ok(mock.calls.some(({ action, params }) => action === 'get_friend_msg_history' && params.user_id === Number(FRIEND)))
  assert.ok(mock.calls.some(({ action, params }) => action === 'get_group_msg_history' && params.group_id === Number(GROUP)))
  assert.ok(!mock.calls.some(({ action, params }) => action === 'get_group_msg_history' && params.group_id === outside.group_id))
  assert.ok(!fake.turns.some((turn) => turn.userText.includes('群友闲聊') && !turn.userText.includes('群里断线艾特')), '闲聊不单独触发回复')
  mock.push(group)
  mock.push(friend)
  mock.push({ ...friend, message_id: 420011, message: [{ type: 'text', data: { text: '下一条实时好友消息' } }] })
  assert.ok(await until(() => fake.turns.some((turn) => turn.userText.includes('下一条实时好友消息'))))
  assert.equal(fake.turns.filter((turn) => turn.userText.includes('好友断线消息')).length, 1)
  assert.equal(fake.turns.filter((turn) => turn.userText.includes('群里断线艾特')).length, 1)
})
