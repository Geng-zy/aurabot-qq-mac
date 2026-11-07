// 先在本地音乐文件夹里找原唱：找到就直接用，找不到 studio.js 再去网易云搜（面板「翻唱」页可关、可换文件夹）。
// 文件名按「歌名 - 歌手[专辑].扩展名」解析（网易云下载的默认格式）。
// 规则：她点歌写的是「歌名 歌手」，歌名对上就用；同名有好几个文件时，挑歌手也对得上的。
// 歌名对上、歌手对不上也用本地的（她写的歌手常常猜错）。专辑名不参与匹配（免得点专辑同名的另一首歌时用错文件）。
import { readdirSync, statSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { homedir } from 'node:os'

export const MUSIC_DIR = join(homedir(), 'Music')
const EXTS = new Set(['.flac', '.mp3', '.m4a', '.wav', '.ogg', '.aac', '.ape', '.wma'])
const MAX_DEPTH = 3
const SKIP_DIRS = new Set(['Music', 'iTunes', 'GarageBand', 'Audio Music Apps', 'Logic']) // 系统音乐 App 的资料库

// 只留汉字、字母、数字，统一小写，全角转半角
export const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

// 点歌文字里，歌名（已 norm）后面是不是紧跟一个空格或标点
function spacedAfter(query, nameNorm) {
  const src = String(query || '').normalize('NFKC').toLowerCase()
  let k = 0
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (/[\p{L}\p{N}]/u.test(ch)) {
      if (k === nameNorm.length) return false
      k++
    } else if (k === nameNorm.length) return true
  }
  return true
}

function walk(dir, depth, out) {
  let names = []
  try { names = readdirSync(dir) } catch { return }
  for (const n of names) {
    if (n.startsWith('.')) continue
    const p = join(dir, n)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) {
      if (depth < MAX_DEPTH && !(depth === 0 && SKIP_DIRS.has(n))) walk(p, depth + 1, out)
    } else if (EXTS.has(extname(n).toLowerCase()) && st.size > 0) {
      out.push({ path: p, mtime: st.mtimeMs, size: st.size })
    }
  }
}

/** 文件名 → { title, artists, names }；names 是能拿来匹配的歌名写法 */
export function parseName(file) {
  let stem = basename(file, extname(file)).replace(/\[[^\]]*\]\s*$/, '').trim() // 去掉「[专辑]」
  const i = stem.lastIndexOf(' - ')
  const title = (i > 0 ? stem.slice(0, i) : stem).trim()
  const artists = (i > 0 ? stem.slice(i + 3) : '').trim()
  const names = new Set([title, title.replace(/\s*[(（][^)）]*[)）]\s*/g, ' ').trim()])
  // 「春娇与志明 街道办GDC & 欧阳耀莹 - A12」这种：歌名后面跟了歌手，取第一个词（够长的中文名才取，免得 Waka 这种短词误配）
  const first = title.split(/\s+/)[0]
  if (first !== title && /\p{Script=Han}/u.test(first) && norm(first).length >= 2) names.add(first)
  return { title, artists, names: [...names].map(norm).filter((n) => n.length >= 2) }
}

/** 按点歌的文字找本地原唱；skip 里是试过不行（比如没有人声）的文件。找不到返回 null。 */
export function findLocalSong(query, { dir = MUSIC_DIR, skip = [] } = {}) {
  const q = norm(query)
  if (q.length < 2) return null
  const files = []
  walk(dir, 0, files)
  let best = null
  for (const f of files) {
    if (skip.includes('local:' + f.path)) continue
    const info = parseName(f.path)
    // 她写的是「歌名 歌手」，所以要求点歌文字以歌名开头；取对上的最长写法
    const hit = info.names.filter((n) => q.startsWith(n)).sort((a, b) => b.length - a.length)[0]
    if (!hit) continue
    const rest = q.slice(hit.length)
    const artistHit = rest && info.artists ? info.artists.split(/\s*[&,、/，]\s*|\s+/).map(norm).filter((a) => a.length >= 2).some((a) => rest.includes(a) || a.includes(rest)) : false
    // 歌名后面要么没东西、要么隔着空格、要么紧跟的是对得上的歌手；「演员表」「屋顶上的猫」这种不算「演员」「屋顶」
    if (rest && !artistHit && !spacedAfter(query, hit)) continue
    // 优先：歌名对上的部分更长 > 歌手也对上 > 文件更新
    const score = [hit.length, artistHit ? 1 : 0, f.mtime]
    if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && (score[1] > best.score[1] || (score[1] === best.score[1] && score[2] > best.score[2])))) {
      best = { ...f, ...info, artistHit, score }
    }
  }
  return best && { path: best.path, title: best.title, artists: best.artists, artistHit: best.artistHit }
}
