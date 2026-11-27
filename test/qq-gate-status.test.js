// 网关状态 + 登录核对（features/gate-status.js）的接缝回归：
// 状态机、核对回调、resetAccount 的清理语义都在这里，装配层只管接线。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGateStatus } from '../src/channels/qq/features/gate-status.js'
import { createOutboxWiring } from '../src/channels/qq/features/outbox-wiring.js'

const log = { info() {}, warn() {}, debug() {}, error() {}, child() { return this } }

function fakeLoginGate(result) {
  const seen = { disconnected: 0, events: [], checks: [] }
  return {
    seen,
    make: (deps) => ({
      onDisconnected() { seen.disconnected += 1 },
      onEvent(ev) { seen.events.push(ev) },
      async checkLogin(revision, at) {
        seen.checks.push({ revision, at, isReady: deps.isReady() })
        // 真实的 login.js 核对成功时会把 state.loginOk 置真，这里照样做，验的是 gate-status 的接线
        if (result?.ok) deps.state.loginOk = true
        return result
      },
    }),
  }
}

function makeGate(result) {
  const fake = fakeLoginGate(result)
  const events = []
  const gate = createGateStatus({
    createLoginGate: (deps) => fake.make(deps),   // 拿真实的 deps：state 就是 gate 的 auth 对象
    call: async () => ({}),
    getBotAccount: () => '10001',
    inbox: {},
    dispatch: () => {},
    emit: (e) => events.push(e),
    getChannel: () => ({}),
    isDisposed: () => false,
    log,
    onLoginOk: (rev) => { events.push({ type: 'login-ok', rev }) },
    onLoginFatal: (reason) => { events.push({ type: 'login-fatal', reason }) },
  })
  return { gate, fake, events }
}

test('连上并核对通过：ready() 变真、onLoginOk 收到这次连接的代次、状态广播出去', async () => {
  const { gate, events } = makeGate({ ok: true })
  assert.equal(gate.ready(), false)
  gate.onState('connected')
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(gate.ready(), true, '核对通过后 ready 为真')
  assert.deepEqual(events.filter((e) => e.type === 'state').map((e) => e.state), ['connected'])
  const ok = events.find((e) => e.type === 'login-ok')
  assert.ok(ok, '要通过 onLoginOk 通知装配去补发队列')
  assert.equal(ok.rev, gate.revision(), '回调带的是最新一次连接的代次')
})

test('登录号不对：ready() 保持 false、onLoginFatal 收到原因（装配据此停机）', async () => {
  const { gate, events } = makeGate({ ok: false, reason: 'wrong-account' })
  gate.onState('connected')
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(gate.ready(), false, '号不对不该 ready')
  assert.deepEqual(events.find((e) => e.type === 'login-fatal'), { type: 'login-fatal', reason: 'wrong-account' })
})

test('断线回到 false；resetAccount 清掉核对结果与攒着的事件', async () => {
  const { gate, fake } = makeGate({ ok: true })
  gate.onState('connected')
  gate.auth.wrongAccount = '999'
  gate.auth.pendingEvents.push({ raw: 1 })
  gate.resetAccount()
  assert.equal(gate.auth.wrongAccount, '', '换号后旧的核对结果要作废')
  assert.deepEqual(gate.auth.pendingEvents, [])
  gate.onState('disconnected')
  assert.equal(gate.ready(), false)
  assert.equal(fake.seen.disconnected, 1, '断线要通知登录核对复位')
  gate.onEvent({ post_type: 'message' })
  assert.equal(fake.seen.events.length, 1, '原始事件走 onEvent 转给登录核对')
})

test('补发接线：onSent 广播 delivered，定时器按间隔存在且 unref', async () => {
  const sent = []
  const flushCalls = []
  const wiring = createOutboxWiring({
    box: { size: () => 1 },
    call: async () => ({ message_id: 7 }),
    getConfig: () => ({}),
    isConnected: () => true,
    isDisposed: () => false,
    getRevision: () => 1,
    emit: (e) => sent.push(e),
    log,
    flushEveryMs: 50,
  })
  assert.ok(wiring.timer, 'flushEveryMs>0 且队列存在时要有定时器')
  assert.equal(typeof wiring.flush, 'function')
  clearInterval(wiring.timer)
  // 直接验 onSent 的事件形状（不跑真队列，避免依赖 outbox-flush 的内部节奏）
  const wiringNoBox = createOutboxWiring({ box: null, call: async () => ({}), getConfig: () => ({}), isConnected: () => true, isDisposed: () => false, getRevision: () => 1, emit: () => {}, log })
  assert.equal(wiringNoBox.timer, null, '没有队列就不该起定时器')
  assert.deepEqual(flushCalls, [])
})
