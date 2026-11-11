// 接 QQ 卡住时的一键诊断（Mac 版，参考原项目 b27ef5a 的思路重写）。
// 这台 Mac 上的链路是：OrbStack / Docker Desktop → SnowLuma 容器（里面跑 QQ）→ OneBot 端口 → 插件。
// 插件只负责连，不启动、不注入任何东西；所以诊断就是顺着这条链路一项项看，卡在哪一项就告诉你怎么修。
// 每项 { label, ok, detail, hint }；ok = true 通过、false 有问题、null 没法查（不算失败）。
// 顺序有讲究：前面一项不通，后面的多半也不通，所以只把第一个失败项当「卡在这里」。

import net from 'node:net'
import { execFile } from 'node:child_process'

const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0'])

/** 本机端口有没有人在听。 */
export function tcpOpen(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      try { socket.destroy() } catch (error) {}
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

/** 跑一条只读命令，拿输出；跑不了返回 null。 */
function run(cmd, args, timeoutMs = 4000) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs }, (error, stdout) => resolve(error ? null : String(stdout || '')))
    } catch (error) { resolve(null) }
  })
}

/** 有没有一个叫这个名字的进程在跑（pgrep -x）。 */
async function processRunning(name) {
  const out = await run('/usr/bin/pgrep', ['-x', name])
  return out === null ? false : out.trim().length > 0
}

/** ws://host:port/path → { host, port }；不是合法地址返回 null。 */
export function hostPort(url, fallbackPort) {
  try {
    const u = new URL(String(url))
    const port = Number(u.port) || (u.protocol === 'wss:' || u.protocol === 'https:' ? 443 : u.protocol === 'ws:' || u.protocol === 'http:' ? 80 : fallbackPort)
    return { host: u.hostname.replace(/^\[|\]$/g, ''), port }
  } catch (error) {
    return null
  }
}

/**
 * @param {object} o
 * @param {object} o.cfg 插件配置
 * @param {string} o.state OneBot 连接状态（connected / connecting / …）
 * @param {string} [o.wrongAccount] 连上的号不是机器人号时，那个号
 * @param {(action: string, params?: object, opts?: object) => Promise<any>} o.call 调 OneBot
 * @param {object} [o.probe] 测试时替换：{ tcpOpen, processRunning, docker }
 */
export async function diagnose({ cfg, state, wrongAccount = '', call, probe = {} }) {
  const open = probe.tcpOpen || tcpOpen
  const running = probe.processRunning || processRunning
  const dockerPs = probe.docker || (() => run('docker', ['ps', '--format', '{{.Names}}\t{{.Image}}\t{{.Status}}']))
  const items = []
  const add = (label, ok, detail, hint = '') => items.push({ label, ok, detail, hint })
  const s = cfg.snowluma || {}

  // 1. 插件自己的设置
  add('总开关', cfg.enabled === true, cfg.enabled ? '开着' : '关着', '右上角打开总开关，插件才会去连')
  add('机器人 QQ 号', Boolean(cfg.botQQ), cfg.botQQ || '没填', '在「连接」页填机器人小号的 QQ 号')
  const ws = hostPort(s.wsUrl, 3001)
  add('WebSocket 地址', Boolean(ws), s.wsUrl || '没填', '填 SnowLuma 的 OneBot 正向 WebSocket 地址，比如 ws://127.0.0.1:3001（收消息靠它）')
  const http = s.httpUrl ? hostPort(s.httpUrl, 3000) : null
  if (s.httpUrl) add('HTTP 地址', Boolean(http), s.httpUrl, 'HTTP 可以不填；填了要是 http://主机:端口 这种')

  // 2. 网关在不在：本机的话顺着看 OrbStack / Docker → SnowLuma 容器 → 端口
  const local = ws && LOCAL.has(ws.host)
  if (local) {
    const engines = []
    for (const name of ['OrbStack', 'Docker Desktop', 'com.docker.backend']) if (await running(name)) engines.push(name === 'com.docker.backend' ? 'Docker Desktop' : name)
    add('OrbStack / Docker', engines.length > 0, engines.length ? [...new Set(engines)].join('、') + ' 在跑' : '都没在跑', '先打开 OrbStack（或 Docker Desktop），SnowLuma 容器在它里面')
    const ps = engines.length ? await dockerPs() : null
    if (ps === null) add('SnowLuma 容器', null, engines.length ? '没法用 docker 命令查（不影响，看下一项端口）' : '容器引擎没开，先不查', '')
    else {
      const line = ps.split('\n').find((l) => /snowluma/i.test(l))
      add('SnowLuma 容器', Boolean(line && /\bUp\b/i.test(line)), line ? line.split('\t').filter(Boolean).join(' · ') : '没找到名字带 snowluma 的容器',
        line ? '容器没在运行：在 OrbStack 里启动它' : '用 SnowLuma 官方的 docker-compose.yml 起一个（见使用手册「接上 QQ」）')
    }
    const desk = await open(6081, '127.0.0.1')
    add('远程桌面（登录 QQ 用）', desk ? true : null, desk ? 'http://127.0.0.1:6081 开着' : '6081 端口没开（如果你改过端口就忽略）', '在浏览器打开 http://127.0.0.1:6081 登录机器人号')
  }
  if (ws) {
    const up = await open(ws.port, local ? '127.0.0.1' : ws.host, local ? 800 : 3000)
    add(`WebSocket 端口 ${ws.host}:${ws.port}`, up, up ? '有服务在听' : '没有服务在听',
      local ? 'SnowLuma 的 OneBot 没开或端口不对：在 SnowLuma 控制台里启用 OneBot 的正向 WebSocket，端口要和这里填的一样，并且容器把这个端口映射出来' : '连不到那台机器的这个端口：看看地址、防火墙和那边的服务')
  }
  if (http) {
    const up = await open(http.port, LOCAL.has(http.host) ? '127.0.0.1' : http.host, LOCAL.has(http.host) ? 800 : 3000)
    add(`HTTP 端口 ${http.host}:${http.port}`, up, up ? '有服务在听' : '没有服务在听', '在 SnowLuma 控制台里启用 OneBot 的 HTTP 服务，或者把 HTTP 地址清空（只用 WebSocket 也行）')
  }

  // 3. 连上之后：登的是不是机器人号、QQ 在不在线
  const connected = state === 'connected'
  add('插件连上网关', connected, connected ? '连上了' : `现在是「${state || '未连接'}」`, 'token 填错也会连不上：对一下 SnowLuma 里 OneBot 的 token 和这里填的是不是一样，然后点「重新连接」')
  if (connected) {
    let info = null
    try { info = await call('get_login_info', {}, { timeoutMs: 6000 }) } catch (error) {}
    const uin = String(info?.user_id ?? '')
    if (!uin) add('登录的号', null, '网关没回登录信息', '')
    else add('登录的号', uin === String(cfg.botQQ), `${info.nickname || ''}（${uin}）`, `网关登录的不是机器人号 ${cfg.botQQ}：在远程桌面里换成机器人号登录`)
    let st = null
    try { st = await call('get_status', {}, { timeoutMs: 6000 }) } catch (error) {}
    if (st && typeof st.online === 'boolean') add('QQ 在线', st.online, st.online ? '在线' : '掉线了', '在远程桌面里看看 QQ 是不是被踢下线、要不要重新扫码')
  } else if (wrongAccount) {
    add('登录的号', false, wrongAccount, `网关登录的是 ${wrongAccount}，不是机器人号 ${cfg.botQQ}，插件已经断开：在远程桌面里换成机器人号登录`)
  }

  const first = items.find((x) => x.ok === false)
  return { ok: !first, items, problem: first ? `卡在「${first.label}」：${first.hint || first.detail}` : '' }
}
