// 插件配置的对外门面：读数、存数、对外公开、面板合并。
// 默认值在 config-defaults.js，归一化在 config-normalize.js —— 这里只保留「和磁盘打交道」的部分。
// 配置文件 ~/.dsh/plugins-data/aurabot/config.json

import { randomUUID } from 'node:crypto'
import { dataDir, readJsonStrict, writeJson } from './store.js'
import { deepMerge, isObj, normalize } from './config-normalize.js'

// 对外契约不变：这两样一直是从 config.js 导出的，测试与面板都在用
export { DEFAULTS } from './config-defaults.js'
export { normalize } from './config-normalize.js'

const SECRETS = [['snowluma', 'httpToken'], ['snowluma', 'wsToken'], ['platforms', 'qq', 'httpToken'], ['platforms', 'qq', 'wsToken'], ['platforms', 'telegram', 'token'], ['imageGen', 'apiKey'], ['mind', 'embedKey'], ['song', 'neteaseCookie'], ['bridge', 'token'], ['voice', 'asrApi', 'apiKey'], ['voice', 'breeze', 'key'], ['voice', 'breeze', 'password'], ['backup', 'remote', 'token'], ['backup', 'remote', 'webdav', 'password']]
// 扩展模块设置里的密码类字段（模块加载时登记）：['ext', 模块id, 字段]
const extraSecrets = new Map()
export function registerSecretField(path) { extraSecrets.set(path.join('\u0000'), path) }
const allSecrets = () => [...SECRETS, ...extraSecrets.values()]
const parentOf = (obj, path, create) => {
  let cur = obj
  for (const k of path.slice(0, -1)) {
    if (!isObj(cur[k])) { if (!create) return null; cur[k] = {} }
    cur = cur[k]
  }
  return cur
}
const getAt = (obj, path) => { const p = parentOf(obj, path, false); return p ? p[path.at(-1)] : undefined }
const FILE = () => dataDir('config.json')

/** 在某次更新里新增、会替她公开发东西的功能。以后再加这类功能，把配置键名加到这里。 */
export const OPT_IN_ON_UPDATE = ['qzoneSocial']

export function loadConfig() {
  const raw = readJsonStrict(FILE(), {})
  // 老配置（向导上线前就填好了两个号）直接算向导已完成
  if (raw && raw.setupDone === undefined && raw.botQQ && raw.ownerQQ) raw.setupDone = true
  // 更新插件后新增的、会公开发东西的功能：老用户先关着，等他们自己在面板里打开（新安装照常默认开）
  if (raw && raw.setupDone) for (const k of OPT_IN_ON_UPDATE) if (raw[k] === undefined) raw[k] = { enabled: false }
  return normalize(raw)
}

export function ownerAuthorizationRevision(cfg) {
  const binding = cfg.ownerAuthorization
  return cfg.ownerQQ && binding?.owner === cfg.ownerQQ && typeof binding.revision === 'string'
    && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(binding.revision) ? binding.revision : ''
}

/**
 * 平台页和新面板会改 platforms.qq，旧面板/老模块会改顶层字段。
 * 保存时只有“这次真的改了”的一边覆盖另一边，避免旧镜像把新编辑冲掉。
 */
export function reconcilePlatformAliases(next, previous = {}) {
  const nq = next?.platforms?.qq
  if (!nq || typeof nq !== 'object') return next
  const pq = previous?.platforms?.qq || {}
  const out = { ...next }
  const changed = (a, b) => JSON.stringify(a) !== JSON.stringify(b)
  for (const key of ['botQQ', 'ownerQQ']) {
    const platformChanged = nq[key] !== undefined && nq[key] !== pq[key]
    const topChanged = next[key] !== undefined && next[key] !== previous[key]
    if (platformChanged && !topChanged) out[key] = nq[key]
  }
  if (nq.allow && changed(nq.allow, pq.allow) && !changed(next.allow, previous.allow)) out.allow = nq.allow
  if (nq.drawAllow && changed(nq.drawAllow, pq.drawAllow) && !changed(next.drawAllow, previous.drawAllow)) out.drawAllow = nq.drawAllow
  return out
}

export function saveConfig(cfg, previous = loadConfig()) {
  const c = normalize(reconcilePlatformAliases(cfg, previous))
  // Only the previous authoritative configuration can carry an authorization forward.
  if (c.ownerQQ) {
    const revision = c.ownerQQ === previous.ownerQQ ? ownerAuthorizationRevision(previous) : ''
    c.ownerAuthorization = { owner: c.ownerQQ, revision: revision || randomUUID() }
  } else delete c.ownerAuthorization
  writeJson(FILE(), c)
  return c
}

/** 给面板看的版本：密码 / token 不回传原文，只告诉有没有填。 */
export function publicConfig(cfg) {
  const c = structuredClone(cfg)
  delete c.ownerAuthorization
  for (const item of c.imageGen?.fallbacks || []) {
    item.apiKeySet = Boolean(item.apiKey)
    item.apiKey = ''
  }
  // 面板上的「试运行」只表示「试运行但不调试」：调试开着时它显示为关，两个开关天然互斥
  c.dryRun = Boolean(c.dryRun && !c.debug)
  for (const path of allSecrets()) {
    const p = parentOf(c, path, false)
    if (!p) continue
    const k = path.at(-1)
    p[`${k}Set`] = Boolean(p[k])
    p[k] = ''
  }
  // 模块未启动/被关掉时，模块自己的 password 字段不会被 registerSecretField 登记；
  // 先按名字兜底脱敏，避免 /state 把明文密钥交出去。
  const secretName = /(?:password|passwd|pwd|token|apikey|api_key|secret|cookie|authorization)$/i
  const scrub = (value) => {
    if (!value || typeof value !== 'object') return
    for (const [k, v] of Object.entries(value)) {
      if (v && typeof v === 'object') scrub(v)
      else if (secretName.test(k) && typeof v === 'string' && v) {
        value[k + 'Set'] = true
        value[k] = ''
      }
    }
  }
  if (c.ext && typeof c.ext === 'object') scrub(c.ext)
  return c
}

/** 面板保存时：没改的密码字段（空串）保留原值。 */
export function mergeFromPanel(current, incoming) {
  const next = deepMerge(current, incoming || {})
  for (const path of allSecrets()) {
    const v = getAt(incoming || {}, path)
    const p = parentOf(next, path, v !== undefined)
    if (!p) continue
    const k = path.at(-1)
    if (v === null) p[k] = '' // 明确传 null = 清空
    else if (v === undefined || v === '') p[k] = getAt(current, path) ?? ''
    delete p[`${k}Set`]
    delete p[`${k}Hint`]
  }
  if (Array.isArray(incoming?.imageGen?.fallbacks)) {
    const saved = new Map((current.imageGen?.fallbacks || []).map((item) => [item.id, item]))
    next.imageGen.fallbacks = incoming.imageGen.fallbacks.filter(isObj).map((item) => {
      const old = saved.get(item.id)
      const provider = ['openai','seedream','xai','gemini','sensenova','comfyui','custom','codex','local'].includes(item.provider) ? item.provider : 'openai'
      const sameEndpoint = old && old.baseUrl === String(item.baseUrl || '').trim().replace(/\/+$/, '') && provider === old.provider
      return { ...item, apiKey: item.apiKey === null ? '' : item.apiKey || (sameEndpoint ? old.apiKey : '') }
    })
  }
  // 主生图密钥跟实际服务端点绑定：换 provider / 地址时不能默默继承旧 Key。
  if (isObj(incoming?.imageGen)) {
    const before = current?.imageGen || {}
    const after = incoming.imageGen
    const oldProvider = String(before.provider || 'openai')
    const newProvider = String(after.provider || oldProvider)
    const endpointOf = (ig) => String(ig?.provider === 'custom' ? ig?.custom?.url : ig?.provider === 'comfyui' ? ig?.comfy?.baseUrl : ig?.baseUrl || '').trim().replace(/\/+$/, '')
    const oldBase = endpointOf(before)
    const newBase = endpointOf({ ...before, ...after, provider: newProvider, custom: { ...(before.custom || {}), ...(after.custom || {}) }, comfy: { ...(before.comfy || {}), ...(after.comfy || {}) } })
    if (after.apiKey !== null && !after.apiKey && (oldProvider !== newProvider || oldBase !== newBase)) next.imageGen.apiKey = ''
  }
  // ASR Key 也跟实际识别端点绑定（内置 provider 的空地址用预设地址）。
  if (isObj(incoming?.voice?.asrApi)) {
    const preset = { siliconflow: 'https://api.siliconflow.cn/v1', openai: 'https://api.openai.com/v1' }
    const endpoint = (v) => {
      const provider = String(v?.provider || '')
      const base = String(v?.baseUrl || preset[provider] || '').trim().replace(/\/+$/, '').replace(/\/audio\/(?:speech|transcriptions)\/?$/i, '')
      return provider + '|' + base
    }
    const before = endpoint(current?.voice?.asrApi)
    const after = endpoint(next.voice?.asrApi)
    if (before !== after && !String(incoming.voice.asrApi.apiKey || '').trim()) next.voice.asrApi.apiKey = ''
  }
  // Breeze 登录密码跟站点 + 邮箱绑定；换账号不继承旧密码。
  if (isObj(incoming?.voice?.breeze)) {
    const before = current?.voice?.breeze || {}
    const after = next.voice?.breeze || {}
    const same = String(before.siteUrl || '').replace(/\/+$/, '') === String(after.siteUrl || '').replace(/\/+$/, '') && String(before.email || '').toLowerCase() === String(after.email || '').toLowerCase()
    if (!same && !String(incoming.voice.breeze.password || '').trim()) next.voice.breeze.password = ''
  }
  // Breeze 云端 Key 跟 API 地址绑定；换站点地址不继承旧 Key。
  if (isObj(incoming?.voice?.breeze)) {
    const endpoint = (v) => String(v?.url || 'https://api.breeze.blue').trim().replace(/\/+$/, '')
    if (endpoint(current?.voice?.breeze) !== endpoint(next.voice?.breeze) && !String(incoming.voice.breeze.key || '').trim()) next.voice.breeze.key = ''
  }
  // 联动密钥只由插件生成，面板不能改
  next.bridge.token = current.bridge?.token || ''
  if (incoming?.group?.overrides) next.group.overrides = incoming.group.overrides
  // 按聊天选模型：两张表整张替换（deepMerge 会让删掉的条目又回来）
  if (incoming?.chatModels?.privates) next.chatModels.privates = incoming.chatModels.privates
  if (incoming?.chatModels?.groups) next.chatModels.groups = incoming.chatModels.groups
  if (incoming?.allow) next.allow = { ...current.allow, ...incoming.allow }
  return normalize(reconcilePlatformAliases(next, current))
}
