// 实验性订阅接法：使用非公开端点，账号 / 工作区是否可用由服务端决定。
import { randomUUID } from 'node:crypto'
import { fetchImage, withTimeoutSignal } from '../core/net.js'
import { pickShape } from './image-shape.js'

function diagnosticError(message, { fallbackable = false } = {}) {
  return Object.assign(new Error(message), { safeDetail: message, fallbackable })
}

const unavailable = (message) => diagnosticError(message, { fallbackable: true })

const SAFE_REASONS = new Map([
  ['content_policy_violation', '订阅生图请求未通过服务端内容审核'],
  ['moderation_blocked', '订阅生图请求未通过服务端内容审核'],
  ['model_not_found', '订阅生图服务找不到所选模型'],
  ['unsupported_value', '订阅生图服务不支持请求中的参数取值'],
  ['invalid_value', '订阅生图服务认为请求参数无效'],
  ['missing_required_parameter', '订阅生图请求缺少服务端要求的参数'],
  ['unknown_parameter', '订阅生图请求包含服务端不认识的参数'],
])

function responseError(status, body) {
  // 服务端的任意文本可能包含提示词、账号信息或地址。只识别已知的结构化错误码。
  const reason = [body?.error?.code, body?.detail?.code, body?.code]
    .map((code) => SAFE_REASONS.get(code)).find(Boolean)
  if (reason) return diagnosticError(`${reason}（HTTP ${status}）`)
  if (status === 403) return diagnosticError('这个订阅 / 工作区不能用生图（HTTP 403）')
  if (status === 400) return diagnosticError('订阅生图请求被服务端拒绝（HTTP 400，原因未知）')
  return diagnosticError(`订阅生图失败（HTTP ${status}）`)
}

export function createCodexImage({ auth, fetchImpl, log }) {
  return async function generate(config, prompt, { shape, image, signal } = {}) {
    // 现有订阅端点只有 JSON 文生图约定，没有已知的参考图字段；不能带图时偷跑文生图。
    if (image) throw unavailable('这个生图服务不支持参考图')
    const revision = auth.revision?.()
    const check = () => { signal?.throwIfAborted(); auth.assertCurrent?.(revision) }
    check()
    const c = config.codex || {}
    const hint = { square: '方图构图（1:1）', portrait: '竖版构图（2:3）', landscape: '横版构图（3:2）', wide: '宽幅横版构图（16:9）' }[pickShape(shape, config)]
    const body = { prompt: [prompt, hint].filter(Boolean).join('，'), model: c.model || 'gpt-image-2', quality: c.quality || 'auto', size: 'auto', background: c.background || 'auto' }
    const once = async ({ access, accountId }) => {
      check()
      if (!accountId) throw diagnosticError('登录信息里没有账号 ID，去生图页重新登录 ChatGPT')
      return fetchImpl('https://chatgpt.com/backend-api/codex/images/generations', {
        method: 'POST',
        headers: { authorization: `Bearer ${access}`, 'chatgpt-account-id': accountId, accept: 'application/json', 'content-type': 'application/json', originator: 'pi', 'x-codex-image-turn-id': randomUUID(), 'user-agent': 'aurabot-qq' },
        body: JSON.stringify(body), signal: withTimeoutSignal(180000, signal),
      }).catch(() => { throw unavailable('订阅生图连接失败或超时') })
    }
    log.info(`订阅生图请求：${body.model} / ${body.quality}`)
    if (auth.status && !auth.status().loggedIn) throw unavailable('还没登录订阅生图账号')
    let r = await once(await auth.ensureAccess())
    check()
    if (r.status === 401) {
      await r.body?.cancel()
      let credential
      try { credential = await auth.ensureAccess({ force: true }) }
      catch (error) { throw unavailable('订阅登录已过期，去生图页重新登录 ChatGPT') }
      r = await once(credential)
      check()
    }
    const j = await r.json().catch(() => null)
    check()
    if (!r.ok) {
      if (r.status === 401) throw unavailable('订阅登录已失效，去生图页重新登录 ChatGPT')
      if (r.status === 429) throw unavailable('订阅生图用得太频繁或额度用完了（HTTP 429）')
      if (r.status >= 500) throw unavailable(`订阅生图服务异常（HTTP ${r.status}）`)
      throw responseError(r.status, j)
    }
    const item = j?.data?.[0]
    if (typeof item?.b64_json === 'string' && item.b64_json) return Buffer.from(item.b64_json, 'base64')
    if (typeof item?.url === 'string' && item.url) {
      const buf = await fetchImage(item.url, { maxBytes: 20 * 1024 * 1024, allowLocal: false, timeoutMs: 120000, signal })
      check()
      return buf
    }
    throw unavailable('订阅生图没有返回图片')
  }
}
