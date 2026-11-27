// 数据目录、JSON 读写（UTF-8 无 BOM、先写临时文件再改名）。

import { readFileSync, writeFileSync, mkdirSync, renameSync, openSync, closeSync, fsyncSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** 插件所有数据都放这儿：~/.dsh/plugins-data/aurabot/ */
export function dataDir(...parts) {
  const base = process.env.AURABOT_DATA_DIR || join(dshHome(), 'plugins-data', 'aurabot')
  return join(base, ...parts)
}

export function ensureDir(p) {
  mkdirSync(p, { recursive: true })
  return p
}

export function readJson(file, fallback) {
  try {
    let text = readFileSync(file, 'utf8')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    return JSON.parse(text)
  } catch { 
    return typeof fallback === 'function' ? fallback() : fallback
   }
}

/** 严格读取：文件不存在才用 fallback；JSON 损坏时把原文件留底并抛出，不能静默当空配置。 */
export function readJsonStrict(file, fallback) {
  let text
  try { text = readFileSync(file, 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') return typeof fallback === 'function' ? fallback() : fallback
    throw error
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  try { return JSON.parse(text) } catch (error) {
    const backup = `${file}.broken-${Date.now()}`
    try { renameSync(file, backup) } catch {}
    throw new Error(`配置文件 JSON 损坏，已备份为 ${backup}：${error.message}`)
  }
}

let tmpSeq = 0

/**
 * 写 JSON：先写临时文件，再 atomic rename —— 任何时刻读到的都是「旧的完整内容」或「新的完整内容」。
 *
 * 三条保证（都是踩过的坑）：
 * 1. 临时文件唯一：`<file>.tmp-<pid>-<序号>-<时间36进制>`。旧版只用 pid，进程崩在一次写到一半之后
 *    留下的 `<file>.tmp-<pid>` 会被下一次同 pid 的写覆盖/复用，写到一半的内容可能被 rename 成正式文件。
 * 2. 失败清理：写或 rename 抛错时删掉临时文件，不在数据目录里留残渣（备份、清单都按扩展名扫目录）。
 * 3. 可选落盘：rename 是原子的，但数据没 fsync 时掉电会留下空文件。默认不 fsync（热点路径每次消息都会写），
 *    配置这种「丢了很疼」的文件传 `{ durable: true }`。
 *
 * 注意：这是**同步**写。同步 I/O 在事件循环里天然串行，所以同进程并发调用不会交错；
 * 唯一的并发风险来自跨进程，靠临时文件名里的 pid + 序号 + 时间区分。
 */
export function writeJson(file, value, { durable = false } = {}) {
  ensureDir(dirname(file))
  const tmp = `${file}.tmp-${process.pid}-${(tmpSeq = (tmpSeq + 1) % 1e9)}-${Date.now().toString(36)}`
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    if (durable) {
      try { const fd = openSync(tmp, 'r'); try { fsyncSync(fd) } finally { closeSync(fd) } } catch {}
    }
    renameSync(tmp, file)
  } catch (error) {
    try { unlinkSync(tmp) } catch {}
    throw error
  }
}
