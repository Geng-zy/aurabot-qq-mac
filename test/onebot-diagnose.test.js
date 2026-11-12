// 接 QQ 一键诊断（Mac）：顺着 OrbStack → SnowLuma 容器 → 端口 → 连上 → 登录的号 → 在线 看，指出卡在哪一项。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diagnose, hostPort } from '../src/channels/qq/diagnose.js'

const cfg = (snowluma = { wsUrl: 'ws://127.0.0.1:3001' }) => ({ enabled: true, botQQ: '9', snowluma })
const probe = ({ engines = ['OrbStack'], ps = 'snowluma\tsnowluma:latest\tUp 3 days', ports = [3001, 6081] } = {}) => ({
  processRunning: async (name) => engines.includes(name),
  docker: async () => ps,
  tcpOpen: async (port) => ports.includes(port),
})
const label = (r, l) => r.items.find((x) => x.label.startsWith(l))

test('全都正常：没有问题，查到登录的是机器人号、QQ 在线', async () => {
  const call = async (a) => (a === 'get_login_info' ? { user_id: 9, nickname: '小鱼' } : { online: true })
  const r = await diagnose({ cfg: cfg(), state: 'connected', call, probe: probe() })
  assert.equal(r.ok, true)
  assert.equal(r.problem, '')
  assert.equal(label(r, '登录的号').ok, true)
  assert.equal(label(r, 'QQ 在线').ok, true)
})

test('OrbStack 没开：卡在这一项，提示先打开它', async () => {
  const r = await diagnose({ cfg: cfg(), state: 'connecting', call: async () => ({}), probe: probe({ engines: [], ports: [] }) })
  assert.equal(r.ok, false)
  assert.match(r.problem, /OrbStack \/ Docker/)
  assert.match(r.problem, /打开 OrbStack/)
})

test('容器在但端口没开：指出 OneBot 正向 WebSocket 没启用或端口不对', async () => {
  const r = await diagnose({ cfg: cfg(), state: 'connecting', call: async () => ({}), probe: probe({ ports: [6081] }) })
  assert.match(r.problem, /WebSocket 端口/)
  assert.match(label(r, 'WebSocket 端口').hint, /启用 OneBot 的正向 WebSocket/)
})

test('登的不是机器人号、QQ 掉线：都标出来', async () => {
  const call = async (a) => (a === 'get_login_info' ? { user_id: 8, nickname: '别人' } : { online: false })
  const r = await diagnose({ cfg: cfg(), state: 'connected', call, probe: probe() })
  assert.equal(label(r, '登录的号').ok, false)
  assert.equal(label(r, 'QQ 在线').ok, false)
  assert.match(r.problem, /登录的号/)
})

test('没填地址、地址不在本机：不查 OrbStack，直接说要填 / 查远端端口', async () => {
  const empty = await diagnose({ cfg: cfg({}), state: 'stopped', call: async () => ({}), probe: probe() })
  assert.match(empty.problem, /WebSocket 地址/)
  const remote = await diagnose({ cfg: cfg({ wsUrl: 'ws://10.0.0.5:3001' }), state: 'connecting', call: async () => ({}), probe: probe({ ports: [] }) })
  assert.equal(label(remote, 'OrbStack'), undefined)
  assert.match(remote.problem, /10\.0\.0\.5:3001/)
})

test('地址解析：0.0.0.0 当本机，端口缺省按协议', () => {
  assert.deepEqual(hostPort('ws://0.0.0.0:3001'), { host: '0.0.0.0', port: 3001 })
  assert.deepEqual(hostPort('wss://bot.example.com/onebot'), { host: 'bot.example.com', port: 443 })
  assert.equal(hostPort('不是地址'), null)
})
