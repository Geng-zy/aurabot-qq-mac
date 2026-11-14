// 本地小模型：用 mlx-lm 自带的 OpenAI 兼容服务（`python -m mlx_lm server`）跑在本机，只给内心活动用。
// 要用时才启动，闲置一段时间自动停；翻唱这类吃内存的活在跑时先让路（由外面告诉它）。
// 不联网、不花钱。路径都由设置给，这里不写死任何人的目录。

import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function hasLocalModel(dir) {
  if (!dir || !existsSync(join(dir, 'config.json'))) return false
  if (existsSync(join(dir, 'model.safetensors'))) return true
  try {
    const index = JSON.parse(readFileSync(join(dir, 'model.safetensors.index.json'), 'utf8'))
    const shards = new Set(Object.values(index.weight_map || {}))
    return shards.size > 0 && [...shards].every((name) => typeof name === 'string' && /^[\w.-]+\.safetensors$/.test(name) && existsSync(join(dir, name)))
  } catch { return false }
}

/**
 * @param {{
 *   python: () => string,          // 装了 mlx-lm 的 Python
 *   modelDir: () => string,        // 模型文件夹（MLX 格式）
 *   port?: number,
 *   idleMinutes?: number,          // 闲置多久自动停
 *   log?: any,
 *   spawn?: typeof nodeSpawn,
 *   fetch?: typeof fetch,
 *   now?: () => number,
 * }} o
 */
export function createLocalModel(o) {
  const log = o.log || { debug() {}, info() {}, warn() {}, error() {} }
  const spawn = o.spawn || nodeSpawn
  const doFetch = o.fetch || globalThis.fetch
  const now = o.now || (() => Date.now())
  const port = o.port || 18765
  const base = `http://127.0.0.1:${port}`
  let proc = null
  let starting = null
  let generation = 0
  let lastUse = 0
  let lastError = ''
  let calls = 0

  /** 设置齐不齐、文件在不在。 */
  function check() {
    const py = String(o.python() || '').trim()
    const dir = String(o.modelDir() || '').trim()
    if (!py || !dir) return { ok: false, reason: '没设本地小模型（Python 和模型文件夹）' }
    if (!existsSync(py)) return { ok: false, py, dir, reason: '找不到 Python：' + py }
    if (!existsSync(join(dir, 'config.json'))) return { ok: false, py, dir, reason: '模型文件夹里没有 config.json：' + dir }
    if (!hasLocalModel(dir)) return { ok: false, py, dir, reason: '模型文件夹里缺少权重：' + dir }
    return { ok: true, py, dir }
  }

  async function healthy(timeoutMs = 1500) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const r = await doFetch(base + '/v1/models', { signal: ctl.signal })
      return r.ok
    } catch {
      return false
    } finally {
      clearTimeout(t)
    }
  }

  /** 确保服务在跑（没跑就启动，等它加载完模型，最多 3 分钟）。 */
  async function ensure() {
    if (starting) return starting
    const c = check()
    if (!c.ok) { lastError = c.reason; return false }
    const revision = generation
    starting = (async () => {
      try {
        const running = proc
        const available = await healthy()
        if (revision !== generation) return false
        if (running && running === proc && available && running.modelDir === c.dir && running.python === c.py) return true
        if (running && running === proc) {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 1500)
            running.child.once('close', () => { clearTimeout(timer); resolve() })
            stopProcess()
          })
          if (revision !== generation) return false
        }
        if ((!running && available) || (running && await healthy())) {
          lastError = `本地小模型端口 ${port} 已被其他进程占用`
          return false
        }
        if (revision !== generation) return false
        log.info('启动本地小模型…')
        const child = spawn(c.py, ['-m', 'mlx_lm', 'server', '--model', c.dir, '--host', '127.0.0.1', '--port', String(port), '--chat-template-args', '{"enable_thinking":false}', '--log-level', 'WARNING'], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, HF_HUB_OFFLINE: '1' } })
        const current = { child, modelDir: c.dir, python: c.py }
        proc = current
        let err = ''
        child.stderr?.on('data', (d) => { err = (err + d).slice(-2000) })
        child.on('error', (error) => { err = error.message; if (proc === current) proc = null })
        child.on('exit', (code) => { if (proc === current) { log.info(`本地小模型停了（${code}）`); proc = null } })
        for (let i = 0; i < 180; i++) {
          if (revision !== generation) return false
          if (proc !== current) { lastError = '本地小模型没起来：' + err.trim().split('\n').pop(); return false }
          if (await healthy() && proc === current && revision === generation) { lastError = ''; log.info('本地小模型就绪'); return true }
          await sleep(1000)
        }
        lastError = '本地小模型启动超时'
        stopProcess()
        return false
      } catch (error) {
        lastError = '本地小模型启动失败：' + error.message
        stopProcess()
        return false
      } finally {
        starting = null
      }
    })()
    return starting
  }

  /**
   * 问它一句。返回文字；没装、起不来返回 null（外面会改用别的办法或者干脆不想）。
   * @param {Array<{ role: 'system'|'user'|'assistant', content: string }>} messages
   */
  async function chat(messages, { maxTokens = 160, temperature = 0.8, timeoutMs = 60000 } = {}) {
    if (!(await ensure())) return null
    lastUse = now()
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const r = await doFetch(base + '/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ model: 'default_model', messages, max_tokens: maxTokens, temperature, top_p: 0.9 }),
      })
      if (!r.ok) throw new Error('本地小模型返回 ' + r.status)
      const j = await r.json()
      calls++
      lastError = ''
      return String(j?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    } catch (error) {
      lastError = error.message
      log.debug('本地小模型出错：', error.message)
      return null
    } finally {
      clearTimeout(t)
    }
  }

  function stopProcess() {
    const p = proc
    proc = null
    if (p) { try { p.child.kill('SIGTERM') } catch {} }
  }

  function stop() { generation++; stopProcess() }

  /** 闲置太久就停，省内存。外面定时调用。 */
  function idleCheck() {
    const idle = (o.idleMinutes ?? 30) * 60000
    if (proc && lastUse && now() - lastUse > idle) { log.info('本地小模型闲置太久，先停了'); stop() }
  }

  function status() {
    const c = check()
    return { configured: c.ok, python: c.py || '', modelDir: c.dir || '', reason: c.ok ? '' : c.reason, running: Boolean(proc), lastError, calls, lastUse }
  }

  return { chat, ensure, stop, idleCheck, status, check }
}
