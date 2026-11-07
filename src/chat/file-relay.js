// 给「看不到本机文件」的 QQ 网关递大文件：网关跑在 Docker / 虚拟机里时，本机路径对它不存在，
// base64 又只能塞 30 MB 左右。这里临时开一个只监听 127.0.0.1 的下载口，每个文件一个随机口令，
// 网关通过 host.docker.internal 这类「宿主机」地址来取（OrbStack、Docker Desktop 都会把它转到本机的 127.0.0.1）。
//   - 只监听回环地址：局域网里别的机器连不上
//   - 只给登记过的那个文件，口令 32 位随机，过期（默认 15 分钟）作废
//   - 只认 GET / HEAD，路径里的文件名只是给网关看的，取哪个文件只看口令

import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { basename } from 'node:path'

/** 文件名放进网址：去掉斜杠，其余按 URL 编码。 */
const urlName = (name) => encodeURIComponent(String(name || 'file').replace(/[\\/]/g, '_')) || 'file'

/**
 * @param {object} [opts]
 * @param {() => string} [opts.host] 网关那边看宿主机用的地址（默认 host.docker.internal）
 * @param {number} [opts.ttlMs] 口令多久作废
 * @param {object} [opts.log]
 */
export function createFileRelay({ host = () => 'host.docker.internal', ttlMs = 15 * 60_000, log } = {}) {
  const offers = new Map() // token → { path, name, expires }
  let server = null
  let port = 0
  let starting = null

  const prune = () => { const now = Date.now(); for (const [k, v] of offers) if (v.expires <= now) offers.delete(k) }

  function handle(req, res) {
    prune()
    const m = /^\/f\/([a-f0-9]{32})(?:\/|$)/.exec(req.url || '')
    const offer = m && offers.get(m[1])
    if (!offer || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404).end(); return }
    let size = 0
    try { size = statSync(offer.path).size } catch (error) { res.writeHead(410).end(); return }
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(size),
      'content-disposition': `attachment; filename*=UTF-8''${urlName(offer.name)}`,
      'cache-control': 'no-store',
    })
    if (req.method === 'HEAD') { res.end(); return }
    log?.debug?.(`网关来取文件「${offer.name}」（${Math.round(size / 1024 / 1024)} MB）`)
    createReadStream(offer.path).on('error', () => res.destroy()).pipe(res)
  }

  async function start() {
    if (server) return
    if (!starting) {
      starting = new Promise((resolve, reject) => {
        const s = createServer(handle)
        s.on('error', reject)
        // 0 = 让系统挑一个空闲端口；只听 127.0.0.1
        s.listen(0, '127.0.0.1', () => { server = s; port = s.address().port; s.unref(); resolve() })
      }).finally(() => { starting = null })
    }
    await starting
  }

  /**
   * 登记一个本机文件，返回网关能用的下载地址。
   * @param {string} path 本机绝对路径（调用方已经检查过允许目录、大小）
   * @param {string} [name] 网关那边看到的文件名
   */
  async function offer(path, name = basename(path)) {
    await start()
    prune()
    const token = randomBytes(16).toString('hex')
    offers.set(token, { path, name, expires: Date.now() + ttlMs })
    return `http://${host() || 'host.docker.internal'}:${port}/f/${token}/${urlName(name)}`
  }

  /** 发完就收回口令（不等过期）。 */
  function revoke(url) {
    const m = /\/f\/([a-f0-9]{32})/.exec(String(url || ''))
    if (m) offers.delete(m[1])
  }

  function close() {
    offers.clear()
    try { server?.close() } catch (error) {}
    server = null
  }

  return { offer, revoke, close, get port() { return port }, get size() { prune(); return offers.size } }
}
