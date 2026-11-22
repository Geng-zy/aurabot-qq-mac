// 面板接口的 HTTP 小工具与访问闸。
//
// 这里是插件的管理面边界：DSH 的 webServer 没有服务器级鉴权，所以本机闸、Host 闸
// （DNS rebinding）和 CSRF 闸都在这一层统一处理。路由表本身留在 host.js。
import { isIP } from 'node:net'
import { StringDecoder } from 'node:string_decoder'
import { redact } from '../core/redact.js'

/**
 * @param {object} deps
 * @param {() => object} deps.getConfig
 * @param {object} deps.log
 * @param {string} deps.prefix 管理接口前缀（/aurabot/api）
 */
export function createHttpKit({ getConfig, log, prefix: PREFIX }) {
  const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    try {
      res.statusCode = code
      res.setHeader?.('content-type', type)
      res.setHeader?.('cache-control', 'no-store')
      res.end?.(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
    } catch (error) {}
  }
  const readBody = async (req, max = 2 * 1024 * 1024) => {
    let s = ''
    let n = 0
    const decoder = new StringDecoder('utf8')
    try {
      for await (const c of req) {
        const part = Buffer.isBuffer(c) ? c : Buffer.from(c)
        n += part.length
        if (n > max) throw new Error(`请求内容太大了（最多 ${Math.round(max / 1024 / 1024)}MB）`)
        s += decoder.write(part)
      }
      s += decoder.end()
    } catch (error) { throw new Error(error.message || '请求内容没有接收完整') }
    if (!s.trim()) return {}
    let body
    try { body = JSON.parse(s) } catch (error) { throw new Error('请求内容不是有效的 JSON') }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('请求内容需要是一个 JSON 对象')
    return body
  }
  /** 原样读请求体（上传大文件用），超过 max 字节就报错。 */
  const readRaw = async (req, max) => {
    const parts = []
    let n = 0
    for await (const c of req) {
      const b = Buffer.isBuffer(c) ? c : Buffer.from(c)
      n += b.length
      if (n > max) throw new Error(`文件太大了（最多 ${Math.round(max / 1024 / 1024)}MB）`)
      parts.push(b)
    }
    return Buffer.concat(parts)
  }
  const query = (req) => {
    try { return Object.fromEntries(new URL(req.url, 'http://x').searchParams) } catch (error) { return {} }
  }
  // 核心自己的接口登记成精确路径；模块的接口都走一个前缀路由，请求进来再查表
  // （模块随时开关、重新加载；关着的模块的接口回「模块没开」，面板不会白屏）
  const answer = async (res, fn) => {
    try {
      const r = await fn()
      if (r !== undefined) send(res, 200, r)
    } catch (error) {
      send(res, 200, { ok: false, message: redact(String(error && error.message ? error.message : error)) })
    }
  }
  // ---------- 面板级访问闸（安全基线，2026-11-02） ----------
  // 背景：DSH 的 webServer 对插件路由**没有服务器级鉴权**，而面板接口是给本机面板用的管理接口
  //（能改配置、能装模块、能取联动密钥、能下客户端包）。同机部署时它只绑回环，本来打不到；
  // 但一旦用户把插件端口经反代发布到公网，整组管理接口就裸奔了。
  // 因此：**所有管理面默认只允许回环访问**。要做远端管理必须显式开 panelRemoteAccess（并在
  // 反代层再加一道认证——README 写明这是硬要求）。
  // 【首审 P1-1】闸的覆盖范围不能只有 /panel/*：/state（能读到全部配置与密钥）、/save（能改配置）、
  // /logs、/modules*（能装代码）、/bridge/token（直接返回联动密钥）
  // 这些**都是管理面**，必须一起纳入。/ext/<模块>/* 由模块路由自己的管理面策略处理；/asset/* 路由并不存在。
  const isLoopbackAddr = (ip) => {
    const s = String(ip || '').trim().replace(/^\[|\]$/g, '')
    if (s === '::1') return true
    const fam = isIP(s)
    if (fam === 4) return /^127\./.test(s)
    if (fam === 6) return /^::ffff:127\./i.test(s) || /^::ffff:7f00:/i.test(s)
    return false
  }
  const normAddr = (ip) => String(ip || '').trim().replace(/^::ffff:/i, '').replace(/^\[|\]$/g, '')
  /** 可信反代地址列表（security.trustedProxy，逗号分隔；留空 = 从不相信任何转发头）。 */
  const trustedProxies = () => String(getConfig().security?.trustedProxy || '').split(',').map(normAddr).filter(Boolean)
  /** 请求是否来自本机回环。
   *  【首审 P1-2 修法】**socket 地址才是唯一可信来源**，X-Forwarded-For 是客户端自己能写的头。
   *  旧实现「有 XFF 就只认最后一跳、不看 socket」→ 直连暴露时客户端自带
   *  `X-Forwarded-For: 127.0.0.1` 就能 200 绕过（含联动令牌）。
   *  新口径：
   *    ① socket 非回环 → 一律按 socket 判，转发头完全不看；
   *    ② socket 是回环且来源命中 trustedProxy → 才采信 XFF 的**最后一跳**（反代追加的真实来源）；
   *    ③ 其余（本机直连 / 进程内直调）→ 算本机。 */
  const requestIsLocal = (req) => {
    const sock = normAddr(req?.socket?.remoteAddress || req?.connection?.remoteAddress || '')
    // 没有 socket 信息 = 进程内直调（测试 / 内部转发），按本机处理。
    // 真实 HTTP 请求一定有 remoteAddress，所以这里不会削弱对外拦截。
    if (!sock) return true
    if (!isLoopbackAddr(sock)) return false // ① 直连：只信 socket
    const list = trustedProxies()
    if (list.length && list.includes(sock)) { // ② 可信反代：看最后一跳
      const hops = String(req?.headers?.['x-forwarded-for'] || '').split(',').map((x) => normAddr(x)).filter(Boolean)
      if (hops.length) return isLoopbackAddr(hops[hops.length - 1])
      // 【复审 2·P1-1】反代场景却没带 XFF：反代没配好（没追加转发头）。按回环放行等于
      // 「反代后的所有用户都被当成本机」——这是 fail-open。兜成 fail-closed：拒绝。
      return false
    }
    return isLoopbackAddr(sock) // ③ 本机直连
  }
  const panelNeedsLocal = () => getConfig().security?.panelRemoteAccess !== true
  /** 管理面白名单：这些前缀之外的一律不算管理接口（客户端直连用的模块接口与素材不拦）。 */
  const ADMIN_EXEMPT_PREFIXES = [PREFIX + '/ext/', PREFIX + '/asset/', PREFIX + '/open/']
  /** 面板闸：命中管理面且不允许远端时拒绝。
   *  【首审 P1-1】从「只拦 /panel/*」扩到「拦整个 PREFIX 下除客户端接口外的所有路由」——
   *  默认拒绝比逐条列举安全：将来新增管理路由忘了登记也不会裸奔。
   *  【复审 P1-2】/open/* 是给外部程序（curl / 脚本）用的开放接口，有自己的
   *  `Authorization: Bearer 密钥` 鉴权（bridge.authorized），跨机带正确密钥必须放行——
   *  它不是浏览器面板的一部分，不该被本机闸拦。 */
  const panelBlocked = (req, res, force = false) => {
    let path = ''
    try { path = new URL(req.url, 'http://x').pathname } catch { return false }
    if (!path.startsWith(PREFIX + '/') && path !== PREFIX) return false
    if (!force && ADMIN_EXEMPT_PREFIXES.some((p) => path.startsWith(p))) return false
    if (!panelNeedsLocal()) return false
    if (requestIsLocal(req)) return false
    log.warn(`管理接口拒绝远端访问：${path}（来源不是回环；如需远端管理请开 security.panelRemoteAccess 并在反代加认证）`)
    send(res, 403, { ok: false, message: '管理接口只允许本机访问。远端管理需在配置里显式开启 security.panelRemoteAccess，并务必在反向代理层再加一道认证' })
    return true
  }
  /** 面板对外主机名（security.publicHostname，反代部署时填面板对外域名；空 = 只有回环算同源）。 */
  const panelPublicHost = () => String(getConfig().security?.publicHostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  /** Origin 主机名是否算「同源」：回环 / localhost / 已配置的面板对外域名。 */
  const originAllowed = (hostname) => {
    const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
    if (!h) return false
    if (h === 'localhost' || h.endsWith('.localhost') || isLoopbackAddr(h)) return true
    const ph = panelPublicHost()
    return Boolean(ph) && h === ph
  }
  /**
   * 【复审 2·P1-1】管理面 Host 允许名单（防 DNS rebinding）。
   * 攻击：恶意页面把 evil.example 的 DNS rebind 到 127.0.0.1，然后 `fetch('http://evil.example:port/state')`
   * ——socket 是本机回环（本机闸放行）、方法是 GET（不过 CSRF）→ 管理面被「同源可读」：
   * /state、/logs、/bridge/token（返回 bearer）、联动令牌全部外泄。
   * 修法：管理面请求的 Host 头必须在白名单内（回环 / localhost / publicHostname）。
   * Host 头虽是请求方可控的，但浏览器同源策略保证「页面 JS 发出的请求 Host = 页面所在的源」——
   * rebinding 页面发出的 Host 就是 evil.example 本身，进不了白名单；同源面板请求 Host 必然是
   * 127.0.0.1 / localhost / publicHostname 之一。非浏览器客户端（curl/脚本）不受浏览器防护，
   * 但它们也不是 rebinding 载体，且有各自的鉴权层。
   */
  const hostAllowedForAdmin = (hostRaw) => {
    // 复审 3·小建议：先剥端口再剥方括号。IPv6 回环 Host 是 `[::1]:5099`——
    // 若先剥 `[` 再剥 `]`，结尾已是数字，`]` 剥不掉，端口剥完剩 `::1]`，会被 403。
    const h = String(hostRaw || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '').replace(/\.$/, '')
    if (!h) return false
    if (h === 'localhost' || h.endsWith('.localhost')) return true
    if (isLoopbackAddr(h)) return true
    const ph = panelPublicHost()
    return Boolean(ph) && h === ph
  }
  /** Host 校验 + 失败响应。只用于管理面（模块路由的 Host 另有 Host 闸策略）。 */
  const adminHostBlocked = (req, res) => {
    const hostHeader = String(req.headers?.host || '')
    if (hostAllowedForAdmin(hostHeader)) return false
    log.warn(`管理接口拒绝异常 Host：${hostHeader}（疑似 DNS rebinding；白名单：回环/localhost/security.publicHostname）`)
    send(res, 403, { ok: false, message: '管理接口拒绝该 Host（只接受本机回环、localhost 或已配置的面板对外域名）' })
    return true
  }
  /** 【复审 P1-1】CSRF 闸：所有改状态的方法都要过同源校验。
   *  背景（复审实测）：恶意网页可以从攻击者页面 `fetch('http://127.0.0.1:<port>/save', {method:'POST'})`——
   *  请求 socket 是本机回环（面板闸放行）、方法 POST、跨站。没有 CSRF 校验的话
   *  `/save`、`/bridge/token`、rotate 全都能被恶意页面打穿，无需暴露端口。
   *  口径：
   *    ① 只管写方法（GET/HEAD/OPTIONS 不管——它们不该有副作用）；
   *    ② 浏览器一定带 `Sec-Fetch-Site`：值不在 {same-origin, same-site, none} → 跨站，拒；
   *    ③ 浏览器跨站 fetch 也一定带 `Origin`：主机名不在同源白名单 → 拒；
   *    ④ 两者都没有 = 非浏览器客户端（curl / 脚本）——不是 CSRF 载体，放行，
   *       它们的防线是各自的鉴权（管理面 = 本机闸，/open/* = Bearer 密钥）。 */
  const csrfBlocked = (req, res) => {
    const method = String(req.method || 'GET').toUpperCase()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false
    const site = String(req.headers?.['sec-fetch-site'] || '').trim().toLowerCase()
    if (site && !['same-origin', 'same-site', 'none'].includes(site)) {
      log.warn(`CSRF 拒绝（Sec-Fetch-Site=${site}）：${req.method} ${req.url}`)
      send(res, 403, { ok: false, message: '跨站请求被拒绝（Sec-Fetch-Site 不符）' })
      return true
    }
    const origin = String(req.headers?.origin || '').trim()
    if (origin) {
      let host = ''
      try { host = new URL(origin).hostname } catch {}
      if (!originAllowed(host)) {
        log.warn(`CSRF 拒绝（Origin=${origin}）：${req.method} ${req.url}`)
        send(res, 403, { ok: false, message: '跨站请求被拒绝（Origin 不在同源白名单）' })
        return true
      }
    }
    return false
  }
  /** 面板闸：面板写/读接口统一过它（见上方 panelBlocked 说明）。
   *  opts.skipHostCheck：给 /open/* 这类「非浏览器、自带密钥鉴权」的接口用——
   *  它们没有浏览器同源概念，跨机调用是正常用法，Host 允许名单不该拦。 */

  return {
    send, readBody, readRaw, query, answer,
    isLoopbackAddr, requestIsLocal, panelBlocked, adminHostBlocked, csrfBlocked,
    originAllowed, hostAllowedForAdmin, panelPublicHost,
  }
}
