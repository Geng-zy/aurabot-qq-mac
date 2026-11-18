// 心智对接层里的纯文本/本地模型位置常量：不碰 SQLite、不碰 DSH。
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { hasLocalModel } from '../mind/local/runner.js'

/** 非管理员想让她记成长久规矩的话：她不会因为群友一句话就记成规矩。 */
export function looksLikeRule(text) {
  const t = String(text || '')
  if (!t) return false
  if (/(规则|指令|命令|权限|白名单|管理员|群主|管理员让你|管理员的话|等同管理员|不用确认|都先|一律|不许|不要|禁止|听我的|听他的|听她的|服从)/.test(t)) return true
  if (/(管理员说|管理员让|管理员要求).{0,30}(发|给|做|先|都|不许|不要|禁止|只能)/.test(t)) return true
  if (/(以后|今后|每次|永远).{0,30}(都|必须|只能|先|不许|不要|禁止|一律).{0,30}(发|给|做|听|按|文件|群|管理员|规则|命令|权限)/.test(t)) return true
  return false
}

/** 本地小模型的默认安装位置。 */
export const LOCAL_DEFAULT = {
  root: () => join(homedir(), 'Aurabot', 'mind'),
  python: () => join(homedir(), 'Aurabot', 'mind', 'env', 'bin', 'python'),
  modelDir: () => join(homedir(), 'Aurabot', 'mind', 'models', 'Qwen3.5-9B-mlx4'),
}

export function localModelPaths(setting) {
  const python = String(setting('models.localPython') || '').trim()
  const model = String(setting('models.localModelDir') || '').trim()
  return {
    python: python && existsSync(python) ? python : LOCAL_DEFAULT.python(),
    model: hasLocalModel(model) ? model : LOCAL_DEFAULT.modelDir(),
  }
}

export const EFFORT = { record: 'low', appraisal: 'low', reconsolidate: 'low', think: 'low', privacy: 'low', consolidate: 'high', dream: 'high', deep: 'high', outreach: 'high', reminder: 'low', permission: 'high', traits: 'high', selfstory: 'high' }

/** 发出去的 OneBot 消息段 → 她「说了什么」的文字。 */
export function segmentsText(message, note = '') {
  if (typeof message === 'string') return message
  const out = []
  for (const seg of Array.isArray(message) ? message : []) {
    const d = seg?.data || {}
    switch (seg?.type) {
      case 'text': out.push(String(d.text ?? '')); break
      case 'at': out.push(`@${d.name || d.qq} `); break
      case 'face': out.push('[表情]'); break
      case 'image': out.push(d.summary === '[动画表情]' || d.sub_type === 1 ? '[表情包]' : '[图片]'); break
      case 'record': out.push('[语音] ' + String(note || '').replace(/^\[语音[^\]]*\]\s*/, '')); break
      case 'video': out.push('[视频]'); break
      case 'file': out.push('[文件] ' + String(d.name || '')); break
      case 'reply': break
      default: if (seg?.type) out.push(`[${seg.type}]`)
    }
  }
  return out.join('').trim()
}
