// 音色库的文件操作：列出 / 导入 / 删除音色模型、缓存清理，以及「这个 python、rubberband 在哪」。
// 从 song/studio.js 抽出来：那边是安装与做歌的编排，这一支只碰文件系统与模型文件的形状。

import { readZip } from '../core/zip.js'
import { basename, join } from 'node:path'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'

export function applioPython(p, { exists = existsSync } = {}) {
  const own = join(p.applio, '.venv', 'bin', 'python')
  return exists(own) ? own : p.python
}

/** 找 rubberband（伴奏变调用）：翻唱环境 bin/、PATH、Homebrew 常见位置。找不到返回 ''（自动定调时只挪八度，整首不挪）。 */
export function findRubberband(p, { pathEnv = process.env.PATH || '', exists = existsSync } = {}) {
  const cands = [join(p.bin, 'rubberband'), ...String(pathEnv).split(':').filter(Boolean).map((d) => join(d, 'rubberband')),
    '/opt/homebrew/bin/rubberband', '/usr/local/bin/rubberband']
  return cands.find((c) => { try { return exists(c) } catch { return false } }) || ''
}

/** 像不像 RVC 模型：PyTorch 存的 .pth 要么是 zip 格式（PK 开头），要么是老的 pickle（0x80 开头）。 */
export function looksLikePth(buf) {
  return buf.length > 1024 * 1024 && ((buf[0] === 0x50 && buf[1] === 0x4b) || buf[0] === 0x80)
}

const safeName = (n) => basename(String(n).replace(/\\/g, '/')).replace(/[<>:"|?*\x00-\x1f]/g, '_').trim()

/**
 * 导入音色：.pth / .index，或者装着它们的 zip。存进 models 目录。
 * zip 里只有一个音色时，index 自动改名成「音色名.index」配上。
 * @returns {{ok: boolean, added: string[], indexes: number, message: string}}
 */
/** models 目录里的音色：[{id, pth, index}]，同名 .index 可选。 */
export function listVoices(modelsDir) {
  let names = []
  try { names = readdirSync(modelsDir) } catch { return [] }
  const pths = names.filter((n) => n.toLowerCase().endsWith('.pth')).sort()
  const ids = pths.map((n) => n.slice(0, -4))
  const indexFor = (id) => {
    const idl = id.toLowerCase()
    const hits = names.filter((m) => {
      if (!m.toLowerCase().endsWith('.index')) return false
      const stem = m.slice(0, -6).toLowerCase()
      return stem === idl || stem.startsWith(idl + '.') || stem.endsWith('_' + idl)
    })
    // 多个音色都能认领同一个索引时不猜；只有唯一归属才绑定。
    const owners = hits.filter((m) => {
      const stem = m.slice(0, -6).toLowerCase()
      return ids.filter((other) => stem === other.toLowerCase() || stem.startsWith(other.toLowerCase() + '.') || stem.endsWith('_' + other.toLowerCase())).length === 1
    })
    return owners[0] || ''
  }
  return pths.map((n) => {
    const id = n.slice(0, -4)
    const idx = indexFor(id)
    // 音色档案（音域 + 音色参照，voice_profile.py 生成）：<音色>.profile.json，有它才自动定调、挪八度、校正音色
    const prof = join(modelsDir, id + '.profile.json')
    return { id, pth: join(modelsDir, n), index: idx ? join(modelsDir, idx) : '', profile: existsSync(prof) ? prof : '' }
  })
}

/**
 * 换声用哪个 Python：Applio 自己的环境（Applio/.venv，一键安装照 Applio 官方 Mac 方式建的）；
 * 万一没有（老的单环境安装），退回翻唱环境 env/。
 */
export function importModels(modelsDir, filename, buf) {
  const name = safeName(filename)
  const lower = name.toLowerCase()
  let files
  if (lower.endsWith('.zip')) {
    files = readZip(buf, (n) => /\.(pth|index)$/i.test(n) && !n.includes('__MACOSX')).map((f) => ({ name: safeName(f.name), data: f.data }))
  } else if (lower.endsWith('.pth') || lower.endsWith('.index')) {
    files = [{ name, data: buf }]
  } else {
    return { ok: false, added: [], indexes: 0, message: '只支持 .zip、.pth、.index 文件' }
  }
  const pths = files.filter((f) => f.name.toLowerCase().endsWith('.pth'))
  const idxs = files.filter((f) => f.name.toLowerCase().endsWith('.index'))
  if (!pths.length && !idxs.length) return { ok: false, added: [], indexes: 0, message: '里面没找到 .pth 模型' }
  const bad = pths.filter((f) => !looksLikePth(f.data))
  if (bad.length) return { ok: false, added: [], indexes: 0, message: `「${bad[0].name}」看起来不是 RVC 模型` }
  mkdirSync(modelsDir, { recursive: true })
  for (const f of pths) writeFileSync(join(modelsDir, f.name), f.data)
  const solo = pths.length === 1 ? pths[0].name.slice(0, -4) : ''
  for (const f of idxs) writeFileSync(join(modelsDir, solo && idxs.length === 1 ? `${solo}.index` : f.name), f.data)
  const added = pths.map((f) => f.name.slice(0, -4))
  return {
    ok: true,
    added,
    indexes: idxs.length,
    message: added.length ? `导入了 ${added.length} 个音色：${added.join('、')}${idxs.length ? `（带 ${idxs.length} 个 index）` : ''}` : `导入了 ${idxs.length} 个 index`,
  }
}

/** 删掉一个音色（连同配套的 index）。 */
export function deleteVoice(modelsDir, id) {
  const v = listVoices(modelsDir).find((x) => x.id === id)
  if (!v) return { ok: false, message: '没有这个音色' }
  rmSync(v.pth, { force: true })
  if (v.index) rmSync(v.index, { force: true })
  // 音色档案也删：不然以后导入同名的另一个模型，会套用这个旧档案去定调、校正音色
  if (v.profile) rmSync(v.profile, { force: true })
  return { ok: true, message: `删掉了「${id}」` }
}

/** 缓存目录只留最新的 keep 个文件。 */
export function pruneCache(dir, keep) {
  let files = []
  try { files = readdirSync(dir).map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs })) } catch { return 0 }
  const old = files.sort((a, b) => b.t - a.t).slice(keep)
  for (const f of old) rmSync(join(dir, f.n), { force: true })
  return old.length
}

/** 截一段：歌比上限长时从「大约副歌」的位置开始（全曲 30% 处），否则从头。 */
/** 分出来的人声轨平均音量低于这个就当没有人声。正常人声在 -15 ~ -30 dB，纯音乐分出来是 -80 以下。 */

/** 混音的 ffmpeg 参数。没有 inst 就是清唱，只留她的人声。 */
